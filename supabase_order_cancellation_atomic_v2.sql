-- ==============================================================================
-- Om Distributors - Atomic Order Cancellation, Stock Restoration & Wallet Refund (v2 Hardened)
-- Version: v2 (supabase_order_cancellation_atomic_v2.sql)
-- ==============================================================================
-- Fixes & Hardening over v1:
--   1. Mandatory Complete Stock Deduction & Restoration (Zero Partial Loops):
--      - transition_order_status_atomic() validates & resolves EVERY positive-qty
--        order item to an authoritative product & variant BEFORE mutating stock.
--        If any product/variant fails to match or any stock update fails, the
--        entire transaction rolls back automatically; stockDeducted=true is set
--        ONLY after all updates succeed.
--      - cancel_order_atomic() validates & restores EVERY item atomically when
--        stockDeducted=true AND stockRestored=false; prevents partial restores
--        and double-restoration, rolling back cleanly on any mismatch/failure.
--   2. Ledger-Verified Refund Safety (Never Trust Inflated COD_META):
--      - Wallet refund comes strictly from verified public.ledger DEBIT rows
--        (_is_wallet_ledger_entry = true), NEVER from COD_META.walletAmountUsed.
--      - Online refund requires authoritative paid proof on public.orders
--        (is_paid=true AND payment_status IN ('RECEIVED','PAID'), or verified
--        razorpay_payment_id with paid status); ignores unpaid orders & fake
--        COD_META.previousOnlinePaid / totalPayable.
--      - COD refund verifies actual COD collection entries in public.ledger
--        (cod_tx_% / COD_TX_META FIFO allocations via _extract_cod_allocated_amount);
--        ignores fake/inflated COD_META.codCollected.
--      - Fixes v1's `< 2` net-of-wallet tolerance bug and enforces strict cap
--        total_refundable <= gross order total; atomic ledger CREDIT +
--        users.wallet_balance sync + uq_ledger_order_refund_credit guard.
--   3. COD_META & Financial Data Protection:
--      - transition_order_status_atomic() strips protected financial, stock,
--        late-fee, refund, and audit keys from incoming p_notes COD_META before
--        merging into v_existing_meta, preventing client overwrites of
--        walletAmountUsed, previousOnlinePaid, codCollected, totalPayable, etc.
--      - Blocks transitioning directly to 'CANCELLED' (must use cancel_order_atomic).
--   4. Security, Ownership, Shared Helpers & Locks:
--      - Strengthens CUSTOMER ownership checks in cancel_order_atomic().
--      - Hardens prevent_cancelled_order_revival() trigger against financial edits.
--      - Keeps shared helpers, advisory locks (_acquire_customer_wallet_locks),
--        debit_wallet_for_order_atomic(), function signatures, and service_role-only
--        permissions 100% identical to supabase_order_creation_atomic_v2.sql.
-- ==============================================================================

BEGIN;

-- 1. Pre-flight Schema & Signature Integrity Verification
DO $$
DECLARE
  v_missing_tables TEXT[] := ARRAY[]::TEXT[];
  v_tbl TEXT;
  v_bad_overloads TEXT;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['users', 'orders', 'order_items', 'ledger', 'products', 'product_variants']
  LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      v_missing_tables := array_append(v_missing_tables, 'public.' || v_tbl);
    END IF;
  END LOOP;

  IF cardinality(v_missing_tables) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Required table(s) missing: %. Apply base schema (supabase_setup.sql) first.',
      array_to_string(v_missing_tables, ', ');
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid)
  INTO v_bad_overloads
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (
      (p.proname = 'cancel_order_atomic' AND p.pronargs <> 5)
      OR (p.proname = 'debit_wallet_for_order_atomic' AND p.pronargs <> 7)
      OR (p.proname = 'transition_order_status_atomic' AND p.pronargs <> 14)
      OR (p.proname = 'prevent_cancelled_order_revival' AND p.pronargs <> 0)
      OR (p.proname = '_acquire_customer_wallet_locks' AND p.pronargs <> 3)
      OR (p.proname = '_normalize_indian_phone10' AND p.pronargs <> 1)
      OR (p.proname = '_indian_mobile_variants' AND p.pronargs <> 1)
      OR (p.proname = '_parse_cod_meta_from_notes' AND p.pronargs <> 1)
      OR (p.proname = '_is_wallet_ledger_entry' AND p.pronargs <> 3)
      OR (p.proname = '_parse_legacy_product_name_lines' AND p.pronargs <> 1)
      OR (p.proname = '_has_embedded_variant_shape' AND p.pronargs <> 1)
      OR (p.proname = '_extract_cod_allocated_amount' AND p.pronargs <> 4)
    );

  IF v_bad_overloads IS NOT NULL THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Conflicting overloaded function signature(s) found: %. Resolve manually to avoid PostgREST ambiguity.',
      v_bad_overloads;
  END IF;
END $$;

-- 2. Supporting ledger lookup & partial unique index for cancellation refunds
CREATE INDEX IF NOT EXISTS idx_ledger_order_id_type
  ON public.ledger (order_id, type)
  WHERE order_id IS NOT NULL;

DO $$
DECLARE
  v_dup_count INTEGER := 0;
  v_dup_summary TEXT := '';
BEGIN
  SELECT
    COUNT(*),
    string_agg(format('order_id=%s (count=%s)', order_id, cnt), '; ' ORDER BY order_id)
  INTO v_dup_count, v_dup_summary
  FROM (
    SELECT order_id, COUNT(*) AS cnt
    FROM public.ledger
    WHERE order_id IS NOT NULL
      AND type = 'CREDIT'
      AND id LIKE 'wtx_%'
    GROUP BY order_id
    HAVING COUNT(*) > 1
  ) dups;

  IF coalesce(v_dup_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Found % order_id(s) with duplicate wallet refund CREDIT entries in public.ledger. Reconcile manually before creating unique index. Details: %',
      v_dup_count,
      v_dup_summary;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_order_refund_credit
  ON public.ledger (order_id)
  WHERE order_id IS NOT NULL
    AND type = 'CREDIT'
    AND id LIKE 'wtx_%';

-- 3. Trigger guard: Prevent reviving CANCELLED orders or altering their financial/ownership state
CREATE OR REPLACE FUNCTION public.prevent_cancelled_order_revival()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF pg_catalog.upper(coalesce(OLD.status, '')) = 'CANCELLED' THEN
    IF pg_catalog.upper(coalesce(NEW.status, '')) IS DISTINCT FROM 'CANCELLED'
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.is_paid IS DISTINCT FROM OLD.is_paid
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.final_total IS DISTINCT FROM OLD.final_total
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
       OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone THEN
      RAISE EXCEPTION 'Cancelled order % cannot be modified or revived', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_prevent_cancelled_revival ON public.orders;
CREATE TRIGGER trg_orders_prevent_cancelled_revival
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_cancelled_order_revival();

-- 4. Internal pure/stable helpers
--    (First 5 helpers & _acquire_customer_wallet_locks are 100% identical to supabase_order_creation_atomic_v2.sql)
CREATE OR REPLACE FUNCTION public._normalize_indian_phone10(raw_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_digits TEXT;
BEGIN
  IF raw_phone IS NULL THEN
    RETURN '';
  END IF;
  v_digits := pg_catalog.regexp_replace(raw_phone, '\D', '', 'g');
  IF pg_catalog.length(v_digits) > 10 THEN
    RETURN pg_catalog.right(v_digits, 10);
  END IF;
  RETURN v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public._indian_mobile_variants(clean_phone10 TEXT)
RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF clean_phone10 IS NULL OR clean_phone10 = '' THEN
    RETURN ARRAY[]::TEXT[];
  END IF;
  IF clean_phone10 ~ '^[6-9][0-9]{9}$' THEN
    RETURN ARRAY[
      clean_phone10,
      '+91' || clean_phone10,
      '+91 ' || clean_phone10,
      '91' || clean_phone10,
      '0' || clean_phone10,
      '0091' || clean_phone10
    ];
  END IF;
  RETURN ARRAY[
    clean_phone10,
    '+91' || clean_phone10,
    '91' || clean_phone10,
    '0' || clean_phone10
  ];
END;
$$;

CREATE OR REPLACE FUNCTION public._parse_cod_meta_from_notes(raw_notes TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_notes TEXT := coalesce(raw_notes, '');
  v_pos INTEGER;
  v_prefix TEXT;
  v_order_num TEXT := '';
  v_meta_text TEXT;
  v_meta JSONB := '{}'::jsonb;
BEGIN
  v_pos := pg_catalog.position('COD_META:' IN v_notes);
  IF v_pos > 0 THEN
    v_prefix := pg_catalog.substr(v_notes, 1, v_pos - 1);
    v_order_num := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.replace(v_prefix, '|', ''), '^Order\s*#?', '', 'i'));
    v_meta_text := pg_catalog.btrim(pg_catalog.substr(v_notes, v_pos + pg_catalog.length('COD_META:')));
    BEGIN
      v_meta := v_meta_text::jsonb;
      IF pg_catalog.jsonb_typeof(v_meta) <> 'object' THEN
        v_meta := '{}'::jsonb;
      END IF;
    EXCEPTION WHEN others THEN
      v_meta := '{}'::jsonb;
    END;
  ELSE
    v_order_num := pg_catalog.btrim(pg_catalog.regexp_replace(v_notes, '^Order\s*#?', '', 'i'));
    v_meta := '{}'::jsonb;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'orderNumber', v_order_num,
    'meta', v_meta
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._is_wallet_ledger_entry(
  p_id TEXT,
  p_type TEXT,
  p_description TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id TEXT := coalesce(p_id, '');
  v_type TEXT := pg_catalog.upper(coalesce(p_type, ''));
  v_desc TEXT := pg_catalog.lower(coalesce(p_description, ''));
BEGIN
  IF v_desc LIKE '%cod payment%' OR v_desc LIKE '%cod collection%' THEN
    RETURN FALSE;
  END IF;
  IF v_id LIKE 'cod_tx_%' OR v_id LIKE 'led_ord_%' THEN
    RETURN FALSE;
  END IF;
  IF v_type = 'DEBIT' AND (v_desc LIKE '%wallet%' OR v_id LIKE 'wtx_%') THEN
    RETURN TRUE;
  END IF;
  IF v_type = 'CREDIT' AND (v_desc LIKE '%refund%' OR v_desc LIKE '%wallet%' OR v_id LIKE 'wtx_%') THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public._parse_legacy_product_name_lines(raw_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_line TEXT;
  v_m TEXT[];
  v_raw_label TEXT;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_clean_name TEXT;
  v_paren TEXT;
  v_um TEXT[];
  v_variant_name TEXT;
  v_pack_size NUMERIC;
  v_unit TEXT;
  v_items JSONB := '[]'::jsonb;
BEGIN
  IF raw_text IS NULL OR pg_catalog.btrim(raw_text) = '' THEN
    RETURN '[]'::jsonb;
  END IF;

  FOR v_line IN
    SELECT pg_catalog.btrim(x)
    FROM pg_catalog.regexp_split_to_table(pg_catalog.replace(raw_text, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10)), pg_catalog.chr(10)) AS x
    WHERE pg_catalog.btrim(x) <> ''
  LOOP
    v_m := pg_catalog.regexp_match(
      v_line,
      '^(?:\d+\.\s*)?(.+?)\s*-\s*(\d+(?:\.\d+)?)\s*Qty(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?(?:\s*=\s*₹?\s*(\d+(?:\.\d+)?))?',
      'i'
    );
    IF v_m IS NULL THEN
      CONTINUE;
    END IF;

    v_raw_label := pg_catalog.btrim(v_m[1]);
    v_qty := coalesce(NULLIF(v_m[2], '')::numeric, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    v_unit_price := CASE WHEN v_m[3] IS NOT NULL AND v_m[3] <> '' THEN v_m[3]::numeric ELSE NULL END;
    v_clean_name := pg_catalog.btrim(pg_catalog.regexp_replace(v_raw_label, '\s*\([^)]+\)', '', 'g'));
    v_variant_name := NULL;
    v_pack_size := NULL;
    v_unit := NULL;

    FOR v_paren IN
      SELECT pg_catalog.btrim((pg_catalog.regexp_matches(v_raw_label, '\(([^)]+)\)', 'g'))[1])
    LOOP
      v_um := pg_catalog.regexp_match(
        v_paren,
        '^(\d+(?:\.\d+)?)\s*(KG|G|GM|ML|LITER|LITRE|LTR|NOS|PCS|PACK|POUCH)\M',
        'i'
      );
      IF v_um IS NOT NULL THEN
        v_variant_name := v_paren;
        v_pack_size := v_um[1]::numeric;
        v_unit := pg_catalog.upper(v_um[2]);
        IF v_unit = 'GM' THEN v_unit := 'G'; END IF;
        IF v_unit IN ('LITRE', 'LTR') THEN v_unit := 'LITER'; END IF;
      END IF;
    END LOOP;

    v_items := v_items || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_strip_nulls(
        pg_catalog.jsonb_build_object(
          'productName', coalesce(NULLIF(v_clean_name, ''), v_raw_label),
          'variantName', v_variant_name,
          'unit', v_unit,
          'packSize', v_pack_size,
          'quantity', v_qty,
          'unitPrice', v_unit_price
        )
      )
    );
  END LOOP;

  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public._has_embedded_variant_shape(p_list JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_elem JSONB;
BEGIN
  IF p_list IS NULL OR pg_catalog.jsonb_typeof(p_list) <> 'array' OR pg_catalog.jsonb_array_length(p_list) = 0 THEN
    RETURN FALSE;
  END IF;

  FOR v_elem IN SELECT value FROM pg_catalog.jsonb_array_elements(p_list)
  LOOP
    IF pg_catalog.jsonb_typeof(v_elem) = 'object' AND (
      v_elem ? 'packSize' OR
      v_elem ? 'pack_size' OR
      v_elem ? 'packLabel' OR
      v_elem ? 'pack_label' OR
      v_elem ? 'unit'
    ) THEN
      RETURN TRUE;
    END IF;
  END LOOP;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public._extract_cod_allocated_amount(
  p_order_id TEXT,
  p_ledger_order_id TEXT,
  p_amount NUMERIC,
  p_description TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_desc TEXT := coalesce(p_description, '');
  v_pos INTEGER;
  v_meta_text TEXT;
  v_meta JSONB := '{}'::jsonb;
  v_alloc JSONB;
  v_sum NUMERIC := 0;
BEGIN
  v_pos := pg_catalog.position('COD_TX_META:' IN v_desc);
  IF v_pos > 0 THEN
    v_meta_text := pg_catalog.btrim(pg_catalog.substr(v_desc, v_pos + pg_catalog.length('COD_TX_META:')));
    BEGIN
      v_meta := v_meta_text::jsonb;
    EXCEPTION WHEN others THEN
      v_meta := '{}'::jsonb;
    END;

    IF pg_catalog.jsonb_typeof(v_meta) = 'object'
       AND pg_catalog.jsonb_typeof(v_meta->'allocations') = 'array'
       AND pg_catalog.jsonb_array_length(v_meta->'allocations') > 0 THEN
      FOR v_alloc IN SELECT value FROM pg_catalog.jsonb_array_elements(v_meta->'allocations')
      LOOP
        IF coalesce(v_alloc->>'orderId', '') = p_order_id THEN
          v_sum := v_sum + greatest(0, coalesce((v_alloc->>'amountAllocated')::numeric, 0));
        END IF;
      END LOOP;
      RETURN pg_catalog.round(v_sum, 2);
    END IF;
  END IF;

  IF coalesce(p_ledger_order_id, '') = p_order_id THEN
    RETURN pg_catalog.round(greatest(0, coalesce(p_amount, 0)), 2);
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public._acquire_customer_wallet_locks(
  p_user_id TEXT DEFAULT NULL,
  p_phones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_fallback TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_keys TEXT[] := ARRAY[]::TEXT[];
  v_clean_uid TEXT := btrim(coalesce(p_user_id, ''));
  v_ph TEXT;
  v_clean_ph TEXT;
  v_fallback TEXT := btrim(coalesce(p_fallback, ''));
  v_lock_key TEXT;
BEGIN
  IF v_clean_uid <> ''
     AND v_clean_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_keys := array_append(v_keys, 'om_wallet_uid:' || lower(v_clean_uid));
  END IF;

  IF p_phones IS NOT NULL THEN
    FOREACH v_ph IN ARRAY p_phones
    LOOP
      v_clean_ph := public._normalize_indian_phone10(v_ph);
      IF v_clean_ph <> '' THEN
        v_keys := array_append(v_keys, 'om_wallet:' || v_clean_ph);
      END IF;
    END LOOP;
  END IF;

  IF cardinality(v_keys) = 0 AND v_fallback <> '' THEN
    v_keys := array_append(v_keys, 'om_wallet:' || v_fallback);
  END IF;

  IF cardinality(v_keys) > 0 THEN
    FOR v_lock_key IN
      SELECT DISTINCT k
      FROM unnest(v_keys) AS k
      WHERE k IS NOT NULL AND k <> ''
      ORDER BY pg_catalog.hashtext(k) ASC, k ASC
    LOOP
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_lock_key));
    END LOOP;
  END IF;
END;
$$;

-- 5. Atomic Order Cancellation RPC (single ACID transaction)
CREATE OR REPLACE FUNCTION public.cancel_order_atomic(
  p_order_id TEXT,
  p_actor_role TEXT,
  p_customer_id TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_raw_order_id TEXT := btrim(coalesce(p_order_id, ''));
  v_actor_role TEXT := upper(btrim(coalesce(p_actor_role, '')));
  v_order public.orders%ROWTYPE;
  v_order_status TEXT;
  v_order_phone TEXT;
  v_session_phone TEXT;
  v_req_cid TEXT := btrim(coalesce(p_customer_id, ''));
  v_owns_by_phone BOOLEAN := FALSE;
  v_owns_by_verified_uid BOOLEAN := FALSE;
  v_uid_owner_phone TEXT := NULL;
  v_uid_owner_role TEXT := NULL;

  v_parsed_notes JSONB;
  v_parsed_ord_num TEXT;
  v_existing_meta JSONB;
  v_resolved_order_number TEXT;

  v_rel_items JSONB := '[]'::jsonb;
  v_authoritative_items JSONB := '[]'::jsonb;

  v_existing_credits_total NUMERIC(12, 2) := 0;
  v_first_credit_id TEXT := NULL;
  v_first_credit_desc TEXT := NULL;
  v_first_credit_bal NUMERIC(12, 2) := NULL;
  v_ledger_row RECORD;

  v_should_restore_stock BOOLEAN := FALSE;
  v_prod_has_stock BOOLEAN := FALSE;
  v_prod_has_stock_qty BOOLEAN := FALSE;
  v_prod_has_wtd BOOLEAN := FALSE;
  v_prod_has_updated_at BOOLEAN := FALSE;
  v_user_has_phone_norm BOOLEAN := FALSE;

  v_explicit_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_explicit_var_ids TEXT[] := ARRAY[]::TEXT[];
  v_needs_full_catalog BOOLEAN := FALSE;
  v_lock_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_lock_var_ids TEXT[] := ARRAY[]::TEXT[];

  v_catalog JSONB := '[]'::jsonb;
  v_prod_rec RECORD;
  v_var_rec RECORD;
  v_p_json JSONB;
  v_rel_vars JSONB;
  v_emb_vars JSONB;
  v_emb_elem JSONB;
  v_idx INTEGER;

  v_item JSONB;
  v_item_prod_id TEXT;
  v_item_var_id TEXT;
  v_item_prod_name TEXT;
  v_item_var_name TEXT;
  v_item_unit TEXT;
  v_item_pack_size NUMERIC;
  v_item_qty NUMERIC;
  v_item_unit_price NUMERIC;
  v_expected_restore_qty NUMERIC := 0;
  v_applied_restore_qty NUMERIC := 0;
  v_expected_restore_ops INTEGER := 0;
  v_applied_restore_ops INTEGER := 0;

  v_matched_prod JSONB;
  v_matched_var JSONB;
  v_raw_search TEXT;
  v_stripped_search TEXT;
  v_search_v_name TEXT;
  v_combined_search TEXT;
  v_has_explicit_var BOOLEAN;

  v_var_deltas JSONB := '{}'::jsonb;
  v_prod_deltas JSONB := '{}'::jsonb;
  v_touched_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_restored_items_summary JSONB := '[]'::jsonb;

  v_delta_key TEXT;
  v_delta_qty NUMERIC;
  v_prev_stock NUMERIC;
  v_next_stock NUMERIC;
  v_next_total_stock NUMERIC;
  v_prev_wtd JSONB;
  v_next_wtd JSONB;
  v_wtd_item JSONB;
  v_ev_id TEXT;
  v_cur_ev_stock NUMERIC;
  v_upd_ev_stock NUMERIC;
  v_emb_expected_qty NUMERIC := 0;
  v_emb_applied_qty NUMERIC := 0;

  v_sql TEXT;
  v_set_parts TEXT[];
  v_row_count INTEGER;

  v_ledger_wallet_debit_total NUMERIC(12, 2) := 0;
  v_ledger_cod_collected NUMERIC(12, 2) := 0;
  v_wallet_used NUMERIC(12, 2) := 0;
  v_db_final_total NUMERIC(12, 2) := 0;
  v_order_gross_cap NUMERIC(12, 2) := 0;
  v_payment_method_upper TEXT;
  v_payment_status_upper TEXT;
  v_is_paid_order BOOLEAN := FALSE;
  v_has_razorpay_id BOOLEAN := FALSE;
  v_is_advance_method BOOLEAN := FALSE;
  v_cod_charge_val NUMERIC(12, 2) := 0;
  v_base_computed_total NUMERIC(12, 2) := 0;
  v_is_final_net_of_wallet BOOLEAN := FALSE;
  v_online_paid NUMERIC(12, 2) := 0;
  v_cod_paid NUMERIC(12, 2) := 0;
  v_total_refundable NUMERIC(12, 2) := 0;
  v_already_credited NUMERIC(12, 2) := 0;
  v_amount_to_credit NUMERIC(12, 2) := 0;

  v_clean_phone TEXT;
  v_customer_name TEXT;
  v_phone_variants TEXT[];
  v_pre_uid TEXT := NULL;
  v_pre_db_phone TEXT := NULL;
  v_lock_uid TEXT := NULL;
  v_user_id TEXT := NULL;
  v_user_phone TEXT := NULL;
  v_user_wallet_bal NUMERIC(12, 2) := 0;
  v_user_found BOOLEAN := FALSE;
  v_alias_ids TEXT[];
  v_has_wallet_credit_rows BOOLEAN := FALSE;
  v_running_bal NUMERIC(12, 2) := 0;
  v_current_wallet_balance NUMERIC(12, 2) := 0;
  v_new_balance_after NUMERIC(12, 2) := 0;
  v_refund_description TEXT := NULL;
  v_ledger_tx_id TEXT := NULL;
  v_resolved_ledger_customer_id TEXT;

  v_next_payment_status TEXT;
  v_final_meta JSONB;
  v_next_notes TEXT;
  v_updated_order public.orders%ROWTYPE;
  v_order_json JSONB;
BEGIN
  IF v_actor_role NOT IN ('CUSTOMER', 'SHOPKEEPER') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 401,
      'error', 'Unauthorized: Verified session required to cancel orders.'
    );
  END IF;

  IF v_raw_order_id = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Order ID is required'
    );
  END IF;

  IF v_actor_role = 'CUSTOMER' THEN
    v_session_phone := public._normalize_indian_phone10(p_customer_phone);
    IF v_session_phone !~ '^[6-9][0-9]{9}$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 401,
        'error', 'Unauthorized: Valid verified customer mobile session is required.'
      );
    END IF;
  END IF;

  -- 1. Lock target order row FOR UPDATE to serialize concurrent cancellation/status updates
  IF v_raw_order_id LIKE 'OM-%' THEN
    SELECT * INTO v_order
    FROM public.orders
    WHERE order_number = v_raw_order_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_order
    FROM public.orders
    WHERE id = v_raw_order_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 404,
      'error', 'Order not found.'
    );
  END IF;

  -- 2. Strict customer ownership check (before status checks to prevent order state probing)
  IF v_actor_role = 'CUSTOMER' THEN
    v_order_phone := public._normalize_indian_phone10(v_order.customer_phone);
    v_owns_by_phone := (v_order_phone <> '' AND v_order_phone = v_session_phone);

    -- Check UUID ownership ONLY if order phone didn't match (e.g. customer updated mobile number after placing order)
    -- and verify against public.users that the UUID belongs to a CUSTOMER with v_session_phone.
    IF NOT v_owns_by_phone
       AND v_order.customer_id IS NOT NULL
       AND v_req_cid <> ''
       AND v_order.customer_id = v_req_cid
       AND v_req_cid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT public._normalize_indian_phone10(phone), upper(coalesce(role, 'CUSTOMER'))
      INTO v_uid_owner_phone, v_uid_owner_role
      FROM public.users
      WHERE id = v_req_cid
      LIMIT 1;

      IF FOUND AND v_uid_owner_role = 'CUSTOMER' AND v_uid_owner_phone = v_session_phone THEN
        v_owns_by_verified_uid := TRUE;
      END IF;
    END IF;

    IF NOT v_owns_by_phone AND NOT v_owns_by_verified_uid THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: You can only cancel your own orders.'
      );
    END IF;
  END IF;

  v_order_status := upper(coalesce(v_order.status, ''));

  -- 3. Strictly reject DELIVERED orders
  IF v_order_status = 'DELIVERED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Delivered orders cannot be cancelled.'
    );
  END IF;

  v_parsed_notes := public._parse_cod_meta_from_notes(v_order.notes);
  v_parsed_ord_num := coalesce(v_parsed_notes->>'orderNumber', '');
  v_existing_meta := coalesce(v_parsed_notes->'meta', '{}'::jsonb);
  v_resolved_order_number := btrim(
    coalesce(
      NULLIF(v_order.order_number, ''),
      NULLIF(v_parsed_ord_num, ''),
      left(regexp_replace(v_order.id, '^ord[-_]', '', 'i'), 8)
    )
  );

  -- Load relational order_items for enriched response & stock calculation
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'orderId', oi.order_id,
        'productId', oi.product_id,
        'variantId', oi.product_variant_id,
        'productName', oi.product_name,
        'variantName', oi.variant_name,
        'brand', oi.brand,
        'unit', oi.unit,
        'packSize', coalesce(oi.pack_size, 1),
        'quantity', coalesce(oi.quantity, 1),
        'unitPrice', coalesce(oi.unit_price, 0),
        'price', coalesce(oi.total_price, 0),
        'isDiscountExcluded', coalesce(oi.is_discount_excluded, false)
      )
      ORDER BY oi.created_at ASC, oi.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_rel_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  -- 4. Committed idempotency path (under FOR UPDATE lock, any prior winner has ALREADY committed)
  IF v_order_status = 'CANCELLED' THEN
    FOR v_ledger_row IN
      SELECT id, amount, description, balance_after, type
      FROM public.ledger
      WHERE order_id = v_order.id
        AND type = 'CREDIT'
      ORDER BY date ASC, id ASC
    LOOP
      IF public._is_wallet_ledger_entry(v_ledger_row.id, v_ledger_row.type, v_ledger_row.description) THEN
        v_existing_credits_total := round(v_existing_credits_total + coalesce(v_ledger_row.amount, 0), 2);
        IF v_first_credit_id IS NULL THEN
          v_first_credit_id := v_ledger_row.id;
          v_first_credit_desc := v_ledger_row.description;
        END IF;
        v_first_credit_bal := coalesce(v_ledger_row.balance_after, v_first_credit_bal);
      END IF;
    END LOOP;

    v_order_json := to_jsonb(v_order);
    IF jsonb_array_length(v_rel_items) > 0 THEN
      v_order_json := v_order_json || jsonb_build_object('items', v_rel_items);
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'statusCode', 200,
      'alreadyCancelled', true,
      'deduplicated', true,
      'stockRestored', false,
      'restoredItemsCount', 0,
      'restoredItems', '[]'::jsonb,
      'refund', jsonb_build_object(
        'amount', v_existing_credits_total,
        'creditedNow', 0,
        'walletUsed', CASE WHEN v_existing_credits_total > 0 THEN greatest(0, coalesce((v_existing_meta->>'walletUsedRefund')::numeric, 0)) ELSE 0 END,
        'onlinePaid', CASE WHEN v_existing_credits_total > 0 THEN greatest(0, coalesce((v_existing_meta->>'onlinePaidRefund')::numeric, 0)) ELSE 0 END,
        'codPaid', CASE WHEN v_existing_credits_total > 0 THEN greatest(0, coalesce((v_existing_meta->>'codPaidRefund')::numeric, 0)) ELSE 0 END,
        'refunded', (v_existing_credits_total > 0),
        'newWalletBalance', coalesce(v_first_credit_bal, (v_existing_meta->>'newWalletBalance')::numeric, 0),
        'ledgerTransactionId', v_first_credit_id,
        'description', v_first_credit_desc
      ),
      'order', v_order_json
    );
  END IF;

  -- 5. Enforce 15-minute cancellation window strictly for CUSTOMER using server timestamp
  IF v_actor_role = 'CUSTOMER' THEN
    IF v_order.created_at IS NULL
       OR (EXTRACT(EPOCH FROM (v_now - v_order.created_at)) * 1000.0) > 900000.0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'The 15-minute cancellation window for this order has expired.'
      );
    END IF;
  END IF;

  -- 6. Authoritative Stock Restoration Plan (strictly from DB COD_META, zero partial restoration allowed)
  v_should_restore_stock :=
    coalesce((v_existing_meta->>'stockDeducted')::boolean, false) IS TRUE
    AND coalesce((v_existing_meta->>'stockRestored')::boolean, false) IS FALSE;

  IF jsonb_array_length(v_rel_items) > 0 THEN
    v_authoritative_items := v_rel_items;
  ELSIF jsonb_typeof(v_existing_meta->'items') = 'array'
        AND jsonb_array_length(v_existing_meta->'items') > 0 THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'productId', coalesce(it->>'productId', it->>'product_id'),
            'variantId', coalesce(it->>'variantId', it->>'product_variant_id'),
            'productName', coalesce(NULLIF(it->>'productName', ''), NULLIF(it->>'product_name', ''), 'Grocery Item'),
            'variantName', coalesce(it->>'variantName', it->>'variant_name'),
            'unit', it->>'unit',
            'packSize', coalesce((it->>'packSize')::numeric, (it->>'pack_size')::numeric),
            'quantity', coalesce((it->>'quantity')::numeric, 0),
            'unitPrice', coalesce((it->>'unitPrice')::numeric, (it->>'unit_price')::numeric)
          )
        )
      ),
      '[]'::jsonb
    )
    INTO v_authoritative_items
    FROM jsonb_array_elements(v_existing_meta->'items') AS it;
  ELSE
    v_authoritative_items := public._parse_legacy_product_name_lines(to_jsonb(v_order)->>'Product Name');
  END IF;

  -- Detect optional schema columns dynamically
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock'
  ) INTO v_prod_has_stock;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock_quantity'
  ) INTO v_prod_has_stock_qty;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'wholesale_tier_discount'
  ) INTO v_prod_has_wtd;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'updated_at'
  ) INTO v_prod_has_updated_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone_normalized'
  ) INTO v_user_has_phone_norm;

  IF v_should_restore_stock THEN
    IF v_authoritative_items IS NULL OR jsonb_array_length(v_authoritative_items) = 0 THEN
      RAISE EXCEPTION 'Stock restoration aborted for order %: no order items found to restore.', v_order.id
        USING ERRCODE = 'P0003';
    END IF;

    -- Collect candidate product/variant IDs to lock
    SELECT coalesce(array_agg(DISTINCT it->>'productId'), ARRAY[]::TEXT[])
    INTO v_explicit_prod_ids
    FROM jsonb_array_elements(v_authoritative_items) AS it
    WHERE NULLIF(btrim(coalesce(it->>'productId', '')), '') IS NOT NULL;

    SELECT coalesce(array_agg(DISTINCT it->>'variantId'), ARRAY[]::TEXT[])
    INTO v_explicit_var_ids
    FROM jsonb_array_elements(v_authoritative_items) AS it
    WHERE NULLIF(btrim(coalesce(it->>'variantId', '')), '') IS NOT NULL;

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_authoritative_items) AS it
      WHERE NULLIF(btrim(coalesce(it->>'productId', '')), '') IS NULL
        AND NULLIF(btrim(coalesce(it->>'variantId', '')), '') IS NULL
    ) INTO v_needs_full_catalog;

    IF v_needs_full_catalog OR (cardinality(v_explicit_prod_ids) = 0 AND cardinality(v_explicit_var_ids) = 0) THEN
      SELECT coalesce(array_agg(id ORDER BY id ASC), ARRAY[]::TEXT[])
      INTO v_lock_prod_ids
      FROM public.products;
    ELSE
      SELECT coalesce(array_agg(DISTINCT pid ORDER BY pid ASC), ARRAY[]::TEXT[])
      INTO v_lock_prod_ids
      FROM (
        SELECT unnest(v_explicit_prod_ids) AS pid
        UNION
        SELECT pv.product_id AS pid
        FROM public.product_variants pv
        WHERE pv.id = ANY(v_explicit_var_ids)
      ) sub
      WHERE pid IS NOT NULL;
    END IF;

    -- Lock products & variants strictly in ascending ID order (deadlock-free)
    IF cardinality(v_lock_prod_ids) > 0 THEN
      FOR v_prod_rec IN
        SELECT p.id
        FROM public.products p
        WHERE p.id = ANY(v_lock_prod_ids)
        ORDER BY p.id ASC
        FOR UPDATE
      LOOP
        NULL;
      END LOOP;

      SELECT coalesce(array_agg(pv.id ORDER BY pv.id ASC), ARRAY[]::TEXT[])
      INTO v_lock_var_ids
      FROM public.product_variants pv
      WHERE pv.product_id = ANY(v_lock_prod_ids);

      IF cardinality(v_lock_var_ids) > 0 THEN
        FOR v_var_rec IN
          SELECT pv.id
          FROM public.product_variants pv
          WHERE pv.id = ANY(v_lock_var_ids)
          ORDER BY pv.id ASC
          FOR UPDATE
        LOOP
          NULL;
        END LOOP;
      END IF;

      -- Re-read authoritative locked product & variant data
      FOR v_prod_rec IN
        SELECT p.id, to_jsonb(p) AS row_json
        FROM public.products p
        WHERE p.id = ANY(v_lock_prod_ids)
        ORDER BY p.id ASC
      LOOP
        v_p_json := v_prod_rec.row_json;

        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'source', 'relational',
              'id', pv.id,
              'productId', pv.product_id,
              'unit', coalesce(NULLIF(pv.unit, ''), 'KG'),
              'packSize', coalesce((to_jsonb(pv)->>'pack_size')::numeric, (to_jsonb(pv)->>'weight_per_unit_kg')::numeric, 1),
              'packLabel', coalesce(NULLIF(pv.pack_label, ''), coalesce((to_jsonb(pv)->>'pack_size')::text, '1') || ' ' || coalesce(NULLIF(pv.unit, ''), 'KG')),
              'baseSellingPrice', coalesce(pv.base_selling_price, 0),
              'mrp', coalesce(pv.mrp, 0),
              'stockQuantity', greatest(0, coalesce(pv.stock_quantity, 0))
            )
            ORDER BY pv.id ASC
          ),
          '[]'::jsonb
        )
        INTO v_rel_vars
        FROM public.product_variants pv
        WHERE pv.product_id = v_prod_rec.id;

        IF jsonb_array_length(v_rel_vars) = 0
           AND public._has_embedded_variant_shape(v_p_json->'wholesale_tier_discount') THEN
          v_emb_vars := '[]'::jsonb;
          v_idx := 0;
          FOR v_emb_elem IN SELECT value FROM jsonb_array_elements(v_p_json->'wholesale_tier_discount')
          LOOP
            v_idx := v_idx + 1;
            IF jsonb_typeof(v_emb_elem) = 'object' THEN
              v_emb_vars := v_emb_vars || jsonb_build_array(
                jsonb_build_object(
                  'source', 'embedded',
                  'id', coalesce(NULLIF(v_emb_elem->>'id', ''), 'var_' || v_prod_rec.id || '_' || v_idx),
                  'productId', v_prod_rec.id,
                  'unit', coalesce(NULLIF(v_emb_elem->>'unit', ''), 'KG'),
                  'packSize', coalesce((v_emb_elem->>'packSize')::numeric, (v_emb_elem->>'pack_size')::numeric, 1),
                  'packLabel', coalesce(
                    NULLIF(v_emb_elem->>'packLabel', ''),
                    NULLIF(v_emb_elem->>'pack_label', ''),
                    coalesce(v_emb_elem->>'packSize', v_emb_elem->>'pack_size', '1') || ' ' || coalesce(NULLIF(v_emb_elem->>'unit', ''), 'KG')
                  ),
                  'baseSellingPrice', coalesce((v_emb_elem->>'baseSellingPrice')::numeric, (v_emb_elem->>'base_selling_price')::numeric, (v_p_json->>'price')::numeric, 0),
                  'mrp', coalesce((v_emb_elem->>'mrp')::numeric, (v_p_json->>'mrp')::numeric, 0),
                  'stockQuantity', greatest(0, coalesce((v_emb_elem->>'stockQuantity')::numeric, (v_emb_elem->>'stock_quantity')::numeric, (v_p_json->>'stock')::numeric, 0))
                )
              );
            END IF;
          END LOOP;
          v_rel_vars := v_emb_vars;
        END IF;

        v_catalog := v_catalog || jsonb_build_array(
          jsonb_build_object(
            'row', v_p_json,
            'variants', v_rel_vars
          )
        );
      END LOOP;
    END IF;

    -- Pass 1: Strictly resolve EVERY item to its Product & Variant BEFORE applying ANY stock update.
    -- If ANY item fails to match or has invalid quantity, abort and roll back the entire transaction.
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_authoritative_items)
    LOOP
      v_item_qty := coalesce((v_item->>'quantity')::numeric, 0);
      IF v_item_qty < 0 THEN
        RAISE EXCEPTION 'Stock restoration aborted: negative quantity (%) in order %', v_item_qty, v_order.id
          USING ERRCODE = 'P0003';
      END IF;
      IF v_item_qty = 0 THEN
        CONTINUE;
      END IF;

      v_item_prod_id := NULLIF(btrim(coalesce(v_item->>'productId', '')), '');
      v_item_var_id := NULLIF(btrim(coalesce(v_item->>'variantId', '')), '');
      v_item_prod_name := coalesce(v_item->>'productName', '');
      v_item_var_name := NULLIF(btrim(coalesce(v_item->>'variantName', '')), '');
      v_item_unit := NULLIF(btrim(coalesce(v_item->>'unit', '')), '');
      v_item_pack_size := CASE WHEN NULLIF(v_item->>'packSize', '') IS NOT NULL THEN (v_item->>'packSize')::numeric ELSE NULL END;
      v_item_unit_price := CASE WHEN NULLIF(v_item->>'unitPrice', '') IS NOT NULL THEN (v_item->>'unitPrice')::numeric ELSE NULL END;

      v_matched_prod := NULL;
      v_matched_var := NULL;

      IF v_item_prod_id IS NOT NULL THEN
        SELECT c INTO v_matched_prod
        FROM jsonb_array_elements(v_catalog) AS c
        WHERE c->'row'->>'id' = v_item_prod_id
        LIMIT 1;
      ELSIF v_item_var_id IS NOT NULL THEN
        SELECT c INTO v_matched_prod
        FROM jsonb_array_elements(v_catalog) AS c
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(c->'variants') AS v
          WHERE v->>'id' = v_item_var_id
        )
        LIMIT 1;
      ELSIF btrim(v_item_prod_name) <> '' THEN
        v_raw_search := lower(btrim(v_item_prod_name));
        v_stripped_search := btrim(regexp_replace(v_raw_search, '\s*\([^)]+\)', '', 'g'));

        SELECT c INTO v_matched_prod
        FROM jsonb_array_elements(v_catalog) AS c
        WHERE lower(btrim(coalesce(c->'row'->>'name', ''))) = v_raw_search
           OR (v_stripped_search <> '' AND lower(btrim(coalesce(c->'row'->>'name', ''))) = v_stripped_search)
        LIMIT 1;

        IF v_matched_prod IS NULL THEN
          SELECT c INTO v_matched_prod
          FROM jsonb_array_elements(v_catalog) AS c
          WHERE btrim(coalesce(c->'row'->>'name', '')) <> ''
            AND (
              position(lower(btrim(c->'row'->>'name')) IN v_raw_search) > 0
              OR position(v_raw_search IN lower(btrim(c->'row'->>'name'))) > 0
              OR (
                v_stripped_search <> '' AND (
                  position(lower(btrim(c->'row'->>'name')) IN v_stripped_search) > 0
                  OR position(v_stripped_search IN lower(btrim(c->'row'->>'name'))) > 0
                )
              )
            )
          LIMIT 1;
        END IF;
      END IF;

      IF v_matched_prod IS NULL THEN
        RAISE EXCEPTION 'Stock restoration aborted for order %: product "%" (id=%) not found in catalog.',
          v_order.id, coalesce(NULLIF(v_item_prod_name, ''), 'Unknown'), coalesce(v_item_prod_id, '<none>')
          USING ERRCODE = 'P0003';
      END IF;

      v_expected_restore_qty := v_expected_restore_qty + v_item_qty;
      v_expected_restore_ops := v_expected_restore_ops + 1;

      IF jsonb_array_length(v_matched_prod->'variants') = 0 THEN
        IF v_item_var_id IS NOT NULL THEN
          RAISE EXCEPTION 'Stock restoration aborted for order %: explicit variant "%" not found on variant-less product "%".',
            v_order.id, v_item_var_id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
        IF NOT v_prod_has_stock AND NOT v_prod_has_stock_qty THEN
          RAISE EXCEPTION 'Stock restoration aborted for order %: products table lacks stock columns for variant-less product "%".',
            v_order.id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
        v_delta_key := v_matched_prod->'row'->>'id';
        v_prod_deltas := jsonb_set(
          v_prod_deltas,
          ARRAY[v_delta_key],
          to_jsonb(coalesce((v_prod_deltas->>v_delta_key)::numeric, 0) + v_item_qty),
          true
        );
        CONTINUE;
      END IF;

      -- Product has variants: resolve matching variant strictly
      IF v_item_var_id IS NOT NULL THEN
        SELECT v INTO v_matched_var
        FROM jsonb_array_elements(v_matched_prod->'variants') AS v
        WHERE v->>'id' = v_item_var_id
        LIMIT 1;

        IF v_matched_var IS NULL THEN
          RAISE EXCEPTION 'Stock restoration aborted for order %: variant "%" not found for product "%".',
            v_order.id, v_item_var_id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
      ELSE
        IF v_item_var_name IS NOT NULL THEN
          v_search_v_name := lower(v_item_var_name);
          SELECT v INTO v_matched_var
          FROM jsonb_array_elements(v_matched_prod->'variants') AS v
          WHERE lower(btrim(coalesce(v->>'packLabel', ''))) = v_search_v_name
          LIMIT 1;
        END IF;

        IF v_matched_var IS NULL AND v_item_unit IS NOT NULL AND v_item_pack_size IS NOT NULL THEN
          SELECT v INTO v_matched_var
          FROM jsonb_array_elements(v_matched_prod->'variants') AS v
          WHERE upper(coalesce(v->>'unit', '')) = upper(v_item_unit)
            AND coalesce((v->>'packSize')::numeric, 0) = v_item_pack_size
          LIMIT 1;
        END IF;

        IF v_matched_var IS NULL THEN
          v_combined_search := lower(coalesce(v_item_prod_name, '') || ' ' || coalesce(v_item_var_name, ''));
          SELECT v INTO v_matched_var
          FROM jsonb_array_elements(v_matched_prod->'variants') AS v
          WHERE (btrim(coalesce(v->>'packLabel', '')) <> '' AND position(lower(btrim(v->>'packLabel')) IN v_combined_search) > 0)
             OR (position(lower((v->>'packSize') || ' ' || (v->>'unit')) IN v_combined_search) > 0)
             OR (position(lower((v->>'packSize') || (v->>'unit')) IN v_combined_search) > 0)
          LIMIT 1;
        END IF;

        IF v_matched_var IS NULL AND v_item_unit_price IS NOT NULL THEN
          IF (
            SELECT count(*) FROM jsonb_array_elements(v_matched_prod->'variants') AS v
            WHERE coalesce((v->>'baseSellingPrice')::numeric, 0) = v_item_unit_price
               OR coalesce((v->>'mrp')::numeric, 0) = v_item_unit_price
          ) = 1 THEN
            SELECT v INTO v_matched_var
            FROM jsonb_array_elements(v_matched_prod->'variants') AS v
            WHERE coalesce((v->>'baseSellingPrice')::numeric, 0) = v_item_unit_price
               OR coalesce((v->>'mrp')::numeric, 0) = v_item_unit_price
            LIMIT 1;
          END IF;
        END IF;

        v_has_explicit_var := (
          v_item_var_id IS NOT NULL
          OR v_item_var_name IS NOT NULL
          OR (v_item_unit IS NOT NULL AND v_item_pack_size IS NOT NULL)
        );

        IF v_matched_var IS NULL AND jsonb_array_length(v_matched_prod->'variants') = 1 AND NOT v_has_explicit_var THEN
          v_matched_var := (v_matched_prod->'variants')->0;
        END IF;
      END IF;

      IF v_matched_var IS NULL THEN
        RAISE EXCEPTION 'Stock restoration aborted for order %: could not uniquely match variant for product "%" (variantName=%).',
          v_order.id, coalesce(v_matched_prod->'row'->>'name', 'Product'), coalesce(v_item_var_name, '<none>')
          USING ERRCODE = 'P0003';
      END IF;

      v_delta_key := (v_matched_prod->'row'->>'id') || ':::' || (v_matched_var->>'id');
      v_var_deltas := jsonb_set(
        v_var_deltas,
        ARRAY[v_delta_key],
        to_jsonb(coalesce((v_var_deltas->>v_delta_key)::numeric, 0) + v_item_qty),
        true
      );
      IF NOT ((v_matched_prod->'row'->>'id') = ANY(v_touched_prod_ids)) THEN
        v_touched_prod_ids := array_append(v_touched_prod_ids, v_matched_prod->'row'->>'id');
      END IF;
    END LOOP;

    IF v_expected_restore_ops = 0 OR v_expected_restore_qty <= 0 THEN
      RAISE EXCEPTION 'Stock restoration aborted for order %: no positive-quantity items resolved.', v_order.id
        USING ERRCODE = 'P0003';
    END IF;

    -- Pass 2: Apply ALL variant & product stock restorations atomically (ordered by ID)
    FOR v_prod_rec IN
      SELECT c
      FROM jsonb_array_elements(v_catalog) AS c
      ORDER BY (c->'row'->>'id') ASC
    LOOP
      v_p_json := v_prod_rec.c->'row';
      v_ev_id := v_p_json->>'id';

      -- Variant-backed product
      IF v_ev_id = ANY(v_touched_prod_ids) THEN
        v_next_total_stock := 0;
        v_emb_expected_qty := 0;

        FOR v_matched_var IN
          SELECT v FROM jsonb_array_elements(v_prod_rec.c->'variants') AS v
        LOOP
          v_delta_key := v_ev_id || ':::' || (v_matched_var->>'id');
          v_delta_qty := coalesce((v_var_deltas->>v_delta_key)::numeric, 0);
          v_prev_stock := coalesce((v_matched_var->>'stockQuantity')::numeric, 0);
          v_next_stock := v_prev_stock + v_delta_qty;
          v_next_total_stock := v_next_total_stock + v_next_stock;

          IF v_delta_qty > 0 THEN
            IF (v_matched_var->>'source') = 'relational' THEN
              UPDATE public.product_variants
              SET stock_quantity = round(v_next_stock)::integer,
                  updated_at = v_now
              WHERE id = (v_matched_var->>'id');

              GET DIAGNOSTICS v_row_count = ROW_COUNT;
              IF v_row_count <> 1 THEN
                RAISE EXCEPTION 'Atomic stock restoration failed for product_variant % (updated % rows)', (v_matched_var->>'id'), v_row_count
                  USING ERRCODE = 'P0003';
              END IF;
            ELSE
              v_emb_expected_qty := v_emb_expected_qty + v_delta_qty;
            END IF;

            v_applied_restore_qty := v_applied_restore_qty + v_delta_qty;
            v_applied_restore_ops := v_applied_restore_ops + 1;
            v_restored_items_summary := v_restored_items_summary || jsonb_build_array(
              jsonb_build_object(
                'productId', v_ev_id,
                'variantId', v_matched_var->>'id',
                'productName', coalesce(NULLIF(v_p_json->>'name', ''), 'Product'),
                'variantLabel', v_matched_var->>'packLabel',
                'quantityRestored', v_delta_qty,
                'previousStock', v_prev_stock,
                'newStock', v_next_stock
              )
            );
          END IF;
        END LOOP;

        v_prev_wtd := v_p_json->'wholesale_tier_discount';
        v_next_wtd := v_prev_wtd;
        v_emb_applied_qty := 0;
        IF v_prod_has_wtd AND v_prev_wtd IS NOT NULL AND jsonb_typeof(v_prev_wtd) = 'array' THEN
          v_next_wtd := '[]'::jsonb;
          v_idx := 0;
          FOR v_wtd_item IN SELECT value FROM jsonb_array_elements(v_prev_wtd)
          LOOP
            v_idx := v_idx + 1;
            IF jsonb_typeof(v_wtd_item) = 'object' THEN
              v_delta_key := v_ev_id || ':::' || coalesce(NULLIF(v_wtd_item->>'id', ''), 'var_' || v_ev_id || '_' || v_idx);
              v_delta_qty := coalesce((v_var_deltas->>v_delta_key)::numeric, 0);
              IF v_delta_qty > 0 THEN
                v_cur_ev_stock := greatest(0, coalesce((v_wtd_item->>'stockQuantity')::numeric, (v_wtd_item->>'stock_quantity')::numeric, 0));
                v_upd_ev_stock := v_cur_ev_stock + v_delta_qty;
                v_wtd_item := jsonb_set(v_wtd_item, ARRAY['stockQuantity'], to_jsonb(v_upd_ev_stock), true);
                IF v_wtd_item ? 'stock_quantity' THEN
                  v_wtd_item := jsonb_set(v_wtd_item, ARRAY['stock_quantity'], to_jsonb(v_upd_ev_stock), true);
                END IF;
                v_emb_applied_qty := v_emb_applied_qty + v_delta_qty;
              END IF;
            END IF;
            v_next_wtd := v_next_wtd || jsonb_build_array(v_wtd_item);
          END LOOP;
        END IF;

        IF v_emb_expected_qty > 0 AND v_emb_applied_qty <> v_emb_expected_qty THEN
          RAISE EXCEPTION 'Atomic embedded-variant stock restoration mismatch for product %', v_ev_id
            USING ERRCODE = 'P0003';
        END IF;

        v_set_parts := ARRAY[]::TEXT[];
        IF v_prod_has_stock THEN
          v_set_parts := array_append(v_set_parts, 'stock = $1');
        END IF;
        IF v_prod_has_stock_qty THEN
          v_set_parts := array_append(v_set_parts, 'stock_quantity = $1');
        END IF;
        IF v_prod_has_wtd THEN
          v_set_parts := array_append(v_set_parts, 'wholesale_tier_discount = $2');
        END IF;
        IF v_prod_has_updated_at THEN
          v_set_parts := array_append(v_set_parts, 'updated_at = $3');
        END IF;

        IF cardinality(v_set_parts) > 0 THEN
          v_sql := 'UPDATE public.products SET ' || array_to_string(v_set_parts, ', ') || ' WHERE id = $4';
          EXECUTE v_sql USING round(v_next_total_stock)::integer, v_next_wtd, v_now, v_ev_id;
          GET DIAGNOSTICS v_row_count = ROW_COUNT;
          IF v_row_count <> 1 THEN
            RAISE EXCEPTION 'Atomic stock restoration failed for product % (updated % rows)', v_ev_id, v_row_count
              USING ERRCODE = 'P0003';
          END IF;
        END IF;
      END IF;

      -- Variant-less product
      IF v_prod_deltas ? v_ev_id THEN
        v_delta_qty := coalesce((v_prod_deltas->>v_ev_id)::numeric, 0);
        IF v_delta_qty > 0 THEN
          v_prev_stock := greatest(0, coalesce((v_p_json->>'stock_quantity')::numeric, (v_p_json->>'stock')::numeric, 0));
          v_next_stock := v_prev_stock + v_delta_qty;

          v_set_parts := ARRAY[]::TEXT[];
          IF v_prod_has_stock THEN
            v_set_parts := array_append(v_set_parts, 'stock = $1');
          END IF;
          IF v_prod_has_stock_qty THEN
            v_set_parts := array_append(v_set_parts, 'stock_quantity = $1');
          END IF;
          IF v_prod_has_updated_at THEN
            v_set_parts := array_append(v_set_parts, 'updated_at = $2');
          END IF;

          IF cardinality(v_set_parts) = 0 OR (NOT v_prod_has_stock AND NOT v_prod_has_stock_qty) THEN
            RAISE EXCEPTION 'Atomic stock restoration failed for variant-less product %: no stock column', v_ev_id
              USING ERRCODE = 'P0003';
          END IF;

          v_sql := 'UPDATE public.products SET ' || array_to_string(v_set_parts, ', ') || ' WHERE id = $3';
          EXECUTE v_sql USING round(v_next_stock)::integer, v_now, v_ev_id;
          GET DIAGNOSTICS v_row_count = ROW_COUNT;
          IF v_row_count <> 1 THEN
            RAISE EXCEPTION 'Atomic stock restoration failed for variant-less product % (updated % rows)', v_ev_id, v_row_count
              USING ERRCODE = 'P0003';
          END IF;

          v_applied_restore_qty := v_applied_restore_qty + v_delta_qty;
          v_applied_restore_ops := v_applied_restore_ops + 1;
          v_restored_items_summary := v_restored_items_summary || jsonb_build_array(
            jsonb_build_object(
              'productId', v_ev_id,
              'variantId', NULL,
              'productName', coalesce(NULLIF(v_p_json->>'name', ''), 'Product'),
              'quantityRestored', v_delta_qty,
              'previousStock', v_prev_stock,
              'newStock', v_next_stock
            )
          );
        END IF;
      END IF;
    END LOOP;

    IF v_applied_restore_qty <> v_expected_restore_qty OR v_applied_restore_ops = 0 THEN
      RAISE EXCEPTION 'Stock restoration aborted for order %: expected total qty %, restored %.',
        v_order.id, v_expected_restore_qty, v_applied_restore_qty
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- 7. Authoritative Server-Side Refund Calculation
  --    Strictly verified from public.ledger & authoritative DB payment flags (never inflated COD_META).
  FOR v_ledger_row IN
    SELECT id, type, amount, description, balance_after
    FROM public.ledger
    WHERE order_id = v_order.id
  LOOP
    IF v_ledger_row.type = 'DEBIT'
       AND public._is_wallet_ledger_entry(v_ledger_row.id, v_ledger_row.type, v_ledger_row.description) THEN
      v_ledger_wallet_debit_total := round(v_ledger_wallet_debit_total + greatest(0, coalesce(v_ledger_row.amount, 0)), 2);
    ELSIF v_ledger_row.type = 'CREDIT'
       AND public._is_wallet_ledger_entry(v_ledger_row.id, v_ledger_row.type, v_ledger_row.description) THEN
      v_already_credited := round(v_already_credited + greatest(0, coalesce(v_ledger_row.amount, 0)), 2);
      IF v_first_credit_id IS NULL THEN
        v_first_credit_id := v_ledger_row.id;
      END IF;
    END IF;
  END LOOP;

  -- Query authoritative COD collections in public.ledger (including FIFO COD_TX_META allocations)
  SELECT coalesce(
    sum(public._extract_cod_allocated_amount(v_order.id, l.order_id, l.amount, l.description)),
    0
  )
  INTO v_ledger_cod_collected
  FROM public.ledger l
  WHERE l.type = 'CREDIT'
    AND (
      l.id LIKE 'cod_tx_%'
      OR lower(coalesce(l.description, '')) LIKE '%cod payment%'
      OR lower(coalesce(l.description, '')) LIKE '%cod collection%'
    )
    AND (
      l.order_id = v_order.id
      OR position(v_order.id IN coalesce(l.description, '')) > 0
    );
  v_ledger_cod_collected := round(greatest(0, coalesce(v_ledger_cod_collected, 0)), 2);

  v_db_final_total := greatest(0, coalesce(v_order.final_total, v_order.subtotal, 0));
  v_payment_method_upper := upper(coalesce(v_order.payment_method, ''));
  v_payment_status_upper := upper(coalesce(v_order.payment_status, ''));
  v_has_razorpay_id := (NULLIF(btrim(coalesce(v_order.razorpay_payment_id, '')), '') IS NOT NULL);

  -- Online advance paid proof requires BOTH paid state (is_paid=true AND RECEIVED/PAID status, or razorpay_payment_id + paid signal)
  v_is_paid_order := (
    (coalesce(v_order.is_paid, false) IS TRUE AND v_payment_status_upper IN ('RECEIVED', 'PAID'))
    OR (v_has_razorpay_id AND (coalesce(v_order.is_paid, false) IS TRUE OR v_payment_status_upper IN ('RECEIVED', 'PAID')))
  );
  v_is_advance_method := v_payment_method_upper IN ('ADVANCE_ONLINE', 'ONLINE', 'UPI');

  v_cod_charge_val := greatest(0, coalesce((to_jsonb(v_order)->>'cod_charge')::numeric, (v_existing_meta->>'codCharge')::numeric, 0));
  v_base_computed_total := coalesce(v_order.subtotal, 0) - coalesce(v_order.discount_amount, 0) + v_cod_charge_val;

  -- Distinguish legacy net-of-wallet orders strictly without over-refunding small wallet debits (e.g., ₹1)
  v_is_final_net_of_wallet := (
    v_ledger_wallet_debit_total > 0
    AND v_order.subtotal IS NOT NULL
    AND abs(v_db_final_total - v_base_computed_total) >= 0.01
    AND abs(v_db_final_total - (v_base_computed_total - v_ledger_wallet_debit_total)) < 0.05
  );

  v_order_gross_cap := CASE
    WHEN v_is_final_net_of_wallet THEN round(v_db_final_total + v_ledger_wallet_debit_total, 2)
    ELSE round(v_db_final_total, 2)
  END;

  -- 7a. Authoritative Wallet Used = verified DEBIT entries in public.ledger (capped at gross total)
  v_wallet_used := round(greatest(0, least(v_ledger_wallet_debit_total, v_order_gross_cap)), 2);

  -- 7b. Authoritative Online Advance Refund (ONLY when DB payment proof is verified paid; never from COD_META alone)
  IF v_is_advance_method AND v_is_paid_order THEN
    v_online_paid := CASE
      WHEN v_is_final_net_of_wallet THEN round(greatest(0, least(v_db_final_total, v_order_gross_cap - v_wallet_used)), 2)
      ELSE round(greatest(0, least(v_order_gross_cap - v_wallet_used, v_db_final_total - v_wallet_used)), 2)
    END;
  ELSE
    v_online_paid := 0;
  END IF;

  -- 7c. Authoritative COD Refund (ONLY verified from COD ledger collection records, never from unverified COD_META.codCollected)
  IF NOT v_is_advance_method AND v_ledger_cod_collected > 0 THEN
    v_cod_paid := round(
      greatest(0, least(v_ledger_cod_collected, greatest(0, v_order_gross_cap - v_wallet_used - v_online_paid))),
      2
    );
  ELSE
    v_cod_paid := 0;
  END IF;

  v_total_refundable := round(least(v_order_gross_cap, v_wallet_used + v_online_paid + v_cod_paid), 2);
  v_amount_to_credit := CASE
    WHEN v_already_credited < v_total_refundable THEN round(greatest(0, v_total_refundable - v_already_credited), 2)
    ELSE 0
  END;

  v_clean_phone := public._normalize_indian_phone10(coalesce(NULLIF(v_order.customer_phone, ''), p_customer_phone, ''));
  v_customer_name := coalesce(NULLIF(btrim(coalesce(v_order.customer_name, '')), ''), 'Customer');

  IF v_total_refundable > 0 THEN
    IF v_wallet_used > 0 AND v_online_paid > 0 THEN
      v_refund_description := format('Refund for Cancelled Order #%s (₹%s wallet + ₹%s online advance)', v_resolved_order_number, v_wallet_used, v_online_paid);
    ELSIF v_wallet_used > 0 AND v_cod_paid > 0 THEN
      v_refund_description := format('Refund for Cancelled Order #%s (₹%s wallet + ₹%s COD paid)', v_resolved_order_number, v_wallet_used, v_cod_paid);
    ELSIF v_wallet_used > 0 THEN
      v_refund_description := format('Refund for Cancelled Order #%s (₹%s wallet used)', v_resolved_order_number, v_wallet_used);
    ELSIF v_cod_paid > 0 THEN
      v_refund_description := format('Refund for Cancelled Order #%s (₹%s COD payment)', v_resolved_order_number, v_cod_paid);
    ELSE
      v_refund_description := format('Refund for Cancelled Order #%s (₹%s online advance)', v_resolved_order_number, v_online_paid);
    END IF;

    -- Acquire deterministic transaction-scoped advisory wallet locks (canonical UID + phones) + user row lock
    v_phone_variants := public._indian_mobile_variants(v_clean_phone);

    IF v_order.customer_id IS NOT NULL
       AND v_order.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id, public._normalize_indian_phone10(phone)
      INTO v_pre_uid, v_pre_db_phone
      FROM public.users
      WHERE id = v_order.customer_id
      LIMIT 1;
    END IF;

    IF v_pre_uid IS NULL AND v_clean_phone <> '' AND v_user_has_phone_norm THEN
      EXECUTE 'SELECT id, public._normalize_indian_phone10(phone) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1'
      INTO v_pre_uid, v_pre_db_phone
      USING ('+91' || v_clean_phone);
    END IF;

    IF v_pre_uid IS NULL AND v_clean_phone <> '' THEN
      SELECT id, public._normalize_indian_phone10(phone)
      INTO v_pre_uid, v_pre_db_phone
      FROM public.users
      WHERE phone = ANY(v_phone_variants)
        AND role = 'CUSTOMER'
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_pre_uid IS NULL THEN
      SELECT l.customer_id
      INTO v_pre_uid
      FROM public.ledger l
      WHERE l.order_id = v_order.id
        AND l.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      LIMIT 1;

      IF v_pre_uid IS NOT NULL THEN
        SELECT public._normalize_indian_phone10(phone)
        INTO v_pre_db_phone
        FROM public.users
        WHERE id = v_pre_uid
        LIMIT 1;
      END IF;
    END IF;

    v_lock_uid := coalesce(
      NULLIF(v_pre_uid, ''),
      CASE WHEN v_order.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_order.customer_id ELSE NULL END
    );

    PERFORM public._acquire_customer_wallet_locks(
      v_lock_uid,
      ARRAY[v_clean_phone, v_pre_db_phone],
      coalesce(NULLIF(v_clean_phone, ''), NULLIF(v_order.customer_id, ''), v_order.id)
    );

    IF v_lock_uid IS NOT NULL THEN
      SELECT id, public._normalize_indian_phone10(phone), coalesce(wallet_balance, 0)
      INTO v_user_id, v_user_phone, v_user_wallet_bal
      FROM public.users
      WHERE id = v_lock_uid
      FOR UPDATE;
      v_user_found := FOUND;
    END IF;

    IF NOT v_user_found AND v_clean_phone <> '' AND v_user_has_phone_norm THEN
      EXECUTE 'SELECT id, public._normalize_indian_phone10(phone), coalesce(wallet_balance, 0) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1 FOR UPDATE'
      INTO v_user_id, v_user_phone, v_user_wallet_bal
      USING ('+91' || v_clean_phone);
      v_user_found := FOUND;
    END IF;

    IF NOT v_user_found AND v_clean_phone <> '' THEN
      SELECT id, public._normalize_indian_phone10(phone), coalesce(wallet_balance, 0)
      INTO v_user_id, v_user_phone, v_user_wallet_bal
      FROM public.users
      WHERE phone = ANY(v_phone_variants)
        AND role = 'CUSTOMER'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE;
      v_user_found := FOUND;
    END IF;

    SELECT coalesce(array_agg(DISTINCT aid), ARRAY[]::TEXT[])
    INTO v_alias_ids
    FROM unnest(
      ARRAY[
        v_user_id,
        NULLIF(v_order.customer_id, ''),
        NULLIF(p_customer_id, ''),
        NULLIF(v_clean_phone, ''),
        NULLIF(v_user_phone, ''),
        CASE WHEN v_clean_phone <> '' THEN 'user-' || v_clean_phone ELSE NULL END,
        CASE WHEN v_clean_phone <> '' THEN 'usr_' || v_clean_phone ELSE NULL END,
        CASE WHEN coalesce(v_user_phone, '') <> '' THEN 'user-' || v_user_phone ELSE NULL END,
        CASE WHEN coalesce(v_user_phone, '') <> '' THEN 'usr_' || v_user_phone ELSE NULL END
      ]
    ) AS aid
    WHERE aid IS NOT NULL AND aid <> '';

    v_current_wallet_balance := greatest(0, coalesce(v_user_wallet_bal, 0));

    IF cardinality(v_alias_ids) > 0 THEN
      FOR v_ledger_row IN
        SELECT id, type, amount, description
        FROM public.ledger
        WHERE customer_id = ANY(v_alias_ids)
        ORDER BY date ASC, id ASC
      LOOP
        IF public._is_wallet_ledger_entry(v_ledger_row.id, v_ledger_row.type, v_ledger_row.description) THEN
          IF v_ledger_row.type = 'CREDIT' THEN
            v_has_wallet_credit_rows := TRUE;
            v_running_bal := v_running_bal + coalesce(v_ledger_row.amount, 0);
          ELSIF v_ledger_row.type = 'DEBIT' THEN
            v_running_bal := greatest(0, v_running_bal - coalesce(v_ledger_row.amount, 0));
          END IF;
        END IF;
      END LOOP;

      IF v_has_wallet_credit_rows THEN
        v_current_wallet_balance := round(v_running_bal, 2);
      END IF;
    END IF;

    v_new_balance_after := round(v_current_wallet_balance + v_amount_to_credit, 2);

    IF v_amount_to_credit > 0 THEN
      v_ledger_tx_id := 'wtx_cancel_' || v_order.id;
      v_resolved_ledger_customer_id := coalesce(
        NULLIF(v_user_id, ''),
        NULLIF(v_order.customer_id, ''),
        NULLIF(p_customer_id, ''),
        CASE WHEN v_clean_phone <> '' THEN 'usr_' || v_clean_phone ELSE 'Customer' END
      );

      INSERT INTO public.ledger (
        id,
        customer_id,
        customer_name,
        order_id,
        date,
        type,
        amount,
        description,
        balance_after
      ) VALUES (
        v_ledger_tx_id,
        v_resolved_ledger_customer_id,
        v_customer_name,
        v_order.id,
        v_now,
        'CREDIT',
        v_amount_to_credit,
        coalesce(v_refund_description, format('Refund for Cancelled Order #%s', v_resolved_order_number)),
        v_new_balance_after
      );

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      IF v_row_count <> 1 THEN
        RAISE EXCEPTION 'Failed to insert wallet refund ledger row for order %', v_order.id;
      END IF;

      IF v_user_found AND v_user_id IS NOT NULL THEN
        UPDATE public.users
        SET wallet_balance = v_new_balance_after,
            updated_at = v_now
        WHERE id = v_user_id;

        GET DIAGNOSTICS v_row_count = ROW_COUNT;
        IF v_row_count <> 1 THEN
          RAISE EXCEPTION 'Failed to synchronize wallet balance for user % (updated % rows)', v_user_id, v_row_count;
        END IF;
      END IF;
    ELSE
      v_ledger_tx_id := v_first_credit_id;
    END IF;
  END IF;

  -- 8. Update order status, payment status & metadata atomically (last step inside same transaction)
  v_next_payment_status := CASE
    WHEN v_total_refundable > 0 THEN 'REFUNDED'
    ELSE coalesce(NULLIF(v_order.payment_status, ''), 'PENDING')
  END;

  v_final_meta := v_existing_meta || jsonb_build_object(
    'stockDeducted', false,
    'stockRestored', CASE
      WHEN v_should_restore_stock THEN true
      ELSE coalesce((v_existing_meta->>'stockRestored')::boolean, false)
    END,
    'cancelledAt', v_now,
    'cancelledByRole', v_actor_role
  );

  IF v_total_refundable > 0 THEN
    v_final_meta := v_final_meta || jsonb_build_object(
      'refundAmountCredited', v_total_refundable,
      'walletUsedRefund', v_wallet_used,
      'onlinePaidRefund', v_online_paid,
      'codPaidRefund', v_cod_paid,
      'newWalletBalance', CASE WHEN v_amount_to_credit > 0 THEN v_new_balance_after ELSE v_current_wallet_balance END
    );
  END IF;

  v_next_notes := format('Order #%s | COD_META:%s', v_resolved_order_number, v_final_meta::text);

  UPDATE public.orders
  SET status = 'CANCELLED',
      payment_status = v_next_payment_status,
      is_paid = false,
      notes = v_next_notes,
      updated_at = v_now
  WHERE id = v_order.id
    AND upper(coalesce(status, '')) <> 'CANCELLED'
  RETURNING * INTO v_updated_order;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to finalize cancellation update for order % (updated % rows)', v_order.id, v_row_count
      USING ERRCODE = 'P0001';
  END IF;

  v_order_json := to_jsonb(v_updated_order);
  IF jsonb_array_length(v_rel_items) > 0 THEN
    v_order_json := v_order_json || jsonb_build_object('items', v_rel_items);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'statusCode', 200,
    'alreadyCancelled', false,
    'stockRestored', (v_should_restore_stock AND jsonb_array_length(v_restored_items_summary) > 0),
    'restoredItemsCount', jsonb_array_length(v_restored_items_summary),
    'restoredItems', v_restored_items_summary,
    'refund', jsonb_build_object(
      'amount', v_total_refundable,
      'creditedNow', v_amount_to_credit,
      'walletUsed', v_wallet_used,
      'onlinePaid', v_online_paid,
      'codPaid', v_cod_paid,
      'refunded', (v_total_refundable > 0),
      'newWalletBalance', CASE WHEN v_amount_to_credit > 0 THEN v_new_balance_after ELSE v_current_wallet_balance END,
      'ledgerTransactionId', v_ledger_tx_id,
      'description', v_refund_description
    ),
    'order', v_order_json
  );
EXCEPTION
  WHEN SQLSTATE 'P0003' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 409, 'error', SQLERRM);
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 409, 'error', SQLERRM);
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 409, 'error', 'Duplicate refund or concurrent cancellation blocked.');
END;
$$;

-- 6. Unified Atomic Wallet Debit RPC (100% identical to supabase_order_creation_atomic_v2.sql)
CREATE OR REPLACE FUNCTION public.debit_wallet_for_order_atomic(
  p_order_id TEXT,
  p_order_number TEXT,
  p_customer_id TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_requested_amount NUMERIC,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_order_id TEXT := btrim(coalesce(p_order_id, ''));
  v_clean_phone TEXT := public._normalize_indian_phone10(p_customer_phone);
  v_phone_variants TEXT[] := public._indian_mobile_variants(v_clean_phone);
  v_user_has_phone_norm BOOLEAN := FALSE;
  v_pre_uid TEXT := NULL;
  v_pre_db_phone TEXT := NULL;
  v_pre_db_role TEXT := NULL;
  v_lock_uid TEXT := NULL;
  v_user_id TEXT := NULL;
  v_user_phone TEXT := NULL;
  v_user_status TEXT := 'ACTIVE';
  v_user_wallet_bal NUMERIC(12, 2) := 0;
  v_user_found BOOLEAN := FALSE;
  v_alias_ids TEXT[];
  v_existing_debit RECORD;
  v_ledger_row RECORD;
  v_has_wallet_credit_rows BOOLEAN := FALSE;
  v_running_bal NUMERIC(12, 2) := 0;
  v_current_balance NUMERIC(12, 2) := 0;
  v_debit_amount NUMERIC(12, 2);
  v_new_balance NUMERIC(12, 2) := 0;
  v_ledger_id TEXT;
  v_row_count INTEGER;
BEGIN
  IF v_order_id = '' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Order ID is required for wallet debit.'
    );
  END IF;

  IF p_requested_amount IS NULL OR p_requested_amount < 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Invalid negative wallet debit amount requested.'
    );
  END IF;

  v_debit_amount := round(p_requested_amount, 2);
  IF v_debit_amount <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'statusCode', 200,
      'debitedAmount', 0,
      'newWalletBalance', 0,
      'ledgerTransactionId', NULL
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone_normalized'
  ) INTO v_user_has_phone_norm;

  IF p_customer_id IS NOT NULL
     AND p_customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, public._normalize_indian_phone10(phone), upper(coalesce(role, 'CUSTOMER'))
    INTO v_pre_uid, v_pre_db_phone, v_pre_db_role
    FROM public.users
    WHERE id = p_customer_id
    LIMIT 1;

    IF FOUND AND (v_pre_db_role <> 'CUSTOMER' OR (v_clean_phone <> '' AND coalesce(v_pre_db_phone, '') <> '' AND v_pre_db_phone <> v_clean_phone)) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: Customer identity mismatch for wallet debit.'
      );
    END IF;
  END IF;

  IF v_pre_uid IS NULL AND v_clean_phone <> '' AND v_user_has_phone_norm THEN
    EXECUTE 'SELECT id, public._normalize_indian_phone10(phone) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1'
    INTO v_pre_uid, v_pre_db_phone
    USING ('+91' || v_clean_phone);
  END IF;

  IF v_pre_uid IS NULL AND v_clean_phone <> '' THEN
    SELECT id, public._normalize_indian_phone10(phone)
    INTO v_pre_uid, v_pre_db_phone
    FROM public.users
    WHERE phone = ANY(v_phone_variants)
      AND role = 'CUSTOMER'
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  v_lock_uid := coalesce(
    NULLIF(v_pre_uid, ''),
    CASE WHEN p_customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p_customer_id ELSE NULL END
  );

  PERFORM public._acquire_customer_wallet_locks(
    v_lock_uid,
    ARRAY[v_clean_phone, v_pre_db_phone],
    coalesce(NULLIF(v_clean_phone, ''), NULLIF(p_customer_id, ''), v_order_id)
  );

  IF v_clean_phone <> '' AND v_user_has_phone_norm THEN
    EXECUTE 'SELECT id, public._normalize_indian_phone10(phone), upper(coalesce(to_jsonb(users)->>''status'', ''ACTIVE'')), coalesce(wallet_balance, 0) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1 FOR UPDATE'
    INTO v_user_id, v_user_phone, v_user_status, v_user_wallet_bal
    USING ('+91' || v_clean_phone);
    v_user_found := FOUND;
  END IF;

  IF NOT v_user_found AND v_clean_phone <> '' THEN
    SELECT
      id,
      public._normalize_indian_phone10(phone),
      upper(coalesce(to_jsonb(u)->>'status', 'ACTIVE')),
      coalesce(wallet_balance, 0)
    INTO v_user_id, v_user_phone, v_user_status, v_user_wallet_bal
    FROM public.users u
    WHERE u.phone = ANY(v_phone_variants)
      AND u.role = 'CUSTOMER'
    ORDER BY u.created_at ASC
    LIMIT 1
    FOR UPDATE;
    v_user_found := FOUND;
  END IF;

  IF NOT v_user_found
     AND p_customer_id IS NOT NULL
     AND p_customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT
      id,
      public._normalize_indian_phone10(phone),
      upper(coalesce(to_jsonb(u)->>'status', 'ACTIVE')),
      coalesce(wallet_balance, 0)
    INTO v_user_id, v_user_phone, v_user_status, v_user_wallet_bal
    FROM public.users u
    WHERE u.id = p_customer_id
      AND u.role = 'CUSTOMER'
    FOR UPDATE;
    v_user_found := FOUND;

    IF v_user_found AND v_clean_phone <> '' AND coalesce(v_user_phone, '') <> '' AND v_user_phone <> v_clean_phone THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: Customer identity mismatch for wallet debit.'
      );
    END IF;
  END IF;

  IF v_user_found AND v_user_status NOT IN ('ACTIVE', '') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 403,
      'error', format('Customer account is %s and cannot use wallet.', lower(v_user_status))
    );
  END IF;

  -- Idempotency check if order debit already recorded
  SELECT id, amount, balance_after
  INTO v_existing_debit
  FROM public.ledger
  WHERE order_id = v_order_id
    AND type = 'DEBIT'
    AND id LIKE 'wtx_%'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'statusCode', 200,
      'deduplicated', true,
      'debitedAmount', v_existing_debit.amount,
      'newWalletBalance', v_existing_debit.balance_after,
      'ledgerTransactionId', v_existing_debit.id
    );
  END IF;

  SELECT coalesce(array_agg(DISTINCT aid), ARRAY[]::TEXT[])
  INTO v_alias_ids
  FROM unnest(
    ARRAY[
      v_user_id,
      NULLIF(p_customer_id, ''),
      NULLIF(v_clean_phone, ''),
      NULLIF(v_user_phone, ''),
      CASE WHEN v_clean_phone <> '' THEN 'user-' || v_clean_phone ELSE NULL END,
      CASE WHEN v_clean_phone <> '' THEN 'usr_' || v_clean_phone ELSE NULL END,
      CASE WHEN coalesce(v_user_phone, '') <> '' THEN 'user-' || v_user_phone ELSE NULL END,
      CASE WHEN coalesce(v_user_phone, '') <> '' THEN 'usr_' || v_user_phone ELSE NULL END
    ]
  ) AS aid
  WHERE aid IS NOT NULL AND aid <> '';

  v_current_balance := greatest(0, coalesce(v_user_wallet_bal, 0));

  IF cardinality(v_alias_ids) > 0 THEN
    FOR v_ledger_row IN
      SELECT id, type, amount, description
      FROM public.ledger
      WHERE customer_id = ANY(v_alias_ids)
      ORDER BY date ASC, id ASC
    LOOP
      IF public._is_wallet_ledger_entry(v_ledger_row.id, v_ledger_row.type, v_ledger_row.description) THEN
        IF v_ledger_row.type = 'CREDIT' THEN
          v_has_wallet_credit_rows := TRUE;
          v_running_bal := v_running_bal + coalesce(v_ledger_row.amount, 0);
        ELSIF v_ledger_row.type = 'DEBIT' THEN
          v_running_bal := greatest(0, v_running_bal - coalesce(v_ledger_row.amount, 0));
        END IF;
      END IF;
    END LOOP;

    IF v_has_wallet_credit_rows THEN
      v_current_balance := round(v_running_bal, 2);
    END IF;
  END IF;

  IF v_current_balance + 0.001 < v_debit_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'code', 'INSUFFICIENT_WALLET_BALANCE',
      'availableBalance', v_current_balance,
      'error', format('Insufficient live wallet balance (available ₹%s, requested ₹%s). Please refresh and retry.', v_current_balance, v_debit_amount)
    );
  END IF;

  v_new_balance := round(greatest(0, v_current_balance - v_debit_amount), 2);
  v_ledger_id := 'wtx_debit_' || v_order_id;

  INSERT INTO public.ledger (
    id,
    customer_id,
    customer_name,
    order_id,
    date,
    type,
    amount,
    description,
    balance_after
  ) VALUES (
    v_ledger_id,
    coalesce(NULLIF(v_user_id, ''), NULLIF(p_customer_id, ''), CASE WHEN v_clean_phone <> '' THEN 'usr_' || v_clean_phone ELSE 'Customer' END),
    coalesce(NULLIF(btrim(coalesce(p_customer_name, '')), ''), 'Customer'),
    v_order_id,
    v_now,
    'DEBIT',
    v_debit_amount,
    format('Wallet Applied on Order #%s', coalesce(NULLIF(p_order_number, ''), left(v_order_id, 8))),
    v_new_balance
  );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to insert wallet debit ledger row for order %', v_order_id;
  END IF;

  IF v_user_found AND v_user_id IS NOT NULL THEN
    UPDATE public.users
    SET wallet_balance = v_new_balance,
        updated_at = v_now
    WHERE id = v_user_id;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Failed to update user wallet_balance for user % (updated % rows)', v_user_id, v_row_count;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'statusCode', 200,
    'deduplicated', false,
    'debitedAmount', v_debit_amount,
    'newWalletBalance', v_new_balance,
    'ledgerTransactionId', v_ledger_id
  );
END;
$$;

-- 7. Atomic Shopkeeper Order Status & Mandatory-Complete Stock Deduction RPC (v2 Hardened)
CREATE OR REPLACE FUNCTION public.transition_order_status_atomic(
  p_order_id TEXT,
  p_new_status TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_is_paid BOOLEAN DEFAULT NULL,
  p_subtotal NUMERIC DEFAULT NULL,
  p_discount_amount NUMERIC DEFAULT NULL,
  p_final_total NUMERIC DEFAULT NULL,
  p_product_name_serialized TEXT DEFAULT NULL,
  p_weight_kg NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_delivered_at TIMESTAMPTZ DEFAULT NULL,
  p_deduct_stock BOOLEAN DEFAULT FALSE,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_raw_order_id TEXT := btrim(coalesce(p_order_id, ''));
  v_order public.orders%ROWTYPE;
  v_cur_status TEXT;
  v_target_status TEXT;

  v_parsed_existing JSONB;
  v_parsed_incoming JSONB;
  v_existing_meta JSONB;
  v_incoming_meta JSONB;
  v_sanitized_incoming_meta JSONB;
  v_merged_meta JSONB;
  v_resolved_num TEXT;

  v_next_payment_status TEXT;
  v_next_is_paid BOOLEAN;
  v_next_final_total NUMERIC(12, 2);
  v_next_notes TEXT;
  v_has_late_fee BOOLEAN := FALSE;

  v_already_deducted BOOLEAN := FALSE;
  v_rel_items JSONB := '[]'::jsonb;
  v_authoritative_items JSONB := '[]'::jsonb;
  v_prod_has_stock BOOLEAN := FALSE;
  v_prod_has_stock_qty BOOLEAN := FALSE;
  v_prod_has_wtd BOOLEAN := FALSE;
  v_prod_has_updated_at BOOLEAN := FALSE;

  v_explicit_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_explicit_var_ids TEXT[] := ARRAY[]::TEXT[];
  v_needs_full_catalog BOOLEAN := FALSE;
  v_lock_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_lock_var_ids TEXT[] := ARRAY[]::TEXT[];
  v_prod_rec RECORD;
  v_var_rec RECORD;
  v_catalog JSONB := '[]'::jsonb;
  v_p_json JSONB;
  v_rel_vars JSONB;
  v_emb_vars JSONB;
  v_emb_elem JSONB;
  v_idx INTEGER;

  v_item JSONB;
  v_item_prod_id TEXT;
  v_item_var_id TEXT;
  v_item_prod_name TEXT;
  v_item_var_name TEXT;
  v_item_unit TEXT;
  v_item_pack_size NUMERIC;
  v_item_qty NUMERIC;
  v_item_unit_price NUMERIC;
  v_expected_deduct_qty NUMERIC := 0;
  v_applied_deduct_qty NUMERIC := 0;
  v_expected_deduct_ops INTEGER := 0;
  v_applied_deduct_ops INTEGER := 0;

  v_matched_prod JSONB;
  v_matched_var JSONB;
  v_raw_search TEXT;
  v_stripped_search TEXT;
  v_search_v_name TEXT;
  v_combined_search TEXT;
  v_has_explicit_var BOOLEAN;

  v_var_deltas JSONB := '{}'::jsonb;
  v_prod_deltas JSONB := '{}'::jsonb;
  v_touched_prod_ids TEXT[] := ARRAY[]::TEXT[];
  v_delta_key TEXT;
  v_delta_qty NUMERIC;
  v_prev_stock NUMERIC;
  v_next_stock NUMERIC;
  v_next_total_stock NUMERIC;
  v_prev_wtd JSONB;
  v_next_wtd JSONB;
  v_wtd_item JSONB;
  v_ev_id TEXT;
  v_cur_ev_stock NUMERIC;
  v_upd_ev_stock NUMERIC;
  v_emb_expected_qty NUMERIC := 0;
  v_emb_applied_qty NUMERIC := 0;
  v_set_parts TEXT[];
  v_sql TEXT;
  v_row_count INTEGER;

  v_updated_order public.orders%ROWTYPE;
BEGIN
  IF v_raw_order_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 400, 'error', 'Order ID is required');
  END IF;

  IF (p_subtotal IS NOT NULL AND p_subtotal < 0)
     OR (p_discount_amount IS NOT NULL AND p_discount_amount < 0)
     OR (p_final_total IS NOT NULL AND p_final_total < 0)
     OR (p_weight_kg IS NOT NULL AND p_weight_kg < 0) THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 400, 'error', 'Invalid negative order numerical parameter.');
  END IF;

  IF upper(btrim(coalesce(p_new_status, ''))) = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'error', 'Cancellation transitions must be processed via cancel_order_atomic().'
    );
  END IF;

  IF v_raw_order_id LIKE 'OM-%' THEN
    SELECT * INTO v_order FROM public.orders WHERE order_number = v_raw_order_id FOR UPDATE;
  ELSE
    SELECT * INTO v_order FROM public.orders WHERE id = v_raw_order_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 404, 'error', 'Order not found.');
  END IF;

  v_cur_status := upper(coalesce(v_order.status, ''));
  v_target_status := upper(coalesce(NULLIF(btrim(p_new_status), ''), v_cur_status));

  IF v_cur_status = 'CANCELLED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'error', 'Order was already cancelled and cannot be updated.'
    );
  END IF;

  IF v_cur_status = 'DELIVERED' AND v_target_status IS DISTINCT FROM 'DELIVERED' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'error', 'Delivered orders cannot change fulfillment status.'
    );
  END IF;

  IF p_expected_updated_at IS NOT NULL AND v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'error', 'Order was updated concurrently. Please refresh and try again.'
    );
  END IF;

  v_parsed_existing := public._parse_cod_meta_from_notes(v_order.notes);
  v_existing_meta := coalesce(v_parsed_existing->'meta', '{}'::jsonb);
  v_already_deducted := coalesce((v_existing_meta->>'stockDeducted')::boolean, false);

  IF p_deduct_stock IS TRUE AND NOT v_already_deducted THEN
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productId', oi.product_id,
          'variantId', oi.product_variant_id,
          'productName', oi.product_name,
          'variantName', oi.variant_name,
          'unit', oi.unit,
          'packSize', coalesce(oi.pack_size, 1),
          'quantity', coalesce(oi.quantity, 1),
          'unitPrice', coalesce(oi.unit_price, 0)
        )
        ORDER BY oi.created_at ASC, oi.id ASC
      ),
      '[]'::jsonb
    )
    INTO v_rel_items
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    IF jsonb_array_length(v_rel_items) > 0 THEN
      v_authoritative_items := v_rel_items;
    ELSIF jsonb_typeof(v_existing_meta->'items') = 'array'
          AND jsonb_array_length(v_existing_meta->'items') > 0 THEN
      v_authoritative_items := v_existing_meta->'items';
    ELSE
      v_authoritative_items := public._parse_legacy_product_name_lines(to_jsonb(v_order)->>'Product Name');
    END IF;

    IF v_authoritative_items IS NULL OR jsonb_array_length(v_authoritative_items) = 0 THEN
      RAISE EXCEPTION 'Stock deduction aborted for order %: no order items found to deduct.', v_order.id
        USING ERRCODE = 'P0003';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock'
    ) INTO v_prod_has_stock;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock_quantity'
    ) INTO v_prod_has_stock_qty;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'wholesale_tier_discount'
    ) INTO v_prod_has_wtd;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'updated_at'
    ) INTO v_prod_has_updated_at;

    SELECT coalesce(array_agg(DISTINCT coalesce(it->>'productId', it->>'product_id')), ARRAY[]::TEXT[])
    INTO v_explicit_prod_ids
    FROM jsonb_array_elements(v_authoritative_items) AS it
    WHERE NULLIF(btrim(coalesce(it->>'productId', it->>'product_id', '')), '') IS NOT NULL;

    SELECT coalesce(array_agg(DISTINCT coalesce(it->>'variantId', it->>'product_variant_id')), ARRAY[]::TEXT[])
    INTO v_explicit_var_ids
    FROM jsonb_array_elements(v_authoritative_items) AS it
    WHERE NULLIF(btrim(coalesce(it->>'variantId', it->>'product_variant_id', '')), '') IS NOT NULL;

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_authoritative_items) AS it
      WHERE NULLIF(btrim(coalesce(it->>'productId', it->>'product_id', '')), '') IS NULL
        AND NULLIF(btrim(coalesce(it->>'variantId', it->>'product_variant_id', '')), '') IS NULL
    ) INTO v_needs_full_catalog;

    IF v_needs_full_catalog OR (cardinality(v_explicit_prod_ids) = 0 AND cardinality(v_explicit_var_ids) = 0) THEN
      SELECT coalesce(array_agg(id ORDER BY id ASC), ARRAY[]::TEXT[]) INTO v_lock_prod_ids FROM public.products;
    ELSE
      SELECT coalesce(array_agg(DISTINCT pid ORDER BY pid ASC), ARRAY[]::TEXT[])
      INTO v_lock_prod_ids
      FROM (
        SELECT unnest(v_explicit_prod_ids) AS pid
        UNION
        SELECT pv.product_id AS pid FROM public.product_variants pv WHERE pv.id = ANY(v_explicit_var_ids)
      ) sub
      WHERE pid IS NOT NULL;
    END IF;

    IF cardinality(v_lock_prod_ids) > 0 THEN
      FOR v_prod_rec IN
        SELECT id FROM public.products WHERE id = ANY(v_lock_prod_ids) ORDER BY id ASC FOR UPDATE
      LOOP NULL; END LOOP;

      SELECT coalesce(array_agg(pv.id ORDER BY pv.id ASC), ARRAY[]::TEXT[])
      INTO v_lock_var_ids
      FROM public.product_variants pv WHERE pv.product_id = ANY(v_lock_prod_ids);

      IF cardinality(v_lock_var_ids) > 0 THEN
        FOR v_var_rec IN
          SELECT id FROM public.product_variants WHERE id = ANY(v_lock_var_ids) ORDER BY id ASC FOR UPDATE
        LOOP NULL; END LOOP;
      END IF;

      FOR v_prod_rec IN
        SELECT p.id, to_jsonb(p) AS row_json FROM public.products p WHERE p.id = ANY(v_lock_prod_ids) ORDER BY p.id ASC
      LOOP
        v_p_json := v_prod_rec.row_json;
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'source', 'relational',
              'id', pv.id,
              'productId', pv.product_id,
              'unit', coalesce(NULLIF(pv.unit, ''), 'KG'),
              'packSize', coalesce((to_jsonb(pv)->>'pack_size')::numeric, (to_jsonb(pv)->>'weight_per_unit_kg')::numeric, 1),
              'packLabel', coalesce(NULLIF(pv.pack_label, ''), coalesce((to_jsonb(pv)->>'pack_size')::text, '1') || ' ' || coalesce(NULLIF(pv.unit, ''), 'KG')),
              'baseSellingPrice', coalesce(pv.base_selling_price, 0),
              'mrp', coalesce(pv.mrp, 0),
              'stockQuantity', greatest(0, coalesce(pv.stock_quantity, 0))
            )
            ORDER BY pv.id ASC
          ),
          '[]'::jsonb
        )
        INTO v_rel_vars
        FROM public.product_variants pv
        WHERE pv.product_id = v_prod_rec.id;

        IF jsonb_array_length(v_rel_vars) = 0
           AND public._has_embedded_variant_shape(v_p_json->'wholesale_tier_discount') THEN
          v_emb_vars := '[]'::jsonb;
          v_idx := 0;
          FOR v_emb_elem IN SELECT value FROM jsonb_array_elements(v_p_json->'wholesale_tier_discount')
          LOOP
            v_idx := v_idx + 1;
            IF jsonb_typeof(v_emb_elem) = 'object' THEN
              v_emb_vars := v_emb_vars || jsonb_build_array(
                jsonb_build_object(
                  'source', 'embedded',
                  'id', coalesce(NULLIF(v_emb_elem->>'id', ''), 'var_' || v_prod_rec.id || '_' || v_idx),
                  'productId', v_prod_rec.id,
                  'unit', coalesce(NULLIF(v_emb_elem->>'unit', ''), 'KG'),
                  'packSize', coalesce((v_emb_elem->>'packSize')::numeric, (v_emb_elem->>'pack_size')::numeric, 1),
                  'packLabel', coalesce(
                    NULLIF(v_emb_elem->>'packLabel', ''),
                    NULLIF(v_emb_elem->>'pack_label', ''),
                    coalesce(v_emb_elem->>'packSize', v_emb_elem->>'pack_size', '1') || ' ' || coalesce(NULLIF(v_emb_elem->>'unit', ''), 'KG')
                  ),
                  'baseSellingPrice', coalesce((v_emb_elem->>'baseSellingPrice')::numeric, (v_emb_elem->>'base_selling_price')::numeric, (v_p_json->>'price')::numeric, 0),
                  'mrp', coalesce((v_emb_elem->>'mrp')::numeric, (v_p_json->>'mrp')::numeric, 0),
                  'stockQuantity', greatest(0, coalesce((v_emb_elem->>'stockQuantity')::numeric, (v_emb_elem->>'stock_quantity')::numeric, (v_p_json->>'stock')::numeric, 0))
                )
              );
            END IF;
          END LOOP;
          v_rel_vars := v_emb_vars;
        END IF;

        v_catalog := v_catalog || jsonb_build_array(jsonb_build_object('row', v_p_json, 'variants', v_rel_vars));
      END LOOP;
    END IF;

    -- Pass 1: Strictly resolve EVERY item to its Product & Variant (fail closed if ANY fails)
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_authoritative_items)
    LOOP
      v_item_qty := coalesce((v_item->>'quantity')::numeric, 0);
      IF v_item_qty < 0 THEN
        RAISE EXCEPTION 'Stock deduction aborted: negative quantity (%) in order %', v_item_qty, v_order.id
          USING ERRCODE = 'P0003';
      END IF;
      IF v_item_qty = 0 THEN CONTINUE; END IF;

      v_item_prod_id := NULLIF(btrim(coalesce(v_item->>'productId', v_item->>'product_id', '')), '');
      v_item_var_id := NULLIF(btrim(coalesce(v_item->>'variantId', v_item->>'product_variant_id', '')), '');
      v_item_prod_name := coalesce(v_item->>'productName', v_item->>'product_name', '');
      v_item_var_name := NULLIF(btrim(coalesce(v_item->>'variantName', v_item->>'variant_name', '')), '');
      v_item_unit := NULLIF(btrim(coalesce(v_item->>'unit', '')), '');
      v_item_pack_size := CASE WHEN NULLIF(coalesce(v_item->>'packSize', v_item->>'pack_size'), '') IS NOT NULL THEN coalesce(v_item->>'packSize', v_item->>'pack_size')::numeric ELSE NULL END;
      v_item_unit_price := CASE WHEN NULLIF(coalesce(v_item->>'unitPrice', v_item->>'unit_price'), '') IS NOT NULL THEN coalesce(v_item->>'unitPrice', v_item->>'unit_price')::numeric ELSE NULL END;

      v_matched_prod := NULL;
      v_matched_var := NULL;

      IF v_item_prod_id IS NOT NULL THEN
        SELECT c INTO v_matched_prod FROM jsonb_array_elements(v_catalog) AS c WHERE c->'row'->>'id' = v_item_prod_id LIMIT 1;
      ELSIF v_item_var_id IS NOT NULL THEN
        SELECT c INTO v_matched_prod FROM jsonb_array_elements(v_catalog) AS c
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(c->'variants') AS v WHERE v->>'id' = v_item_var_id) LIMIT 1;
      ELSIF btrim(v_item_prod_name) <> '' THEN
        v_raw_search := lower(btrim(v_item_prod_name));
        v_stripped_search := btrim(regexp_replace(v_raw_search, '\s*\([^)]+\)', '', 'g'));
        SELECT c INTO v_matched_prod FROM jsonb_array_elements(v_catalog) AS c
        WHERE lower(btrim(coalesce(c->'row'->>'name', ''))) = v_raw_search
           OR (v_stripped_search <> '' AND lower(btrim(coalesce(c->'row'->>'name', ''))) = v_stripped_search)
        LIMIT 1;
      END IF;

      IF v_matched_prod IS NULL THEN
        RAISE EXCEPTION 'Stock deduction aborted for order %: product "%" (id=%) not found in catalog.',
          v_order.id, coalesce(NULLIF(v_item_prod_name, ''), 'Unknown'), coalesce(v_item_prod_id, '<none>')
          USING ERRCODE = 'P0003';
      END IF;

      v_expected_deduct_qty := v_expected_deduct_qty + v_item_qty;
      v_expected_deduct_ops := v_expected_deduct_ops + 1;

      IF jsonb_array_length(v_matched_prod->'variants') = 0 THEN
        IF v_item_var_id IS NOT NULL THEN
          RAISE EXCEPTION 'Stock deduction aborted for order %: explicit variant "%" not found on variant-less product "%".',
            v_order.id, v_item_var_id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
        IF NOT v_prod_has_stock AND NOT v_prod_has_stock_qty THEN
          RAISE EXCEPTION 'Stock deduction aborted for order %: products table lacks stock columns for variant-less product "%".',
            v_order.id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
        v_delta_key := v_matched_prod->'row'->>'id';
        v_prod_deltas := jsonb_set(v_prod_deltas, ARRAY[v_delta_key], to_jsonb(coalesce((v_prod_deltas->>v_delta_key)::numeric, 0) + v_item_qty), true);
        CONTINUE;
      END IF;

      -- Product has variants: resolve matching variant strictly
      IF v_item_var_id IS NOT NULL THEN
        SELECT v INTO v_matched_var FROM jsonb_array_elements(v_matched_prod->'variants') AS v WHERE v->>'id' = v_item_var_id LIMIT 1;
        IF v_matched_var IS NULL THEN
          RAISE EXCEPTION 'Stock deduction aborted for order %: variant "%" not found for product "%".',
            v_order.id, v_item_var_id, coalesce(v_matched_prod->'row'->>'name', 'Product')
            USING ERRCODE = 'P0003';
        END IF;
      ELSE
        IF v_item_var_name IS NOT NULL THEN
          v_search_v_name := lower(v_item_var_name);
          SELECT v INTO v_matched_var FROM jsonb_array_elements(v_matched_prod->'variants') AS v WHERE lower(btrim(coalesce(v->>'packLabel', ''))) = v_search_v_name LIMIT 1;
        END IF;
        IF v_matched_var IS NULL AND v_item_unit IS NOT NULL AND v_item_pack_size IS NOT NULL THEN
          SELECT v INTO v_matched_var FROM jsonb_array_elements(v_matched_prod->'variants') AS v
          WHERE upper(coalesce(v->>'unit', '')) = upper(v_item_unit) AND coalesce((v->>'packSize')::numeric, 0) = v_item_pack_size LIMIT 1;
        END IF;
        IF v_matched_var IS NULL THEN
          v_combined_search := lower(coalesce(v_item_prod_name, '') || ' ' || coalesce(v_item_var_name, ''));
          SELECT v INTO v_matched_var FROM jsonb_array_elements(v_matched_prod->'variants') AS v
          WHERE (btrim(coalesce(v->>'packLabel', '')) <> '' AND position(lower(btrim(v->>'packLabel')) IN v_combined_search) > 0)
             OR position(lower((v->>'packSize') || ' ' || (v->>'unit')) IN v_combined_search) > 0
             OR position(lower((v->>'packSize') || (v->>'unit')) IN v_combined_search) > 0
          LIMIT 1;
        END IF;
        IF v_matched_var IS NULL AND v_item_unit_price IS NOT NULL THEN
          IF (
            SELECT count(*) FROM jsonb_array_elements(v_matched_prod->'variants') AS v
            WHERE coalesce((v->>'baseSellingPrice')::numeric, 0) = v_item_unit_price
               OR coalesce((v->>'mrp')::numeric, 0) = v_item_unit_price
          ) = 1 THEN
            SELECT v INTO v_matched_var FROM jsonb_array_elements(v_matched_prod->'variants') AS v
            WHERE coalesce((v->>'baseSellingPrice')::numeric, 0) = v_item_unit_price
               OR coalesce((v->>'mrp')::numeric, 0) = v_item_unit_price
            LIMIT 1;
          END IF;
        END IF;

        v_has_explicit_var := (v_item_var_id IS NOT NULL OR v_item_var_name IS NOT NULL OR (v_item_unit IS NOT NULL AND v_item_pack_size IS NOT NULL));
        IF v_matched_var IS NULL AND jsonb_array_length(v_matched_prod->'variants') = 1 AND NOT v_has_explicit_var THEN
          v_matched_var := (v_matched_prod->'variants')->0;
        END IF;
      END IF;

      IF v_matched_var IS NULL THEN
        RAISE EXCEPTION 'Stock deduction aborted for order %: could not uniquely match variant for product "%" (variantName=%).',
          v_order.id, coalesce(v_matched_prod->'row'->>'name', 'Product'), coalesce(v_item_var_name, '<none>')
          USING ERRCODE = 'P0003';
      END IF;

      v_delta_key := (v_matched_prod->'row'->>'id') || ':::' || (v_matched_var->>'id');
      v_var_deltas := jsonb_set(v_var_deltas, ARRAY[v_delta_key], to_jsonb(coalesce((v_var_deltas->>v_delta_key)::numeric, 0) + v_item_qty), true);
      IF NOT ((v_matched_prod->'row'->>'id') = ANY(v_touched_prod_ids)) THEN
        v_touched_prod_ids := array_append(v_touched_prod_ids, v_matched_prod->'row'->>'id');
      END IF;
    END LOOP;

    IF v_expected_deduct_ops = 0 OR v_expected_deduct_qty <= 0 THEN
      RAISE EXCEPTION 'Stock deduction aborted for order %: no positive-quantity items resolved.', v_order.id
        USING ERRCODE = 'P0003';
    END IF;

    -- Pass 2: Apply ALL deductions atomically; ANY insufficient stock or failed update rolls back entire transaction
    FOR v_prod_rec IN
      SELECT c FROM jsonb_array_elements(v_catalog) AS c ORDER BY (c->'row'->>'id') ASC
    LOOP
      v_p_json := v_prod_rec.c->'row';
      v_ev_id := v_p_json->>'id';

      IF v_ev_id = ANY(v_touched_prod_ids) THEN
        v_next_total_stock := 0;
        v_emb_expected_qty := 0;

        FOR v_matched_var IN SELECT v FROM jsonb_array_elements(v_prod_rec.c->'variants') AS v
        LOOP
          v_delta_key := v_ev_id || ':::' || (v_matched_var->>'id');
          v_delta_qty := coalesce((v_var_deltas->>v_delta_key)::numeric, 0);
          v_prev_stock := coalesce((v_matched_var->>'stockQuantity')::numeric, 0);
          IF v_delta_qty > 0 AND v_prev_stock < v_delta_qty THEN
            RAISE EXCEPTION 'Insufficient stock for "% (%)" (available %, needed %)', coalesce(v_p_json->>'name', 'Product'), coalesce(v_matched_var->>'packLabel', 'Variant'), v_prev_stock, v_delta_qty
              USING ERRCODE = 'P0002';
          END IF;
          v_next_stock := greatest(0, v_prev_stock - v_delta_qty);
          v_next_total_stock := v_next_total_stock + v_next_stock;

          IF v_delta_qty > 0 THEN
            IF (v_matched_var->>'source') = 'relational' THEN
              UPDATE public.product_variants
              SET stock_quantity = round(v_next_stock)::integer, updated_at = v_now
              WHERE id = (v_matched_var->>'id');
              GET DIAGNOSTICS v_row_count = ROW_COUNT;
              IF v_row_count <> 1 THEN
                RAISE EXCEPTION 'Failed to deduct variant stock for % (updated % rows)', (v_matched_var->>'id'), v_row_count
                  USING ERRCODE = 'P0003';
              END IF;
            ELSE
              v_emb_expected_qty := v_emb_expected_qty + v_delta_qty;
            END IF;

            v_applied_deduct_qty := v_applied_deduct_qty + v_delta_qty;
            v_applied_deduct_ops := v_applied_deduct_ops + 1;
          END IF;
        END LOOP;

        v_prev_wtd := v_p_json->'wholesale_tier_discount';
        v_next_wtd := v_prev_wtd;
        v_emb_applied_qty := 0;
        IF v_prod_has_wtd AND v_prev_wtd IS NOT NULL AND jsonb_typeof(v_prev_wtd) = 'array' THEN
          v_next_wtd := '[]'::jsonb;
          v_idx := 0;
          FOR v_wtd_item IN SELECT value FROM jsonb_array_elements(v_prev_wtd)
          LOOP
            v_idx := v_idx + 1;
            IF jsonb_typeof(v_wtd_item) = 'object' THEN
              v_delta_key := v_ev_id || ':::' || coalesce(NULLIF(v_wtd_item->>'id', ''), 'var_' || v_ev_id || '_' || v_idx);
              v_delta_qty := coalesce((v_var_deltas->>v_delta_key)::numeric, 0);
              IF v_delta_qty > 0 THEN
                v_cur_ev_stock := greatest(0, coalesce((v_wtd_item->>'stockQuantity')::numeric, (v_wtd_item->>'stock_quantity')::numeric, 0));
                IF v_cur_ev_stock < v_delta_qty THEN
                  RAISE EXCEPTION 'Insufficient embedded variant stock for %', v_ev_id USING ERRCODE = 'P0002';
                END IF;
                v_upd_ev_stock := greatest(0, v_cur_ev_stock - v_delta_qty);
                v_wtd_item := jsonb_set(v_wtd_item, ARRAY['stockQuantity'], to_jsonb(v_upd_ev_stock), true);
                IF v_wtd_item ? 'stock_quantity' THEN
                  v_wtd_item := jsonb_set(v_wtd_item, ARRAY['stock_quantity'], to_jsonb(v_upd_ev_stock), true);
                END IF;
                v_emb_applied_qty := v_emb_applied_qty + v_delta_qty;
              END IF;
            END IF;
            v_next_wtd := v_next_wtd || jsonb_build_array(v_wtd_item);
          END LOOP;
        END IF;

        IF v_emb_expected_qty > 0 AND v_emb_applied_qty <> v_emb_expected_qty THEN
          RAISE EXCEPTION 'Failed to deduct embedded variant stock for product %', v_ev_id
            USING ERRCODE = 'P0003';
        END IF;

        v_set_parts := ARRAY[]::TEXT[];
        IF v_prod_has_stock THEN v_set_parts := array_append(v_set_parts, 'stock = $1'); END IF;
        IF v_prod_has_stock_qty THEN v_set_parts := array_append(v_set_parts, 'stock_quantity = $1'); END IF;
        IF v_prod_has_wtd THEN v_set_parts := array_append(v_set_parts, 'wholesale_tier_discount = $2'); END IF;
        IF v_prod_has_updated_at THEN v_set_parts := array_append(v_set_parts, 'updated_at = $3'); END IF;

        IF cardinality(v_set_parts) > 0 THEN
          v_sql := 'UPDATE public.products SET ' || array_to_string(v_set_parts, ', ') || ' WHERE id = $4';
          EXECUTE v_sql USING round(v_next_total_stock)::integer, v_next_wtd, v_now, v_ev_id;
          GET DIAGNOSTICS v_row_count = ROW_COUNT;
          IF v_row_count <> 1 THEN
            RAISE EXCEPTION 'Failed to update product stock for % (updated % rows)', v_ev_id, v_row_count
              USING ERRCODE = 'P0003';
          END IF;
        END IF;
      END IF;

      IF v_prod_deltas ? v_ev_id THEN
        v_delta_qty := coalesce((v_prod_deltas->>v_ev_id)::numeric, 0);
        IF v_delta_qty > 0 THEN
          v_prev_stock := greatest(0, coalesce((v_p_json->>'stock_quantity')::numeric, (v_p_json->>'stock')::numeric, 0));
          IF v_prev_stock < v_delta_qty THEN
            RAISE EXCEPTION 'Insufficient stock for "%" (available %, needed %)', coalesce(v_p_json->>'name', 'Product'), v_prev_stock, v_delta_qty
              USING ERRCODE = 'P0002';
          END IF;
          v_next_stock := greatest(0, v_prev_stock - v_delta_qty);

          v_set_parts := ARRAY[]::TEXT[];
          IF v_prod_has_stock THEN v_set_parts := array_append(v_set_parts, 'stock = $1'); END IF;
          IF v_prod_has_stock_qty THEN v_set_parts := array_append(v_set_parts, 'stock_quantity = $1'); END IF;
          IF v_prod_has_updated_at THEN v_set_parts := array_append(v_set_parts, 'updated_at = $2'); END IF;

          IF cardinality(v_set_parts) = 0 OR (NOT v_prod_has_stock AND NOT v_prod_has_stock_qty) THEN
            RAISE EXCEPTION 'Failed to deduct variant-less product stock for %: no stock column', v_ev_id
              USING ERRCODE = 'P0003';
          END IF;

          v_sql := 'UPDATE public.products SET ' || array_to_string(v_set_parts, ', ') || ' WHERE id = $3';
          EXECUTE v_sql USING round(v_next_stock)::integer, v_now, v_ev_id;
          GET DIAGNOSTICS v_row_count = ROW_COUNT;
          IF v_row_count <> 1 THEN
            RAISE EXCEPTION 'Failed to update variant-less product stock for % (updated % rows)', v_ev_id, v_row_count
              USING ERRCODE = 'P0003';
          END IF;

          v_applied_deduct_qty := v_applied_deduct_qty + v_delta_qty;
          v_applied_deduct_ops := v_applied_deduct_ops + 1;
        END IF;
      END IF;
    END LOOP;

    IF v_applied_deduct_qty <> v_expected_deduct_qty OR v_applied_deduct_ops = 0 THEN
      RAISE EXCEPTION 'Stock deduction aborted for order %: expected total qty %, deducted %.',
        v_order.id, v_expected_deduct_qty, v_applied_deduct_qty
        USING ERRCODE = 'P0003';
    END IF;

    -- Set true ONLY after 100% of items & quantities succeeded
    v_already_deducted := TRUE;
  END IF;

  -- Merge notes / COD_META safely: strip ALL protected financial, stock, late-fee & refund keys from incoming payload
  v_parsed_incoming := public._parse_cod_meta_from_notes(p_notes);
  v_incoming_meta := coalesce(v_parsed_incoming->'meta', '{}'::jsonb);
  v_sanitized_incoming_meta := v_incoming_meta - ARRAY[
    'walletAmountUsed',
    'previousOnlinePaid',
    'codCollected',
    'totalPayable',
    'prevOutstanding',
    'codCharge',
    'codLateFeeApplied',
    'codLateFeeAmount',
    'codLateFeeAppliedAt',
    'stockDeducted',
    'stockRestored',
    'refundAmountCredited',
    'walletUsedRefund',
    'onlinePaidRefund',
    'codPaidRefund',
    'newWalletBalance',
    'cancelledAt',
    'cancelledByRole',
    'deliveredAt'
  ];

  v_resolved_num := btrim(
    coalesce(
      NULLIF(v_order.order_number, ''),
      NULLIF(v_parsed_existing->>'orderNumber', ''),
      NULLIF(v_parsed_incoming->>'orderNumber', ''),
      left(regexp_replace(v_order.id, '^ord[-_]', '', 'i'), 8)
    )
  );

  v_merged_meta := v_existing_meta || v_sanitized_incoming_meta;

  IF v_already_deducted THEN
    v_merged_meta := v_merged_meta || jsonb_build_object('stockDeducted', true, 'stockRestored', false);
  END IF;

  IF v_target_status = 'DELIVERED' AND NULLIF(coalesce(v_merged_meta->>'deliveredAt', ''), '') IS NULL THEN
    v_merged_meta := v_merged_meta || jsonb_build_object('deliveredAt', coalesce(p_delivered_at, v_now));
  END IF;

  v_has_late_fee := (
    coalesce((to_jsonb(v_order)->>'cod_late_fee_applied')::boolean, false) IS TRUE
    OR coalesce((v_existing_meta->>'codLateFeeApplied')::boolean, false) IS TRUE
  );

  v_next_final_total := coalesce(p_final_total, v_order.final_total);
  IF v_has_late_fee AND v_order.final_total IS NOT NULL THEN
    v_next_final_total := v_order.final_total;
    v_merged_meta := v_merged_meta || jsonb_build_object('totalPayable', v_order.final_total);
  END IF;

  IF p_notes IS NOT NULL OR v_target_status = 'DELIVERED' OR p_deduct_stock IS TRUE THEN
    v_next_notes := format('Order #%s | COD_META:%s', v_resolved_num, v_merged_meta::text);
  ELSE
    v_next_notes := v_order.notes;
  END IF;

  v_next_payment_status := coalesce(NULLIF(btrim(p_payment_status), ''), v_order.payment_status);
  v_next_is_paid := v_order.is_paid;

  IF NULLIF(btrim(p_payment_status), '') IS NOT NULL THEN
    IF upper(p_payment_status) = 'RECEIVED' THEN
      v_next_is_paid := TRUE;
    ELSIF upper(p_payment_status) IN ('PENDING', 'REFUNDED', 'FAILED') THEN
      v_next_is_paid := FALSE;
    END IF;
  END IF;

  IF p_is_paid IS NOT NULL THEN
    v_next_is_paid := p_is_paid;
    IF p_is_paid IS TRUE AND NULLIF(btrim(p_payment_status), '') IS NULL THEN
      v_next_payment_status := 'RECEIVED';
    ELSIF p_is_paid IS FALSE AND NULLIF(btrim(p_payment_status), '') IS NULL THEN
      v_next_payment_status := 'PENDING';
    END IF;
  END IF;

  UPDATE public.orders
  SET status = coalesce(NULLIF(btrim(p_new_status), ''), status),
      payment_status = v_next_payment_status,
      is_paid = v_next_is_paid,
      subtotal = coalesce(p_subtotal, subtotal),
      discount_amount = coalesce(p_discount_amount, discount_amount),
      final_total = v_next_final_total,
      "Product Name" = coalesce(p_product_name_serialized, "Product Name"),
      weight_kg = coalesce(p_weight_kg, weight_kg),
      notes = v_next_notes,
      updated_at = v_now
  WHERE id = v_order.id
    AND upper(coalesce(status, '')) <> 'CANCELLED'
  RETURNING * INTO v_updated_order;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Order % was modified or cancelled concurrently', v_order.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'statusCode', 200,
    'stockDeducted', v_already_deducted,
    'order', to_jsonb(v_updated_order)
  );
EXCEPTION
  WHEN SQLSTATE 'P0002' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 400, 'error', SQLERRM);
  WHEN SQLSTATE 'P0003' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 409, 'error', SQLERRM);
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('ok', false, 'statusCode', 409, 'error', SQLERRM);
END;
$$;

-- 8. Restrict RPC & trigger function execution strictly to server-side service_role
REVOKE ALL ON FUNCTION public.prevent_cancelled_order_revival() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._normalize_indian_phone10(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._indian_mobile_variants(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._parse_cod_meta_from_notes(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_wallet_ledger_entry(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._parse_legacy_product_name_lines(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._has_embedded_variant_shape(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._extract_cod_allocated_amount(TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._acquire_customer_wallet_locks(TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cancel_order_atomic(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_wallet_for_order_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_order_status_atomic(TEXT, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.prevent_cancelled_order_revival() TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order_atomic(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_order_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_order_status_atomic(TEXT, TEXT, TEXT, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
