BEGIN;

DO $runtime_role$
DECLARE
  runtime_role_name TEXT := pg_catalog.current_setting(
    'portfolio.runtime_role_name',
    true
  );
  runtime_role_password TEXT := pg_catalog.current_setting(
    'portfolio.runtime_role_password',
    true
  );
  access_role_name CONSTANT TEXT := pg_catalog.format(
    'portfolio_rebalancer_runtime_%s',
    pg_catalog.substr(pg_catalog.md5(pg_catalog.current_database()), 1, 16)
  );
  inherited_role RECORD;
BEGIN
  IF runtime_role_name IS NULL
    OR runtime_role_name !~ '^[A-Za-z_][A-Za-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'DATABASE_RUNTIME_ROLE must be a simple PostgreSQL role name';
  END IF;
  IF runtime_role_password IS NULL OR runtime_role_password = '' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'DATABASE_RUNTIME_URL must contain a non-empty password';
  END IF;
  IF runtime_role_name = CURRENT_USER
    OR access_role_name = CURRENT_USER THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'runtime and migration database roles must be different';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE "rolname" = access_role_name
  ) THEN
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
      access_role_name
    );
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER ROLE %I WITH NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    access_role_name
  );

  FOR inherited_role IN
    SELECT parent."rolname"
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS child
      ON child."oid" = membership."member"
    JOIN pg_catalog.pg_roles AS parent
      ON parent."oid" = membership."roleid"
    WHERE child."rolname" = access_role_name
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE %I FROM %I',
      inherited_role."rolname",
      access_role_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE "rolname" = runtime_role_name
  ) THEN
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
      runtime_role_name,
      runtime_role_password
    );
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER ROLE %I WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    runtime_role_name,
    runtime_role_password
  );
  EXECUTE pg_catalog.format('ALTER ROLE %I RESET ALL', runtime_role_name);

  FOR inherited_role IN
    SELECT parent."rolname"
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS child
      ON child."oid" = membership."member"
    JOIN pg_catalog.pg_roles AS parent
      ON parent."oid" = membership."roleid"
    WHERE child."rolname" = runtime_role_name
      AND parent."rolname" <> access_role_name
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE %I FROM %I',
      inherited_role."rolname",
      runtime_role_name
    );
  END LOOP;
  EXECUTE pg_catalog.format(
    'GRANT %I TO %I',
    access_role_name,
    runtime_role_name
  );

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS object
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = object."relnamespace"
    JOIN pg_catalog.pg_roles AS owner
      ON owner."oid" = object."relowner"
    WHERE namespace."nspname" = 'public'
      AND owner."rolname" IN (runtime_role_name, access_role_name)
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = function."pronamespace"
    JOIN pg_catalog.pg_roles AS owner
      ON owner."oid" = function."proowner"
    WHERE namespace."nspname" = 'public'
      AND owner."rolname" IN (runtime_role_name, access_role_name)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'runtime roles must not own public application objects';
  END IF;
END;
$runtime_role$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $runtime_grants$
DECLARE
  runtime_role_name TEXT := pg_catalog.current_setting(
    'portfolio.runtime_role_name',
    true
  );
  access_role_name CONSTANT TEXT := pg_catalog.format(
    'portfolio_rebalancer_runtime_%s',
    pg_catalog.substr(pg_catalog.md5(pg_catalog.current_database()), 1, 16)
  );
  relation RECORD;
  function_record RECORD;
  update_relation_name TEXT;
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    pg_catalog.current_database(),
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',
    pg_catalog.current_database(),
    access_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO %I',
    pg_catalog.current_database(),
    access_role_name
  );

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I',
    access_role_name
  );
  EXECUTE pg_catalog.format(
    'GRANT USAGE ON SCHEMA public TO %I',
    access_role_name
  );

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
    access_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
    access_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
    access_role_name
  );

  FOR relation IN
    SELECT object."relname"
    FROM pg_catalog.pg_class AS object
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = object."relnamespace"
    WHERE namespace."nspname" = 'public'
      AND object."relkind" IN ('r', 'p')
      AND object."relname" <> '_prisma_migrations'
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT SELECT, INSERT ON TABLE public.%I TO %I',
      relation."relname",
      access_role_name
    );
  END LOOP;

  FOR relation IN
    SELECT object."relname"
    FROM pg_catalog.pg_class AS object
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = object."relnamespace"
    WHERE namespace."nspname" = 'public'
      AND object."relkind" IN ('v', 'm')
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT SELECT ON TABLE public.%I TO %I',
      relation."relname",
      access_role_name
    );
  END LOOP;

  FOR relation IN
    SELECT object."relname"
    FROM pg_catalog.pg_class AS object
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = object."relnamespace"
    WHERE namespace."nspname" = 'public'
      AND object."relkind" = 'S'
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT USAGE, SELECT ON SEQUENCE public.%I TO %I',
      relation."relname",
      access_role_name
    );
  END LOOP;

  -- UPDATE is limited to real mutable rows, trigger-internal monotonic updates,
  -- and relations that the application or guard functions lock FOR UPDATE.
  FOREACH update_relation_name IN ARRAY ARRAY[
    'collection_run',
    'runtime_lease',
    'instrument_catalog',
    'target_config_version',
    'rebalance_run',
    'order_ledger',
    'daily_trade_limit',
    'manual_order_approval',
    'daily_trade_reservation',
    'order_submission_authorization',
    'cancel_operator_authorization',
    'operational_config'
  ]
  LOOP
    IF pg_catalog.to_regclass(
      pg_catalog.format('public.%I', update_relation_name)
    ) IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'GRANT UPDATE ON TABLE public.%I TO %I',
        update_relation_name,
        access_role_name
      );
    END IF;
  END LOOP;

  -- Account discovery may refresh presentation metadata, but the stable broker
  -- identity and audit timestamps are never writable by the runtime role.
  IF pg_catalog.to_regclass('public.broker_account') IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'GRANT UPDATE (masked_number, account_type_raw, last_seen_at) ON TABLE public.broker_account TO %I',
      access_role_name
    );
  END IF;

  IF pg_catalog.to_regclass('public.runtime_lease') IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'GRANT DELETE ON TABLE public.runtime_lease TO %I',
      access_role_name
    );
  END IF;

  FOR function_record IN
    SELECT
      namespace."nspname",
      procedure_object."proname",
      pg_catalog.pg_get_function_identity_arguments(
        procedure_object."oid"
      ) AS identity_arguments
    FROM pg_catalog.pg_proc AS procedure_object
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace."oid" = procedure_object."pronamespace"
    WHERE namespace."nspname" = 'public'
      AND procedure_object."prokind" = 'f'
      AND procedure_object."prorettype"
        <> 'pg_catalog.trigger'::pg_catalog.regtype
      AND procedure_object."proname" IN (
        'expected_toss_client_order_id',
        'has_required_passed_checks',
        'expected_broker_normalized_state'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %I',
      function_record."nspname",
      function_record."proname",
      function_record."identity_arguments",
      access_role_name
    );
  END LOOP;

  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM %I',
    runtime_role_name
  );
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM %I',
    access_role_name
  );
  EXECUTE pg_catalog.format(
    'ALTER ROLE %I IN DATABASE %I SET search_path TO pg_catalog, public',
    runtime_role_name,
    pg_catalog.current_database()
  );
END;
$runtime_grants$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
