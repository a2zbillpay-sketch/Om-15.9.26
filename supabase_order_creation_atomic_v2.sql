-- ==============================================================================
-- Om Distributors - Atomic Order Creation, Line Items & Wallet Debit (v2 Hardened)
-- Version: v2 (supabase_order_creation_atomic_v2.sql)
-- ==============================================================================
-- Fixes & Hardening over v1:
--   1. Migration Pre-flight Guard: Verifies core tables exist, detects unexpected
--      overloaded RPC signatures, and aborts safely on duplicate wallet DEBITs
--      without altering existing data or dropping existing tables/indexes.
--   2. Strict Customer Ownership & Identity Verification:
--      - Rejects missing/invalid 10-digit Indian mobile session in CUSTOMER calls.
--      - Blocks cross-account UUID spoofing in create_order_with_wallet_atomic()
--        (verifies UUID customer row role='CUSTOMER', matching phone, active status).
--      - Hardens update_customer_phone_atomic() so caller MUST prove valid
--        p_session_phone matching the locked DB customer's current mobile number.
--   3. Strict Financial & Input Validation:
--      - Rejects negative subtotal/discount/delivery/cod/unitPrice/finalTotal values
--        instead of silently clamping them.
--      - Cross-checks p_subtotal against canonical item line totals when unit prices
--        are provided.
--      - Deduplicated retry path reads walletUsed from authoritative ledger DEBIT rows.
--   4. Shared Helpers, Advisory Locks & Signatures:
--      - Keeps identical signatures, lock ordering (_acquire_customer_wallet_locks),
--        debit_wallet_for_order_atomic(), and service_role-only GRANTs in sync with
--        supabase_order_cancellation_atomic_v2.sql.
--   5. Zero Impact on COD FIFO, COD Late Fee, RLS policies, or unrelated features.
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

  -- Prevent conflicting overloaded signatures for shared/upgraded RPCs
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid)
  INTO v_bad_overloads
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND (
      (p.proname = 'create_order_with_wallet_atomic' AND p.pronargs <> 27)
      OR (p.proname = 'update_customer_phone_atomic' AND p.pronargs <> 8)
      OR (p.proname = 'debit_wallet_for_order_atomic' AND p.pronargs <> 7)
      OR (p.proname = '_acquire_customer_wallet_locks' AND p.pronargs <> 3)
      OR (p.proname = '_normalize_indian_phone10' AND p.pronargs <> 1)
      OR (p.proname = '_indian_mobile_variants' AND p.pronargs <> 1)
      OR (p.proname = '_parse_cod_meta_from_notes' AND p.pronargs <> 1)
      OR (p.proname = '_is_wallet_ledger_entry' AND p.pronargs <> 3)
    );

  IF v_bad_overloads IS NOT NULL THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Conflicting overloaded function signature(s) found: %. Resolve manually to avoid PostgREST ambiguity.',
      v_bad_overloads;
  END IF;
END $$;

-- 2. Supporting ledger lookup & partial unique index for order wallet debits
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
      AND type = 'DEBIT'
      AND id LIKE 'wtx_%'
    GROUP BY order_id
    HAVING COUNT(*) > 1
  ) dups;

  IF coalesce(v_dup_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Found % order_id(s) with duplicate wallet DEBIT entries in public.ledger. Reconcile manually before creating unique index. Details: %',
      v_dup_count,
      v_dup_summary;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_order_debit
  ON public.ledger (order_id)
  WHERE order_id IS NOT NULL
    AND type = 'DEBIT'
    AND id LIKE 'wtx_%';

-- 3. Internal pure/stable helpers (100% identical to supabase_order_cancellation_atomic_v2.sql)
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

-- 4. Deadlock-free canonical wallet advisory lock helper (100% identical to cancellation v2)
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

-- 5. Atomic Order + Order Items + Wallet Debit RPC (Single PostgreSQL ACID Transaction)
CREATE OR REPLACE FUNCTION public.create_order_with_wallet_atomic(
  p_actor_role TEXT,
  p_session_customer_id TEXT DEFAULT NULL,
  p_session_phone TEXT DEFAULT NULL,
  p_order_id TEXT DEFAULT NULL,
  p_order_number TEXT DEFAULT NULL,
  p_customer_id TEXT DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_shop_name TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'COD',
  p_use_wallet BOOLEAN DEFAULT FALSE,
  p_min_expected_wallet_used NUMERIC DEFAULT NULL,
  p_subtotal NUMERIC DEFAULT 0,
  p_discount_amount NUMERIC DEFAULT 0,
  p_delivery_fee NUMERIC DEFAULT 0,
  p_cod_charge NUMERIC DEFAULT 0,
  p_final_total NUMERIC DEFAULT 0,
  p_previous_outstanding NUMERIC DEFAULT 0,
  p_product_name_serialized TEXT DEFAULT '',
  p_address_id TEXT DEFAULT NULL,
  p_delivery_address JSONB DEFAULT '{}'::jsonb,
  p_preferred_slot TEXT DEFAULT NULL,
  p_weight_kg NUMERIC DEFAULT NULL,
  p_razorpay_order_id TEXT DEFAULT NULL,
  p_razorpay_payment_id TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_actor_role TEXT := upper(btrim(coalesce(p_actor_role, '')));
  v_session_phone TEXT := public._normalize_indian_phone10(p_session_phone);
  v_session_cid TEXT := btrim(coalesce(p_session_customer_id, ''));
  v_clean_phone TEXT := public._normalize_indian_phone10(p_customer_phone);
  v_req_cid TEXT := btrim(coalesce(p_customer_id, ''));

  v_order_id TEXT;
  v_order_number TEXT;
  v_customer_name TEXT;
  v_shop_name TEXT;
  v_is_advance BOOLEAN;
  v_payment_method TEXT;
  v_payment_status TEXT;
  v_is_paid BOOLEAN;

  v_subtotal NUMERIC(12, 2);
  v_discount_amount NUMERIC(12, 2);
  v_delivery_fee NUMERIC(12, 2);
  v_cod_charge NUMERIC(12, 2);
  v_final_total NUMERIC(12, 2);
  v_previous_outstanding NUMERIC(12, 2);

  v_phone_variants TEXT[];
  v_user_has_phone_norm BOOLEAN := FALSE;
  v_ord_has_address_id BOOLEAN := FALSE;
  v_ord_address_id_type TEXT := '';
  v_ord_delivery_addr_type TEXT := 'text';
  v_ord_has_cod_charge BOOLEAN := FALSE;

  v_pre_uid TEXT := NULL;
  v_pre_db_phone TEXT := NULL;
  v_pre_db_role TEXT := NULL;
  v_lock_uid TEXT := NULL;

  v_user_id TEXT := NULL;
  v_user_phone TEXT := NULL;
  v_user_role TEXT := NULL;
  v_user_status TEXT := 'ACTIVE';
  v_user_wallet_bal NUMERIC(12, 2) := 0;
  v_user_found BOOLEAN := FALSE;

  v_existing_order public.orders%ROWTYPE;
  v_existing_phone TEXT;
  v_existing_meta JSONB;
  v_existing_rel_items JSONB := '[]'::jsonb;
  v_existing_items JSONB := '[]'::jsonb;
  v_existing_debit RECORD;

  v_alias_ids TEXT[];
  v_ledger_row RECORD;
  v_has_wallet_credit_rows BOOLEAN := FALSE;
  v_running_bal NUMERIC(12, 2) := 0;
  v_current_balance NUMERIC(12, 2) := 0;
  v_wallet_used NUMERIC(12, 2) := 0;
  v_final_payable NUMERIC(12, 2) := 0;
  v_total_payable NUMERIC(12, 2) := 0;
  v_previous_online_paid NUMERIC(12, 2) := 0;
  v_new_balance NUMERIC(12, 2) := 0;

  v_item JSONB;
  v_item_idx INTEGER := 0;
  v_item_id TEXT;
  v_item_qty_num NUMERIC;
  v_item_qty INTEGER;
  v_raw_unit_price NUMERIC;
  v_item_unit_price NUMERIC(12, 2);
  v_item_pack_size NUMERIC;
  v_item_line_total NUMERIC(12, 2);
  v_items_sum NUMERIC(12, 2) := 0;
  v_items_with_price_count INTEGER := 0;
  v_canonical_items JSONB := '[]'::jsonb;

  v_meta_json JSONB;
  v_notes TEXT;
  v_preferred_slot TEXT;
  v_addr_id_str TEXT := NULLIF(btrim(coalesce(p_address_id, '')), '');
  v_delivery_addr_json JSONB := coalesce(p_delivery_address, '{}'::jsonb);

  v_insert_cols TEXT[];
  v_insert_vals TEXT[];
  v_sql TEXT;
  v_row_count INTEGER;

  v_ledger_id TEXT := NULL;
  v_ledger_cust_id TEXT;
  v_created_at TIMESTAMPTZ := v_now;
BEGIN
  -- 1. Validate server-side actor role & customer ownership context
  IF v_actor_role NOT IN ('CUSTOMER', 'SHOPKEEPER') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 401,
      'error', 'Unauthorized: Verified customer or shopkeeper session is required to place an order.'
    );
  END IF;

  IF v_actor_role = 'CUSTOMER' THEN
    IF v_session_phone !~ '^[6-9][0-9]{9}$' OR v_session_cid = '' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 401,
        'error', 'Unauthorized: Valid verified customer session is required.'
      );
    END IF;

    IF v_clean_phone <> '' AND v_clean_phone <> v_session_phone THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: You can only place orders for your own verified mobile number.'
      );
    END IF;

    IF v_req_cid <> '' AND v_req_cid <> v_session_cid THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: You cannot place an order using another customer ID.'
      );
    END IF;

    v_clean_phone := v_session_phone;
    v_req_cid := v_session_cid;
  ELSE
    IF v_clean_phone !~ '^[6-9][0-9]{9}$' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 400,
        'error', 'Valid 10-digit customer phone number is required for order verification'
      );
    END IF;

    IF v_req_cid = '' THEN
      v_req_cid := 'usr_' || v_clean_phone;
    END IF;
  END IF;

  -- Reject negative financial parameters
  IF coalesce(p_subtotal, 0) < 0
     OR coalesce(p_discount_amount, 0) < 0
     OR coalesce(p_delivery_fee, 0) < 0
     OR coalesce(p_cod_charge, 0) < 0
     OR coalesce(p_previous_outstanding, 0) < 0
     OR (p_final_total IS NOT NULL AND p_final_total < 0)
     OR (p_min_expected_wallet_used IS NOT NULL AND p_min_expected_wallet_used < 0) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Invalid negative financial amount in order payload.'
    );
  END IF;

  v_subtotal := round(coalesce(p_subtotal, 0), 2);
  v_discount_amount := round(coalesce(p_discount_amount, 0), 2);
  v_delivery_fee := round(coalesce(p_delivery_fee, 0), 2);
  v_cod_charge := round(coalesce(p_cod_charge, 0), 2);
  v_previous_outstanding := round(coalesce(p_previous_outstanding, 0), 2);

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', 'Order must contain at least one item'
    );
  END IF;

  -- Generate authoritative server IDs if omitted
  v_order_id := NULLIF(btrim(coalesce(p_order_id, '')), '');
  IF v_order_id IS NULL THEN
    v_order_id := 'ord-' || floor(extract(epoch FROM v_now) * 1000)::bigint::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
  END IF;

  v_order_number := NULLIF(btrim(coalesce(p_order_number, '')), '');
  IF v_order_number IS NULL THEN
    v_order_number := 'OM-' || (10000 + floor(random() * 90000))::integer::text;
  END IF;

  -- Canonicalize items & validate positive integers + non-negative pricing inside DB transaction
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_idx := v_item_idx + 1;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 400,
        'error', format('Invalid order item at position %s.', v_item_idx)
      );
    END IF;

    BEGIN
      v_item_qty_num := (v_item->>'quantity')::numeric;
    EXCEPTION WHEN others THEN
      v_item_qty_num := 0;
    END;
    IF v_item_qty_num IS NULL OR v_item_qty_num <= 0 OR v_item_qty_num <> trunc(v_item_qty_num) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 400,
        'error', format('Invalid quantity for item %s. Quantity must be a positive integer.', v_item_idx)
      );
    END IF;
    v_item_qty := v_item_qty_num::integer;

    IF NULLIF(btrim(coalesce(v_item->>'unitPrice', '')), '') IS NOT NULL THEN
      BEGIN
        v_raw_unit_price := (v_item->>'unitPrice')::numeric;
      EXCEPTION WHEN others THEN
        v_raw_unit_price := -1;
      END;
      IF v_raw_unit_price < 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'statusCode', 400,
          'error', format('Invalid negative unitPrice for item %s.', v_item_idx)
        );
      END IF;
      v_item_unit_price := round(v_raw_unit_price, 2);
      v_items_with_price_count := v_items_with_price_count + 1;
    ELSE
      v_item_unit_price := 0;
    END IF;

    BEGIN
      v_item_pack_size := coalesce((v_item->>'packSize')::numeric, 1);
    EXCEPTION WHEN others THEN
      v_item_pack_size := -1;
    END;
    IF v_item_pack_size <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 400,
        'error', format('Invalid packSize for item %s.', v_item_idx)
      );
    END IF;

    v_item_line_total := round(v_item_unit_price * v_item_qty, 2);
    v_items_sum := round(v_items_sum + v_item_line_total, 2);

    v_item_id := coalesce(
      NULLIF(btrim(coalesce(v_item->>'id', '')), ''),
      'item-' || v_order_id || '-' || v_item_idx::text || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
    );

    v_canonical_items := v_canonical_items || jsonb_build_array(
      jsonb_build_object(
        'id', v_item_id,
        'productId', NULLIF(btrim(coalesce(v_item->>'productId', '')), ''),
        'variantId', NULLIF(btrim(coalesce(v_item->>'variantId', '')), ''),
        'productName', coalesce(NULLIF(btrim(coalesce(v_item->>'productName', '')), ''), 'Grocery Item'),
        'variantName', coalesce(NULLIF(btrim(coalesce(v_item->>'variantName', '')), ''), 'Standard'),
        'brand', NULLIF(btrim(coalesce(v_item->>'brand', '')), ''),
        'unit', coalesce(NULLIF(btrim(coalesce(v_item->>'unit', '')), ''), 'PIECE'),
        'packSize', v_item_pack_size,
        'quantity', v_item_qty,
        'unitPrice', v_item_unit_price,
        'price', v_item_line_total,
        'isDiscountExcluded', coalesce((v_item->>'isDiscountExcluded')::boolean, false)
      )
    );
  END LOOP;

  -- When all items specify unitPrice > 0, reject severely mismatched p_subtotal
  IF v_items_with_price_count = jsonb_array_length(p_items)
     AND v_items_sum > 0
     AND abs(v_subtotal - v_items_sum) > 1.00 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'error', format('Order subtotal mismatch (submitted ₹%s vs canonical items total ₹%s).', v_subtotal, v_items_sum)
    );
  END IF;

  -- Server-authoritative payment method & status
  v_is_advance := upper(btrim(coalesce(p_payment_method, 'COD'))) IN ('ADVANCE_ONLINE', 'ONLINE', 'UPI');
  v_payment_method := CASE WHEN v_is_advance THEN 'ADVANCE_ONLINE' ELSE 'COD' END;
  v_payment_status := CASE WHEN v_is_advance THEN 'RECEIVED' ELSE 'PENDING' END;
  v_is_paid := v_is_advance;

  IF v_is_advance THEN
    v_cod_charge := 0;
    v_previous_outstanding := 0;
    IF v_discount_amount > (v_subtotal + v_delivery_fee) THEN
      v_discount_amount := round(v_subtotal + v_delivery_fee, 2);
    END IF;
    v_final_total := round(greatest(0, v_subtotal + v_delivery_fee - v_discount_amount), 2);
  ELSE
    v_discount_amount := 0;
    v_final_total := round(greatest(0, v_subtotal + v_delivery_fee + v_cod_charge), 2);
  END IF;

  -- Detect optional schema columns safely
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone_normalized'
  ) INTO v_user_has_phone_norm;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'address_id'
  ) INTO v_ord_has_address_id;

  IF v_ord_has_address_id THEN
    SELECT data_type INTO v_ord_address_id_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'address_id'
    LIMIT 1;
  END IF;

  SELECT coalesce(data_type, 'text') INTO v_ord_delivery_addr_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivery_address'
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cod_charge'
  ) INTO v_ord_has_cod_charge;

  v_phone_variants := public._indian_mobile_variants(v_clean_phone);

  -- 2. Unlocked pre-lookup solely to collect canonical lock keys BEFORE acquiring wallet advisory locks
  IF v_req_cid <> '' AND v_req_cid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, public._normalize_indian_phone10(phone), upper(coalesce(role, 'CUSTOMER'))
    INTO v_pre_uid, v_pre_db_phone, v_pre_db_role
    FROM public.users
    WHERE id = v_req_cid
    LIMIT 1;

    -- Fail closed if caller's UUID resolves to another customer's phone or non-CUSTOMER account
    IF FOUND AND v_actor_role = 'CUSTOMER' THEN
      IF v_pre_db_role <> 'CUSTOMER' OR (coalesce(v_pre_db_phone, '') <> '' AND v_pre_db_phone <> v_clean_phone) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'statusCode', 403,
          'error', 'Forbidden: Customer session identity does not match registered account.'
        );
      END IF;
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
    CASE WHEN v_req_cid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_req_cid ELSE NULL END
  );

  -- 3. Acquire canonical wallet advisory lock(s) BEFORE checking balance or creating order/items
  PERFORM public._acquire_customer_wallet_locks(
    v_lock_uid,
    ARRAY[v_clean_phone, v_pre_db_phone],
    coalesce(NULLIF(v_clean_phone, ''), NULLIF(v_req_cid, ''), v_order_id)
  );

  -- 4. Lock target customer row FOR UPDATE inside the transaction
  IF v_clean_phone <> '' AND v_user_has_phone_norm THEN
    EXECUTE 'SELECT id, public._normalize_indian_phone10(phone), upper(coalesce(role, ''CUSTOMER'')), upper(coalesce(to_jsonb(users)->>''status'', ''ACTIVE'')), coalesce(wallet_balance, 0) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1 FOR UPDATE'
    INTO v_user_id, v_user_phone, v_user_role, v_user_status, v_user_wallet_bal
    USING ('+91' || v_clean_phone);
    v_user_found := FOUND;
  END IF;

  IF NOT v_user_found AND v_clean_phone <> '' THEN
    SELECT
      id,
      public._normalize_indian_phone10(phone),
      upper(coalesce(role, 'CUSTOMER')),
      upper(coalesce(to_jsonb(u)->>'status', 'ACTIVE')),
      coalesce(wallet_balance, 0)
    INTO v_user_id, v_user_phone, v_user_role, v_user_status, v_user_wallet_bal
    FROM public.users u
    WHERE u.phone = ANY(v_phone_variants)
      AND u.role = 'CUSTOMER'
    ORDER BY u.created_at ASC
    LIMIT 1
    FOR UPDATE;
    v_user_found := FOUND;
  END IF;

  IF NOT v_user_found
     AND v_req_cid <> ''
     AND v_req_cid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT
      id,
      public._normalize_indian_phone10(phone),
      upper(coalesce(role, 'CUSTOMER')),
      upper(coalesce(to_jsonb(u)->>'status', 'ACTIVE')),
      coalesce(wallet_balance, 0)
    INTO v_user_id, v_user_phone, v_user_role, v_user_status, v_user_wallet_bal
    FROM public.users u
    WHERE u.id = v_req_cid
      AND u.role = 'CUSTOMER'
    FOR UPDATE;
    v_user_found := FOUND;

    -- Re-verify under lock that UUID row cannot cross customer phone boundaries
    IF v_user_found AND v_actor_role = 'CUSTOMER' AND coalesce(v_user_phone, '') <> '' AND v_user_phone <> v_clean_phone THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'error', 'Forbidden: Customer session identity does not match registered account.'
      );
    END IF;
  END IF;

  -- Block inactive/suspended customer accounts under lock
  IF v_user_found AND v_user_status NOT IN ('ACTIVE', '') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 403,
      'error', format('Customer account is %s and cannot place orders.', lower(v_user_status))
    );
  END IF;

  -- 5. Authoritative DB-level Idempotency Check under lock (prevents duplicate order/debit races)
  SELECT * INTO v_existing_order
  FROM public.orders
  WHERE id = v_order_id
  LIMIT 1;

  IF FOUND THEN
    v_existing_phone := public._normalize_indian_phone10(v_existing_order.customer_phone);
    IF v_actor_role = 'CUSTOMER' THEN
      IF (v_existing_phone <> '' AND v_existing_phone <> v_clean_phone)
         OR (v_existing_phone = '' AND coalesce(v_existing_order.customer_id, '') <> coalesce(v_user_id, v_req_cid, '')) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'statusCode', 409,
          'error', 'Order ID already exists for another customer.'
        );
      END IF;
    END IF;

    v_existing_meta := coalesce((public._parse_cod_meta_from_notes(v_existing_order.notes))->'meta', '{}'::jsonb);

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
    INTO v_existing_rel_items
    FROM public.order_items oi
    WHERE oi.order_id = v_existing_order.id;

    v_existing_items := CASE
      WHEN jsonb_array_length(v_existing_rel_items) > 0 THEN v_existing_rel_items
      WHEN jsonb_typeof(v_existing_meta->'items') = 'array' THEN v_existing_meta->'items'
      ELSE '[]'::jsonb
    END;

    SELECT id, amount, balance_after
    INTO v_existing_debit
    FROM public.ledger
    WHERE order_id = v_existing_order.id
      AND type = 'DEBIT'
      AND id LIKE 'wtx_%'
    LIMIT 1;

    -- Use authoritative ledger debit amount (never inflate from notes alone if no debit row exists)
    v_wallet_used := round(coalesce(v_existing_debit.amount, 0), 2);

    RETURN jsonb_build_object(
      'ok', true,
      'statusCode', 200,
      'deduplicated', true,
      'ledgerTransactionId', v_existing_debit.id,
      'order', jsonb_build_object(
        'id', v_existing_order.id,
        'orderNumber', v_existing_order.order_number,
        'customerPhone', v_existing_order.customer_phone,
        'status', coalesce(NULLIF(v_existing_order.status, ''), 'ORDER_PENDING'),
        'paymentStatus', coalesce(NULLIF(v_existing_order.payment_status, ''), CASE WHEN v_existing_order.is_paid THEN 'RECEIVED' ELSE 'PENDING' END),
        'isPaid', coalesce(v_existing_order.is_paid, false),
        'createdAt', v_existing_order.created_at,
        'previousOutstanding', coalesce((v_existing_meta->>'prevOutstanding')::numeric, 0),
        'subtotal', coalesce(v_existing_order.subtotal, 0),
        'deliveryFee', round(greatest(0, coalesce(v_existing_order.final_total, 0) - coalesce(v_existing_order.subtotal, 0) + coalesce(v_existing_order.discount_amount, 0) - coalesce((v_existing_meta->>'codCharge')::numeric, 0)), 2),
        'codCharge', coalesce((v_existing_meta->>'codCharge')::numeric, 0),
        'discountAmount', coalesce(v_existing_order.discount_amount, 0),
        'finalAmount', coalesce(v_existing_order.final_total, 0),
        'walletAmountUsed', v_wallet_used,
        'totalPayable', coalesce((v_existing_meta->>'totalPayable')::numeric, greatest(0, coalesce(v_existing_order.final_total, 0) - v_wallet_used)),
        'paymentMethod', coalesce(NULLIF(v_existing_order.payment_method, ''), 'COD'),
        'items', v_existing_items
      )
    );
  END IF;

  -- 6. Compute authoritative live wallet balance under advisory + row lock
  SELECT coalesce(array_agg(DISTINCT aid), ARRAY[]::TEXT[])
  INTO v_alias_ids
  FROM unnest(
    ARRAY[
      v_user_id,
      NULLIF(v_req_cid, ''),
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

  -- 7. Server-side wallet validation & debit amount calculation
  IF v_is_advance AND coalesce(p_use_wallet, false) IS TRUE THEN
    IF v_current_balance <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 409,
        'code', 'INSUFFICIENT_WALLET_BALANCE',
        'availableBalance', v_current_balance,
        'error', format('Insufficient live wallet balance (available ₹%s). Please refresh and retry.', v_current_balance)
      );
    END IF;

    IF p_min_expected_wallet_used IS NOT NULL
       AND round(p_min_expected_wallet_used, 2) > 0
       AND (v_current_balance + 0.001 < round(p_min_expected_wallet_used, 2)) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 409,
        'code', 'INSUFFICIENT_WALLET_BALANCE',
        'availableBalance', v_current_balance,
        'error', format('Insufficient live wallet balance (available ₹%s, required ₹%s). Please refresh and retry.', v_current_balance, round(p_min_expected_wallet_used, 2))
      );
    END IF;

    v_wallet_used := round(least(v_current_balance, v_final_total), 2);
  ELSE
    v_wallet_used := 0;
  END IF;

  v_final_payable := round(greatest(0, v_final_total - v_wallet_used), 2);
  v_total_payable := CASE WHEN v_is_advance THEN v_final_payable ELSE v_final_total END;
  v_previous_online_paid := CASE WHEN v_is_advance THEN v_final_payable ELSE 0 END;

  v_customer_name := coalesce(NULLIF(btrim(coalesce(p_customer_name, '')), ''), 'Customer (' || right(v_clean_phone, 4) || ')');
  v_shop_name := coalesce(NULLIF(btrim(coalesce(p_shop_name, '')), ''), v_customer_name);
  v_preferred_slot := coalesce(NULLIF(btrim(coalesce(p_preferred_slot, '')), ''), to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD'));

  -- Construct authoritative COD_META purely on server (never trust client COD_META/walletAmountUsed)
  v_meta_json := jsonb_build_object(
    'codCollected', 0,
    'codCharge', v_cod_charge,
    'codLateFeeApplied', false,
    'codLateFeeAmount', 0,
    'prevOutstanding', v_previous_outstanding,
    'totalPayable', v_total_payable,
    'walletAmountUsed', v_wallet_used,
    'previousOnlinePaid', v_previous_online_paid,
    'stockDeducted', false,
    'stockRestored', false,
    'items', v_canonical_items
  );
  v_notes := format('Order #%s | COD_META:%s', v_order_number, v_meta_json::text);

  -- 8. Insert public.orders (schema-safe parameterized dynamic statement)
  v_insert_cols := ARRAY[
    'id',
    'order_number',
    'customer_id',
    'customer_name',
    'customer_phone',
    'shop_name',
    '"Product Name"',
    'subtotal',
    'discount_amount',
    'final_total',
    'status',
    'payment_method',
    'payment_status',
    'is_paid',
    'preferred_slot',
    'notes',
    'weight_kg',
    'razorpay_order_id',
    'razorpay_payment_id',
    'created_at',
    'updated_at'
  ];
  v_insert_vals := ARRAY[
    '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9', '$10',
    '''ORDER_PENDING''', '$11', '$12', '$13', '$14', '$15', '$16', '$17', '$18', '$19', '$19'
  ];

  IF v_ord_delivery_addr_type IN ('jsonb', 'json') THEN
    v_insert_cols := array_append(v_insert_cols, 'delivery_address');
    IF v_ord_delivery_addr_type = 'jsonb' THEN
      v_insert_vals := array_append(v_insert_vals, '$20::jsonb');
    ELSE
      v_insert_vals := array_append(v_insert_vals, '$20::json');
    END IF;
  ELSE
    v_insert_cols := array_append(v_insert_cols, 'delivery_address');
    v_insert_vals := array_append(v_insert_vals, 'coalesce(NULLIF($20->>''full_address'', ''''), $20::text)');
  END IF;

  IF v_ord_has_cod_charge THEN
    v_insert_cols := array_append(v_insert_cols, 'cod_charge');
    v_insert_vals := array_append(v_insert_vals, '$21');
  END IF;

  IF v_ord_has_address_id THEN
    v_insert_cols := array_append(v_insert_cols, 'address_id');
    IF v_ord_address_id_type = 'uuid' THEN
      v_insert_vals := array_append(
        v_insert_vals,
        'CASE WHEN $22 IS NOT NULL AND $22 ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' THEN $22::uuid ELSE NULL::uuid END'
      );
    ELSE
      v_insert_vals := array_append(v_insert_vals, '$22');
    END IF;
  END IF;

  v_sql := format(
    'INSERT INTO public.orders (%s) VALUES (%s)',
    array_to_string(v_insert_cols, ', '),
    array_to_string(v_insert_vals, ', ')
  );

  EXECUTE v_sql
  USING
    v_order_id,                                                       -- $1
    v_order_number,                                                   -- $2
    coalesce(NULLIF(v_user_id, ''), v_req_cid),                       -- $3
    v_customer_name,                                                  -- $4
    v_clean_phone,                                                    -- $5
    v_shop_name,                                                      -- $6
    coalesce(p_product_name_serialized, ''),                          -- $7
    v_subtotal,                                                       -- $8
    v_discount_amount,                                                -- $9
    v_final_total,                                                    -- $10
    v_payment_method,                                                 -- $11
    v_payment_status,                                                 -- $12
    v_is_paid,                                                        -- $13
    v_preferred_slot,                                                 -- $14
    v_notes,                                                          -- $15
    p_weight_kg,                                                      -- $16
    NULLIF(btrim(coalesce(p_razorpay_order_id, '')), ''),             -- $17
    NULLIF(btrim(coalesce(p_razorpay_payment_id, '')), ''),           -- $18
    v_created_at,                                                     -- $19
    v_delivery_addr_json,                                             -- $20
    v_cod_charge,                                                     -- $21
    v_addr_id_str;                                                    -- $22

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to insert order row % atomically (inserted % rows)', v_order_id, v_row_count;
  END IF;

  -- 9. Insert ALL relational public.order_items rows inside the same ACID transaction
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_canonical_items)
  LOOP
    INSERT INTO public.order_items (
      id,
      order_id,
      product_id,
      product_variant_id,
      product_name,
      variant_name,
      brand,
      unit,
      pack_size,
      quantity,
      unit_price,
      total_price,
      is_discount_excluded,
      created_at
    ) VALUES (
      v_item->>'id',
      v_order_id,
      NULLIF(v_item->>'productId', ''),
      NULLIF(v_item->>'variantId', ''),
      v_item->>'productName',
      NULLIF(v_item->>'variantName', ''),
      NULLIF(v_item->>'brand', ''),
      coalesce(NULLIF(v_item->>'unit', ''), 'PIECE'),
      coalesce((v_item->>'packSize')::numeric, 1),
      (v_item->>'quantity')::integer,
      (v_item->>'unitPrice')::numeric,
      (v_item->>'price')::numeric,
      coalesce((v_item->>'isDiscountExcluded')::boolean, false),
      v_created_at
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Failed to insert order_item % for order % atomically', v_item->>'id', v_order_id;
    END IF;
  END LOOP;

  -- 10. Insert exactly ONE wallet DEBIT ledger row & synchronize users.wallet_balance
  v_new_balance := v_current_balance;
  IF v_wallet_used > 0 THEN
    v_new_balance := round(greatest(0, v_current_balance - v_wallet_used), 2);
    v_ledger_id := 'wtx_debit_' || v_order_id;
    v_ledger_cust_id := coalesce(
      NULLIF(v_user_id, ''),
      NULLIF(v_req_cid, ''),
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
      v_ledger_id,
      v_ledger_cust_id,
      v_customer_name,
      v_order_id,
      v_created_at,
      'DEBIT',
      v_wallet_used,
      format('Wallet Applied on Order #%s', v_order_number),
      v_new_balance
    );

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Failed to insert wallet debit ledger row for order %', v_order_id;
    END IF;

    IF v_user_found AND v_user_id IS NOT NULL THEN
      UPDATE public.users
      SET wallet_balance = v_new_balance,
          updated_at = v_created_at
      WHERE id = v_user_id;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      IF v_row_count <> 1 THEN
        RAISE EXCEPTION 'Failed to update user wallet_balance for user % (updated % rows)', v_user_id, v_row_count;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'statusCode', 201,
    'deduplicated', false,
    'ledgerTransactionId', v_ledger_id,
    'remainingWalletBalance', CASE WHEN v_wallet_used > 0 THEN v_new_balance ELSE v_current_balance END,
    'order', jsonb_build_object(
      'id', v_order_id,
      'orderNumber', v_order_number,
      'customerPhone', v_clean_phone,
      'status', 'ORDER_PENDING',
      'paymentStatus', v_payment_status,
      'isPaid', v_is_paid,
      'createdAt', v_created_at,
      'previousOutstanding', v_previous_outstanding,
      'subtotal', v_subtotal,
      'deliveryFee', v_delivery_fee,
      'codCharge', v_cod_charge,
      'discountAmount', v_discount_amount,
      'finalAmount', v_final_total,
      'walletAmountUsed', v_wallet_used,
      'remainingWalletBalance', CASE WHEN v_wallet_used > 0 THEN v_new_balance ELSE NULL END,
      'totalPayable', v_total_payable,
      'paymentMethod', v_payment_method,
      'items', v_canonical_items
    )
  );
END;
$$;

-- 6. Atomic Customer Phone Update RPC (Hardened session & DB ownership check + wallet locks)
CREATE OR REPLACE FUNCTION public.update_customer_phone_atomic(
  p_user_id TEXT DEFAULT NULL,
  p_session_phone TEXT DEFAULT NULL,
  p_new_phone TEXT DEFAULT NULL,
  p_update_profile BOOLEAN DEFAULT FALSE,
  p_name TEXT DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_shop_name TEXT DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_now TIMESTAMPTZ := coalesce(p_now, now());
  v_new_phone TEXT := public._normalize_indian_phone10(p_new_phone);
  v_new_phone_norm TEXT;
  v_sess_phone TEXT := public._normalize_indian_phone10(p_session_phone);
  v_sess_variants TEXT[];
  v_new_variants TEXT[];
  v_req_uid TEXT := btrim(coalesce(p_user_id, ''));

  v_user_has_phone_norm BOOLEAN := FALSE;
  v_user_has_full_name BOOLEAN := FALSE;
  v_user_has_name BOOLEAN := FALSE;
  v_user_has_address BOOLEAN := FALSE;
  v_user_has_shop_name BOOLEAN := FALSE;

  v_pre_uid TEXT := NULL;
  v_pre_phone TEXT := NULL;
  v_target_user JSONB := NULL;
  v_target_id TEXT := NULL;
  v_old_db_phone TEXT := NULL;
  v_target_status TEXT := 'ACTIVE';
  v_conflict_id TEXT := NULL;

  v_clean_name TEXT := NULLIF(btrim(coalesce(p_name, '')), '');
  v_set_parts TEXT[];
  v_sql TEXT;
  v_updated_user JSONB;
BEGIN
  -- Require valid authenticated session mobile number (never allow anonymous UUID overwrite)
  IF v_sess_phone !~ '^[6-9][0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 401,
      'code', 'UNAUTHORIZED',
      'error', 'Verified customer session mobile number is required.'
    );
  END IF;

  IF v_new_phone !~ '^[6-9][0-9]{9}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 400,
      'code', 'INVALID_MOBILE',
      'error', 'Invalid 10-digit Indian mobile number.'
    );
  END IF;

  v_new_phone_norm := '+91' || v_new_phone;
  v_sess_variants := public._indian_mobile_variants(v_sess_phone);
  v_new_variants := public._indian_mobile_variants(v_new_phone);

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone_normalized'
  ) INTO v_user_has_phone_norm;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'full_name'
  ) INTO v_user_has_full_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name'
  ) INTO v_user_has_name;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'address'
  ) INTO v_user_has_address;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'shop_name'
  ) INTO v_user_has_shop_name;

  -- Unlocked pre-lookup to discover canonical UUID & current phone
  IF v_req_uid <> '' AND v_req_uid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, public._normalize_indian_phone10(phone)
    INTO v_pre_uid, v_pre_phone
    FROM public.users
    WHERE id = v_req_uid
      AND role = 'CUSTOMER'
    LIMIT 1;

    IF FOUND AND coalesce(v_pre_phone, '') <> '' AND v_pre_phone <> v_sess_phone THEN
      RETURN jsonb_build_object(
        'ok', false,
        'statusCode', 403,
        'code', 'FORBIDDEN',
        'error', 'Forbidden: Session mobile number does not match customer record.'
      );
    END IF;
  END IF;

  IF v_pre_uid IS NULL AND v_user_has_phone_norm THEN
    EXECUTE 'SELECT id, public._normalize_indian_phone10(phone) FROM public.users WHERE phone_normalized = $1 AND role = ''CUSTOMER'' ORDER BY created_at ASC LIMIT 1'
    INTO v_pre_uid, v_pre_phone
    USING ('+91' || v_sess_phone);
  END IF;

  IF v_pre_uid IS NULL THEN
    SELECT id, public._normalize_indian_phone10(phone)
    INTO v_pre_uid, v_pre_phone
    FROM public.users
    WHERE phone = ANY(v_sess_variants)
      AND role = 'CUSTOMER'
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_pre_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 404,
      'code', 'NOT_FOUND',
      'error', 'Customer record not found.'
    );
  END IF;

  -- Acquire sorted wallet advisory locks across user UUID, old phone, session phone, and new phone
  PERFORM public._acquire_customer_wallet_locks(
    v_pre_uid,
    ARRAY[v_pre_phone, v_sess_phone, v_new_phone],
    v_pre_uid
  );

  -- Lock target customer row FOR UPDATE
  SELECT to_jsonb(u)
  INTO v_target_user
  FROM public.users u
  WHERE u.id = v_pre_uid
    AND u.role = 'CUSTOMER'
  FOR UPDATE;

  IF v_target_user IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 404,
      'code', 'NOT_FOUND',
      'error', 'Customer record not found.'
    );
  END IF;

  v_target_id := v_target_user->>'id';
  v_old_db_phone := public._normalize_indian_phone10(v_target_user->>'phone');
  v_target_status := upper(coalesce(v_target_user->>'status', 'ACTIVE'));

  -- Re-verify strict session phone ownership after acquiring lock
  IF v_old_db_phone <> v_sess_phone THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 403,
      'code', 'FORBIDDEN',
      'error', 'Forbidden: Session mobile number no longer matches customer record.'
    );
  END IF;

  IF v_target_status NOT IN ('ACTIVE', '') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 403,
      'code', 'ACCOUNT_INACTIVE',
      'error', 'Customer account is inactive or blocked.'
    );
  END IF;

  -- Verify uniqueness of new phone
  IF v_user_has_phone_norm THEN
    EXECUTE 'SELECT id FROM public.users WHERE (phone_normalized = $1 OR phone = ANY($2)) AND id <> $3 LIMIT 1'
    INTO v_conflict_id
    USING v_new_phone_norm, v_new_variants, v_target_id;
  ELSE
    SELECT id INTO v_conflict_id
    FROM public.users
    WHERE phone = ANY(v_new_variants)
      AND id <> v_target_id
    LIMIT 1;
  END IF;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'code', 'DUPLICATE_CUSTOMER',
      'error', 'An account with this mobile number already exists. Please use a different mobile number or log in.'
    );
  END IF;

  v_set_parts := ARRAY['phone = $1', 'updated_at = $2'];
  IF v_user_has_phone_norm THEN
    v_set_parts := array_append(v_set_parts, 'phone_normalized = $3');
  END IF;

  IF coalesce(p_update_profile, false) IS TRUE THEN
    IF v_clean_name IS NOT NULL THEN
      IF v_user_has_full_name THEN
        v_set_parts := array_append(v_set_parts, 'full_name = $4');
      ELSIF v_user_has_name THEN
        v_set_parts := array_append(v_set_parts, 'name = $4');
      END IF;
    END IF;
    IF v_user_has_address AND p_address IS NOT NULL THEN
      v_set_parts := array_append(v_set_parts, 'address = $5');
    END IF;
    IF v_user_has_shop_name AND NULLIF(btrim(coalesce(p_shop_name, '')), '') IS NOT NULL
       AND NULLIF(btrim(coalesce(v_target_user->>'shop_name', '')), '') IS NULL THEN
      v_set_parts := array_append(v_set_parts, 'shop_name = $6');
    END IF;
  END IF;

  v_sql := format(
    'UPDATE public.users u SET %s WHERE u.id = $7 AND u.role = ''CUSTOMER'' RETURNING to_jsonb(u)',
    array_to_string(v_set_parts, ', ')
  );

  EXECUTE v_sql
  INTO v_updated_user
  USING
    v_new_phone,
    v_now,
    v_new_phone_norm,
    v_clean_name,
    p_address,
    p_shop_name,
    v_target_id;

  IF v_updated_user IS NULL THEN
    RAISE EXCEPTION 'Failed to update mobile number for customer %', v_target_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'statusCode', 200,
    'phone', v_new_phone,
    'phoneNormalized', v_new_phone_norm,
    'previousPhone', v_old_db_phone,
    'user', v_updated_user
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'ok', false,
      'statusCode', 409,
      'code', 'DUPLICATE_CUSTOMER',
      'error', 'An account with this mobile number already exists. Please use a different mobile number or log in.'
    );
END;
$$;

-- 7. Unified Atomic Wallet Debit RPC (100% identical to supabase_order_cancellation_atomic_v2.sql)
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

-- 8. Restrict RPC execution strictly to server-side service_role
REVOKE ALL ON FUNCTION public._normalize_indian_phone10(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._indian_mobile_variants(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._parse_cod_meta_from_notes(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_wallet_ledger_entry(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._acquire_customer_wallet_locks(TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_order_with_wallet_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, NUMERIC,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, JSONB, TEXT,
  NUMERIC, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.update_customer_phone_atomic(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.debit_wallet_for_order_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_order_with_wallet_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, NUMERIC,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, JSONB, TEXT,
  NUMERIC, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;

GRANT EXECUTE ON FUNCTION public.update_customer_phone_atomic(
  TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

GRANT EXECUTE ON FUNCTION public.debit_wallet_for_order_atomic(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TIMESTAMPTZ
) TO service_role;

COMMIT;
