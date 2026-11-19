BEGIN;

-- ==============================================================================
-- Om Distributors - Database-Level Normalized Customer Mobile Protection
-- ==============================================================================
-- Canonical Format: +91XXXXXXXXXX
-- Equivalent Inputs Handled:
--   - 9876543210
--   - +919876543210
--   - 919876543210
--   - 09876543210
--   - 00919876543210
--   - Numbers with spaces, hyphens (-), and brackets ( ) e.g. (+91) 98765-43210
--
-- Safety Guarantees:
--   1. Preserves public.users.phone and users_phone_unique_idx untouched.
--   2. Preserves existing customer IDs, orders, wallets, ledger entries, and addresses.
--   3. Validates existing phone_normalized column type (must be TEXT if present).
--   4. Validates existing functions/triggers/constraints/indexes without DROP or overwrite.
--   5. Aborts automatically if any non-empty invalid CUSTOMER phone exists.
--   6. Aborts automatically if normalized CUSTOMER duplicates already exist.
--   7. Safe backfill & CHECK constraint handling for CUSTOMER and non-CUSTOMER rows.
--   8. Safe for concurrent inserts/updates via partial UNIQUE index and BEFORE trigger.
--   9. Idempotent: safe to re-run without destructive side effects.
-- ==============================================================================

-- 1. Validate or create public.normalize_indian_mobile_e164(TEXT) (never silently overwrite)
DO $do_norm_fn$
DECLARE
  v_expected_body TEXT;
  v_expected_norm TEXT;
  v_bad_overloads TEXT;
  v_fn_oid OID;
  v_fn_kind TEXT;
  v_fn_retset BOOLEAN;
  v_fn_rettype OID;
  v_fn_volatile TEXT;
  v_fn_secdef BOOLEAN;
  v_fn_lang TEXT;
  v_fn_src TEXT;
  v_fn_src_norm TEXT;
BEGIN
  v_expected_body := $fn_body$
DECLARE
  trimmed TEXT;
  digits TEXT;
BEGIN
  IF raw_phone IS NULL THEN
    RETURN NULL;
  END IF;

  trimmed := btrim(raw_phone);
  IF trimmed = '' THEN
    RETURN NULL;
  END IF;

  -- Allow only digits, spaces, '+', '-', and parentheses '(' ')'
  IF trimmed !~ '^[0-9[:space:]+()-]+$' THEN
    RETURN NULL;
  END IF;

  -- Validate '+' placement: only a single leading '+91' (e.g. +91... or (+91)...) is valid;
  -- rejects malformed forms like '++919876543210', '+91+9876543210', or '98765+43210'.
  IF position('+' IN trimmed) > 0 THEN
    IF trimmed !~ '^[[:space:](]*\+91'
       OR regexp_replace(trimmed, '[[:space:]()-]', '', 'g') !~ '^\+91[6-9][0-9]{9}$' THEN
      RETURN NULL;
    END IF;
  END IF;

  digits := regexp_replace(trimmed, '\D', '', 'g');

  IF length(digits) = 14 AND digits LIKE '0091%' THEN
    digits := substr(digits, 5);
  ELSIF length(digits) = 13 AND digits LIKE '091%' THEN
    digits := substr(digits, 4);
  ELSIF length(digits) = 12 AND digits LIKE '91%' THEN
    digits := substr(digits, 3);
  ELSIF length(digits) = 11 AND digits LIKE '0%' THEN
    digits := substr(digits, 2);
  END IF;

  IF length(digits) = 10 AND digits ~ '^[6-9][0-9]{9}$' THEN
    RETURN '+91' || digits;
  END IF;

  RETURN NULL;
END;
$fn_body$;

  v_expected_norm := regexp_replace(
    regexp_replace(
      replace(btrim(v_expected_body, E' \t\r\n'), E'\r\n', E'\n'),
      '--[^\n]*',
      '',
      'g'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  );

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid)
  INTO v_bad_overloads
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'normalize_indian_mobile_e164'
    AND (
      p.pronargs <> 1
      OR (SELECT array_agg(t::regtype::text ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY u(t, ord)) <> ARRAY['text']
    );

  IF v_bad_overloads IS NOT NULL THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Unexpected function signature(s) found for "public.normalize_indian_mobile_e164": %. Expected only normalize_indian_mobile_e164(text).',
      v_bad_overloads;
  END IF;

  SELECT
    p.oid,
    p.prokind::text,
    p.proretset,
    p.prorettype,
    p.provolatile::text,
    p.prosecdef,
    l.lanname,
    p.prosrc
  INTO
    v_fn_oid,
    v_fn_kind,
    v_fn_retset,
    v_fn_rettype,
    v_fn_volatile,
    v_fn_secdef,
    v_fn_lang,
    v_fn_src
  FROM pg_proc p
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'normalize_indian_mobile_e164'
    AND p.pronargs = 1
    AND (SELECT array_agg(t::regtype::text ORDER BY ord) FROM unnest(p.proargtypes) WITH ORDINALITY u(t, ord)) = ARRAY['text'];

  IF FOUND THEN
    v_fn_src_norm := regexp_replace(
      regexp_replace(
        replace(btrim(coalesce(v_fn_src, ''), E' \t\r\n'), E'\r\n', E'\n'),
        '--[^\n]*',
        '',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    );

    IF v_fn_kind <> 'f'
       OR v_fn_retset IS DISTINCT FROM false
       OR v_fn_rettype <> 'text'::regtype
       OR v_fn_volatile <> 'i'
       OR v_fn_secdef IS DISTINCT FROM false
       OR v_fn_lang <> 'plpgsql'
       OR v_fn_src_norm <> v_expected_norm THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing function "public.normalize_indian_mobile_e164(text)" has an unexpected definition or unsafe attributes (kind=%, retset=%, rettype=%, volatile=%, secdef=%, lang=%). Refusing to overwrite.',
        v_fn_kind,
        v_fn_retset,
        v_fn_rettype::regtype,
        v_fn_volatile,
        v_fn_secdef,
        v_fn_lang;
    END IF;
  ELSE
    EXECUTE format(
      'CREATE FUNCTION public.normalize_indian_mobile_e164(raw_phone TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS %L',
      v_expected_body
    );
  END IF;
END $do_norm_fn$;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

-- 2A. Pre-flight check: If public.users.phone_normalized already exists, verify its data type is TEXT
DO $$
DECLARE
  v_col_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO v_col_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.users'::regclass
    AND a.attname = 'phone_normalized'
    AND NOT a.attisdropped;

  IF FOUND AND v_col_type <> 'text' THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Column "public.users.phone_normalized" already exists with data type "%", expected "text".',
      v_col_type;
  END IF;
END $$;

-- 2B. Pre-flight check: STOP immediately if existing CUSTOMER rows contain any
--     non-empty invalid Indian mobile numbers. Never modify or delete rows automatically.
DO $$
DECLARE
  v_invalid_count INTEGER := 0;
  v_invalid_summary TEXT := '';
BEGIN
  SELECT
    COUNT(*),
    string_agg(
      format('id=%s, phone=%L', id::text, phone),
      '; ' ORDER BY id ASC
    )
  INTO v_invalid_count, v_invalid_summary
  FROM public.users
  WHERE upper(coalesce(role, 'CUSTOMER')) = 'CUSTOMER'
    AND phone IS NOT NULL
    AND btrim(phone) <> ''
    AND public.normalize_indian_mobile_e164(phone) IS NULL;

  IF coalesce(v_invalid_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Found % invalid non-empty CUSTOMER mobile number(s). Fix them manually before running this migration (no data was modified). Details: %',
      v_invalid_count,
      v_invalid_summary;
  END IF;
END $$;

-- 2C. Pre-flight check: STOP immediately if existing CUSTOMER rows already share
--     the same normalized mobile number. Never force index creation or alter rows.
DO $$
DECLARE
  v_dup_count INTEGER := 0;
  v_conflict_summary TEXT := '';
BEGIN
  SELECT
    COUNT(*),
    string_agg(
      format(
        'normalized=%s (rows=%s, ids=%s)',
        norm_phone,
        cnt,
        user_ids
      ),
      '; '
    )
  INTO v_dup_count, v_conflict_summary
  FROM (
    SELECT
      public.normalize_indian_mobile_e164(phone) AS norm_phone,
      COUNT(*) AS cnt,
      string_agg(id::text, ', ' ORDER BY id ASC) AS user_ids
    FROM public.users
    WHERE upper(coalesce(role, 'CUSTOMER')) = 'CUSTOMER'
      AND public.normalize_indian_mobile_e164(phone) IS NOT NULL
    GROUP BY public.normalize_indian_mobile_e164(phone)
    HAVING COUNT(*) > 1
  ) dup;

  IF coalesce(v_dup_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Found % normalized duplicate CUSTOMER mobile group(s). Resolve conflicts manually before creating uq_users_customer_phone_normalized. Details: %',
      v_dup_count,
      v_conflict_summary;
  END IF;
END $$;

-- 2D. Pre-flight Safety Validation for existing Function, Trigger, Constraint & Indexes
--     If any object already exists, validate its complete definition and structure;
--     abort immediately on mismatch without dropping, renaming, or overwriting.
DO $do_validate_objects$
DECLARE
  v_phone_norm_attnum SMALLINT;
  v_phone_norm_collation OID;

  v_con_type TEXT;
  v_con_def TEXT;
  v_con_norm TEXT;

  v_sync_expected_body TEXT;
  v_sync_expected_norm TEXT;
  v_sync_bad_overloads TEXT;
  v_sync_kind TEXT;
  v_sync_retset BOOLEAN;
  v_sync_rettype OID;
  v_sync_secdef BOOLEAN;
  v_sync_lang TEXT;
  v_sync_src TEXT;
  v_sync_src_norm TEXT;

  v_trg_enabled TEXT;
  v_trg_type INTEGER;
  v_trg_internal BOOLEAN;
  v_trg_qual TEXT;
  v_trg_fn_nsp TEXT;
  v_trg_fn_name TEXT;
  v_trg_fn_nargs SMALLINT;
  v_trg_cols TEXT[];
  v_trg_def TEXT;

  v_uq_oid OID;
  v_uq_relkind TEXT;
  v_uq_relid OID;
  v_uq_unique BOOLEAN;
  v_uq_valid BOOLEAN;
  v_uq_ready BOOLEAN;
  v_uq_live BOOLEAN;
  v_uq_natts SMALLINT;
  v_uq_nkeyatts SMALLINT;
  v_uq_has_exprs BOOLEAN;
  v_uq_attnum SMALLINT;
  v_uq_indoption SMALLINT;
  v_uq_collation OID;
  v_uq_opcname TEXT;
  v_uq_am TEXT;
  v_uq_pred TEXT;
  v_uq_pred_norm TEXT;
  v_uq_has_con BOOLEAN;

  v_idx_oid OID;
  v_idx_relkind TEXT;
  v_idx_relid OID;
  v_idx_unique BOOLEAN;
  v_idx_valid BOOLEAN;
  v_idx_ready BOOLEAN;
  v_idx_live BOOLEAN;
  v_idx_natts SMALLINT;
  v_idx_nkeyatts SMALLINT;
  v_idx_has_exprs BOOLEAN;
  v_idx_attnum SMALLINT;
  v_idx_indoption SMALLINT;
  v_idx_collation OID;
  v_idx_opcname TEXT;
  v_idx_am TEXT;
  v_idx_pred TEXT;
  v_idx_pred_norm TEXT;
  v_idx_has_con BOOLEAN;
BEGIN
  SELECT a.attnum, a.attcollation
  INTO v_phone_norm_attnum, v_phone_norm_collation
  FROM pg_attribute a
  WHERE a.attrelid = 'public.users'::regclass
    AND a.attname = 'phone_normalized'
    AND NOT a.attisdropped;

  -- 1) Validate chk_users_phone_normalized_format if it already exists on public.users
  SELECT c.contype::text, pg_get_constraintdef(c.oid, true)
  INTO v_con_type, v_con_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.users'::regclass
    AND c.conname = 'chk_users_phone_normalized_format';

  IF FOUND THEN
    v_con_norm := lower(
      regexp_replace(
        regexp_replace(coalesce(v_con_def, ''), '::(text|character varying|varchar)\M', '', 'gi'),
        '[[:space:]()]+',
        '',
        'g'
      )
    );
    IF v_con_type <> 'c'
       OR v_con_norm <> 'checkphone_normalizedisnullorphone_normalized~''^\+91[6-9][0-9]{9}$''' THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing constraint "chk_users_phone_normalized_format" on public.users does not match expected CHECK definition. Found: %',
        v_con_def;
    END IF;
  END IF;

  -- 2) Validate public.sync_users_phone_normalized() if it already exists
  v_sync_expected_body := $sync_body$
DECLARE
  v_norm TEXT;
BEGIN
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    NEW.phone_normalized := NULL;
    RETURN NEW;
  END IF;

  v_norm := public.normalize_indian_mobile_e164(NEW.phone);

  IF upper(coalesce(NEW.role, 'CUSTOMER')) = 'CUSTOMER' THEN
    IF v_norm IS NULL THEN
      RAISE EXCEPTION 'Invalid Indian mobile number format for CUSTOMER account'
        USING ERRCODE = '22023';
    END IF;
    NEW.phone_normalized := v_norm;
  ELSE
    NEW.phone_normalized := v_norm;
  END IF;

  RETURN NEW;
END;
$sync_body$;

  v_sync_expected_norm := regexp_replace(
    regexp_replace(
      replace(btrim(v_sync_expected_body, E' \t\r\n'), E'\r\n', E'\n'),
      '--[^\n]*',
      '',
      'g'
    ),
    '[[:space:]]+',
    ' ',
    'g'
  );

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid)
  INTO v_sync_bad_overloads
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'sync_users_phone_normalized'
    AND p.pronargs <> 0;

  IF v_sync_bad_overloads IS NOT NULL THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Unexpected overloaded function(s) found for "public.sync_users_phone_normalized": %. Expected only zero-argument trigger function.',
      v_sync_bad_overloads;
  END IF;

  SELECT
    p.prokind::text,
    p.proretset,
    p.prorettype,
    p.prosecdef,
    l.lanname,
    p.prosrc
  INTO
    v_sync_kind,
    v_sync_retset,
    v_sync_rettype,
    v_sync_secdef,
    v_sync_lang,
    v_sync_src
  FROM pg_proc p
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'sync_users_phone_normalized'
    AND p.pronargs = 0;

  IF FOUND THEN
    v_sync_src_norm := regexp_replace(
      regexp_replace(
        replace(btrim(coalesce(v_sync_src, ''), E' \t\r\n'), E'\r\n', E'\n'),
        '--[^\n]*',
        '',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    );

    IF v_sync_kind <> 'f'
       OR v_sync_retset IS DISTINCT FROM false
       OR v_sync_rettype <> 'trigger'::regtype
       OR v_sync_secdef IS DISTINCT FROM false
       OR v_sync_lang <> 'plpgsql'
       OR v_sync_src_norm <> v_sync_expected_norm THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing function "public.sync_users_phone_normalized()" has an unexpected definition or unsafe attributes (kind=%, retset=%, rettype=%, secdef=%, lang=%). Refusing to overwrite.',
        v_sync_kind,
        v_sync_retset,
        v_sync_rettype::regtype,
        v_sync_secdef,
        v_sync_lang;
    END IF;
  END IF;

  -- 3) Validate trg_users_sync_phone_normalized if it already exists on public.users
  SELECT
    t.tgenabled::text,
    t.tgtype::integer,
    t.tgisinternal,
    pg_get_expr(t.tgqual, t.tgrelid, true),
    tpn.nspname,
    tp.proname,
    tp.pronargs,
    (
      SELECT array_agg(a.attname::text ORDER BY a.attname::text)
      FROM unnest(t.tgattr::int2[]) AS col_attnum
      JOIN pg_attribute a
        ON a.attrelid = t.tgrelid
       AND a.attnum = col_attnum
       AND NOT a.attisdropped
    ),
    pg_get_triggerdef(t.oid, true)
  INTO
    v_trg_enabled,
    v_trg_type,
    v_trg_internal,
    v_trg_qual,
    v_trg_fn_nsp,
    v_trg_fn_name,
    v_trg_fn_nargs,
    v_trg_cols,
    v_trg_def
  FROM pg_trigger t
  JOIN pg_proc tp ON tp.oid = t.tgfoid
  JOIN pg_namespace tpn ON tpn.oid = tp.pronamespace
  WHERE t.tgrelid = 'public.users'::regclass
    AND t.tgname = 'trg_users_sync_phone_normalized';

  IF FOUND THEN
    IF v_trg_internal IS DISTINCT FROM false
       OR v_trg_enabled NOT IN ('O', 'A')
       OR (v_trg_type & 127) <> 23
       OR v_trg_qual IS NOT NULL
       OR v_trg_fn_nsp <> 'public'
       OR v_trg_fn_name <> 'sync_users_phone_normalized'
       OR v_trg_fn_nargs <> 0
       OR v_trg_cols IS DISTINCT FROM ARRAY['phone', 'phone_normalized', 'role'] THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing trigger "trg_users_sync_phone_normalized" on public.users does not match expected definition or is disabled. Refusing to drop/replace. Found: %',
        v_trg_def;
    END IF;
  END IF;

  -- 4) Validate uq_users_customer_phone_normalized (name collision + full pg_index structure)
  SELECT
    idx.oid,
    idx.relkind::text,
    i.indrelid,
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indislive,
    i.indnatts,
    i.indnkeyatts,
    (i.indexprs IS NOT NULL),
    i.indkey[0],
    i.indoption[0],
    i.indcollation[0],
    opc.opcname,
    am.amname,
    CASE WHEN idx.relkind = 'i' THEN pg_get_expr(i.indpred, i.indrelid, true) ELSE NULL END,
    EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = idx.oid)
  INTO
    v_uq_oid,
    v_uq_relkind,
    v_uq_relid,
    v_uq_unique,
    v_uq_valid,
    v_uq_ready,
    v_uq_live,
    v_uq_natts,
    v_uq_nkeyatts,
    v_uq_has_exprs,
    v_uq_attnum,
    v_uq_indoption,
    v_uq_collation,
    v_uq_opcname,
    v_uq_am,
    v_uq_pred,
    v_uq_has_con
  FROM pg_class idx
  LEFT JOIN pg_index i ON i.indexrelid = idx.oid
  LEFT JOIN pg_am am ON am.oid = idx.relam
  LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
  WHERE idx.relnamespace = 'public'::regnamespace
    AND idx.relname = 'uq_users_customer_phone_normalized';

  IF FOUND THEN
    IF v_uq_relkind <> 'i' THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Object "public.uq_users_customer_phone_normalized" already exists as a non-index object (relkind=%). Resolve this name collision manually before running migration.',
        v_uq_relkind;
    END IF;

    v_uq_pred_norm := lower(
      regexp_replace(
        regexp_replace(coalesce(v_uq_pred, ''), '::(text|character varying|varchar)\M', '', 'gi'),
        '[[:space:]()]+',
        '',
        'g'
      )
    );
    IF v_phone_norm_attnum IS NULL
       OR v_uq_relid <> 'public.users'::regclass
       OR v_uq_unique IS DISTINCT FROM true
       OR v_uq_valid IS DISTINCT FROM true
       OR v_uq_ready IS DISTINCT FROM true
       OR v_uq_live IS DISTINCT FROM true
       OR v_uq_am <> 'btree'
       OR v_uq_natts <> 1
       OR v_uq_nkeyatts <> 1
       OR v_uq_has_exprs IS DISTINCT FROM false
       OR v_uq_attnum IS DISTINCT FROM v_phone_norm_attnum
       OR v_uq_indoption IS DISTINCT FROM 0
       OR v_uq_opcname IS DISTINCT FROM 'text_ops'
       OR v_uq_collation IS DISTINCT FROM v_phone_norm_collation
       OR v_uq_has_con IS DISTINCT FROM false
       OR v_uq_pred IS NULL
       OR v_uq_pred_norm <> 'uppercoalescerole,''customer''=''customer''andphone_normalizedisnotnull' THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing index "uq_users_customer_phone_normalized" does not match expected complete structure on public.users(phone_normalized). Found: %',
        pg_get_indexdef(v_uq_oid);
    END IF;
  END IF;

  -- 5) Validate idx_users_phone_normalized (name collision + full pg_index structure)
  SELECT
    idx.oid,
    idx.relkind::text,
    i.indrelid,
    i.indisunique,
    i.indisvalid,
    i.indisready,
    i.indislive,
    i.indnatts,
    i.indnkeyatts,
    (i.indexprs IS NOT NULL),
    i.indkey[0],
    i.indoption[0],
    i.indcollation[0],
    opc.opcname,
    am.amname,
    CASE WHEN idx.relkind = 'i' THEN pg_get_expr(i.indpred, i.indrelid, true) ELSE NULL END,
    EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = idx.oid)
  INTO
    v_idx_oid,
    v_idx_relkind,
    v_idx_relid,
    v_idx_unique,
    v_idx_valid,
    v_idx_ready,
    v_idx_live,
    v_idx_natts,
    v_idx_nkeyatts,
    v_idx_has_exprs,
    v_idx_attnum,
    v_idx_indoption,
    v_idx_collation,
    v_idx_opcname,
    v_idx_am,
    v_idx_pred,
    v_idx_has_con
  FROM pg_class idx
  LEFT JOIN pg_index i ON i.indexrelid = idx.oid
  LEFT JOIN pg_am am ON am.oid = idx.relam
  LEFT JOIN pg_opclass opc ON opc.oid = i.indclass[0]
  WHERE idx.relnamespace = 'public'::regnamespace
    AND idx.relname = 'idx_users_phone_normalized';

  IF FOUND THEN
    IF v_idx_relkind <> 'i' THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Object "public.idx_users_phone_normalized" already exists as a non-index object (relkind=%). Resolve this name collision manually before running migration.',
        v_idx_relkind;
    END IF;

    v_idx_pred_norm := lower(
      regexp_replace(
        regexp_replace(coalesce(v_idx_pred, ''), '::(text|character varying|varchar)\M', '', 'gi'),
        '[[:space:]()]+',
        '',
        'g'
      )
    );
    IF v_phone_norm_attnum IS NULL
       OR v_idx_relid <> 'public.users'::regclass
       OR v_idx_unique IS DISTINCT FROM false
       OR v_idx_valid IS DISTINCT FROM true
       OR v_idx_ready IS DISTINCT FROM true
       OR v_idx_live IS DISTINCT FROM true
       OR v_idx_am <> 'btree'
       OR v_idx_natts <> 1
       OR v_idx_nkeyatts <> 1
       OR v_idx_has_exprs IS DISTINCT FROM false
       OR v_idx_attnum IS DISTINCT FROM v_phone_norm_attnum
       OR v_idx_indoption IS DISTINCT FROM 0
       OR v_idx_opcname IS DISTINCT FROM 'text_ops'
       OR v_idx_collation IS DISTINCT FROM v_phone_norm_collation
       OR v_idx_has_con IS DISTINCT FROM false
       OR v_idx_pred IS NULL
       OR v_idx_pred_norm <> 'phone_normalizedisnotnull' THEN
      RAISE EXCEPTION
        'MIGRATION ABORTED: Existing index "idx_users_phone_normalized" does not match expected complete structure on public.users(phone_normalized). Found: %',
        pg_get_indexdef(v_idx_oid);
    END IF;
  END IF;
END $do_validate_objects$;

-- 3. Add separate canonical phone_normalized column (keeps public.users.phone intact)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

-- 4A. Pre-backfill guard: ensure no existing row already carries an un-canonical non-NULL
--     phone_normalized value (e.g. legacy non-CUSTOMER data) before backfill & CHECK constraint.
DO $$
DECLARE
  v_bad_norm_count INTEGER := 0;
  v_bad_norm_summary TEXT := '';
BEGIN
  SELECT
    COUNT(*),
    string_agg(
      format('id=%s, role=%s, phone_normalized=%L', id::text, coalesce(role, '<NULL>'), phone_normalized),
      '; ' ORDER BY id ASC
    )
  INTO v_bad_norm_count, v_bad_norm_summary
  FROM public.users
  WHERE phone_normalized IS NOT NULL
    AND phone_normalized !~ '^\+91[6-9][0-9]{9}$';

  IF coalesce(v_bad_norm_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: Found % existing row(s) with non-canonical phone_normalized that would violate chk_users_phone_normalized_format. Inspect manually (no data was modified). Details: %',
      v_bad_norm_count,
      v_bad_norm_summary;
  END IF;
END $$;

-- 4B. Safe idempotent backfill of phone_normalized
--     - CUSTOMER rows: backfills valid normalized phones and clears stale phone_normalized when phone is NULL/empty.
--     - Non-CUSTOMER rows (SHOPKEEPER/ADMIN/SYSTEM/etc.): backfills only when phone is a valid Indian mobile
--       and phone_normalized is NULL (or clears if phone is NULL/empty); leaves existing non-Indian/system phones
--       with phone_normalized = NULL so CHECK constraint never fails and no existing row is modified arbitrarily.
UPDATE public.users
SET phone_normalized = CASE
    WHEN phone IS NULL OR btrim(phone) = '' THEN NULL
    ELSE public.normalize_indian_mobile_e164(phone)
  END
WHERE (
    upper(coalesce(role, 'CUSTOMER')) = 'CUSTOMER'
    AND (
      (
        phone IS NOT NULL
        AND btrim(phone) <> ''
        AND public.normalize_indian_mobile_e164(phone) IS NOT NULL
        AND phone_normalized IS DISTINCT FROM public.normalize_indian_mobile_e164(phone)
      )
      OR (
        (phone IS NULL OR btrim(phone) = '')
        AND phone_normalized IS NOT NULL
      )
    )
  )
  OR (
    upper(coalesce(role, 'CUSTOMER')) <> 'CUSTOMER'
    AND (
      (
        phone IS NOT NULL
        AND btrim(phone) <> ''
        AND public.normalize_indian_mobile_e164(phone) IS NOT NULL
        AND phone_normalized IS NULL
      )
      OR (
        (phone IS NULL OR btrim(phone) = '')
        AND phone_normalized IS NOT NULL
      )
    )
  );

-- 4C. Post-backfill guard: verify 100% of rows satisfy chk_users_phone_normalized_format before adding CHECK
DO $$
DECLARE
  v_violating_count INTEGER := 0;
  v_violating_summary TEXT := '';
BEGIN
  SELECT
    COUNT(*),
    string_agg(
      format('id=%s, role=%s, phone_normalized=%L', id::text, coalesce(role, '<NULL>'), phone_normalized),
      '; ' ORDER BY id ASC
    )
  INTO v_violating_count, v_violating_summary
  FROM public.users
  WHERE phone_normalized IS NOT NULL
    AND phone_normalized !~ '^\+91[6-9][0-9]{9}$';

  IF coalesce(v_violating_count, 0) > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTED: % row(s) still violate chk_users_phone_normalized_format after safe backfill. Details: %',
      v_violating_count,
      v_violating_summary;
  END IF;
END $$;

-- 5. Enforce strict canonical format ('+91XXXXXXXXXX') whenever phone_normalized is non-NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'chk_users_phone_normalized_format'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT chk_users_phone_normalized_format
      CHECK (phone_normalized IS NULL OR phone_normalized ~ '^\+91[6-9][0-9]{9}$');
  END IF;
END $$;

-- 6. Create sync_users_phone_normalized() and trg_users_sync_phone_normalized ONLY if absent
--    (Validated in Step 2D; never overwrites or drops an existing function or trigger.)
DO $do_sync_fn$
DECLARE
  v_sync_body TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'sync_users_phone_normalized'
      AND p.pronargs = 0
  ) THEN
    v_sync_body := $sync_body$
DECLARE
  v_norm TEXT;
BEGIN
  IF NEW.phone IS NULL OR btrim(NEW.phone) = '' THEN
    NEW.phone_normalized := NULL;
    RETURN NEW;
  END IF;

  v_norm := public.normalize_indian_mobile_e164(NEW.phone);

  IF upper(coalesce(NEW.role, 'CUSTOMER')) = 'CUSTOMER' THEN
    IF v_norm IS NULL THEN
      RAISE EXCEPTION 'Invalid Indian mobile number format for CUSTOMER account'
        USING ERRCODE = '22023';
    END IF;
    NEW.phone_normalized := v_norm;
  ELSE
    NEW.phone_normalized := v_norm;
  END IF;

  RETURN NEW;
END;
$sync_body$;

    EXECUTE format(
      'CREATE FUNCTION public.sync_users_phone_normalized() RETURNS TRIGGER LANGUAGE plpgsql AS %L',
      v_sync_body
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.users'::regclass
      AND t.tgname = 'trg_users_sync_phone_normalized'
  ) THEN
    CREATE TRIGGER trg_users_sync_phone_normalized
      BEFORE INSERT OR UPDATE OF phone, phone_normalized, role
      ON public.users
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_users_phone_normalized();
  END IF;
END $do_sync_fn$;

-- 7. Partial UNIQUE index for CUSTOMER accounts (blocks cross-format & concurrent duplicates)
--    SHOPKEEPER and other non-CUSTOMER roles are excluded from this uniqueness rule.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_customer_phone_normalized
  ON public.users (phone_normalized)
  WHERE upper(coalesce(role, 'CUSTOMER')) = 'CUSTOMER'
    AND phone_normalized IS NOT NULL;

-- 8. Lookup index on phone_normalized
CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
  ON public.users (phone_normalized)
  WHERE phone_normalized IS NOT NULL;

COMMIT;
