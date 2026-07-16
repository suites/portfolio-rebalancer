CREATE TYPE public."RebalanceMode" AS ENUM (
  'SHADOW',
  'PAPER',
  'LIVE'
);

CREATE TYPE public."RebalanceRunStatus" AS ENUM (
  'RUNNING',
  'NO_ACTION',
  'PLANNED',
  'BLOCKED',
  'FAILED'
);

CREATE TYPE public."RebalancePlanStatus" AS ENUM (
  'NO_ACTION',
  'PLANNED',
  'BLOCKED'
);

CREATE TABLE public."rebalance_run" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "snapshot_digest" CHAR(64) NOT NULL,
  "target_config_version_id" UUID NOT NULL,
  "target_config_content_hash" CHAR(64) NOT NULL,
  "mode" public."RebalanceMode" NOT NULL,
  "status" public."RebalanceRunStatus" NOT NULL DEFAULT 'RUNNING',
  "dedupe_key" CHAR(64) NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "app_version" TEXT NOT NULL,
  "policy_version" TEXT NOT NULL,
  "error_code" TEXT,
  CONSTRAINT "rebalance_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebalance_run_snapshot_digest_check" CHECK (
    "snapshot_digest" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "rebalance_run_target_config_content_hash_check" CHECK (
    "target_config_content_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "rebalance_run_dedupe_key_check" CHECK (
    "dedupe_key" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "rebalance_run_text_check" CHECK (
    BTRIM("app_version") <> ''
    AND BTRIM("policy_version") <> ''
  ),
  CONSTRAINT "rebalance_run_terminal_shape_check" CHECK (
    (
      "status" = 'RUNNING'
      AND "completed_at" IS NULL
      AND "error_code" IS NULL
    )
    OR (
      "status" = 'FAILED'
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "error_code" IS NOT NULL
      AND BTRIM("error_code") <> ''
    )
    OR (
      "status" IN ('NO_ACTION', 'PLANNED', 'BLOCKED')
      AND "completed_at" IS NOT NULL
      AND "completed_at" >= "started_at"
      AND "error_code" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "rebalance_run_dedupe_key_key"
ON public."rebalance_run"("dedupe_key");

CREATE INDEX "rebalance_run_account_id_started_at_idx"
ON public."rebalance_run"("account_id", "started_at" DESC);

CREATE INDEX "rebalance_run_snapshot_id_mode_idx"
ON public."rebalance_run"("snapshot_id", "mode");

ALTER TABLE public."rebalance_run"
ADD CONSTRAINT "rebalance_run_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_run"
ADD CONSTRAINT "rebalance_run_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES public."portfolio_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_run"
ADD CONSTRAINT "rebalance_run_target_config_version_id_fkey"
FOREIGN KEY ("target_config_version_id")
REFERENCES public."target_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."rebalance_plan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "target_config_version_id" UUID NOT NULL,
  "mode" public."RebalanceMode" NOT NULL,
  "status" public."RebalancePlanStatus" NOT NULL,
  "canonical_version" TEXT NOT NULL,
  "plan_hash" CHAR(64) NOT NULL,
  "return_policy" TEXT NOT NULL,
  "total_value_minor" BIGINT,
  "reason_codes" JSONB NOT NULL,
  "canonical_content" TEXT NOT NULL,
  "asset_decisions" JSONB NOT NULL,
  "deferred_buy_needs" JSONB NOT NULL,
  "projected_allocations" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebalance_plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebalance_plan_plan_hash_check" CHECK (
    "plan_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "rebalance_plan_policy_check" CHECK (
    BTRIM("canonical_version") <> ''
    AND "return_policy" IN ('BAND_EDGE', 'TARGET')
  ),
  CONSTRAINT "rebalance_plan_total_value_check" CHECK (
    (
      "status" = 'BLOCKED'
      AND "total_value_minor" IS NULL
    )
    OR (
      "status" IN ('NO_ACTION', 'PLANNED')
      AND "total_value_minor" IS NOT NULL
      AND "total_value_minor" > 0
    )
  ),
  CONSTRAINT "rebalance_plan_reason_codes_check" CHECK (
    pg_catalog.jsonb_typeof("reason_codes") = 'array'
    AND pg_catalog.jsonb_array_length("reason_codes") > 0
  ),
  CONSTRAINT "rebalance_plan_json_arrays_check" CHECK (
    pg_catalog.jsonb_typeof("asset_decisions") = 'array'
    AND pg_catalog.jsonb_typeof("deferred_buy_needs") = 'array'
    AND pg_catalog.jsonb_typeof("projected_allocations") = 'array'
  ),
  CONSTRAINT "rebalance_plan_canonical_content_check" CHECK (
    BTRIM("canonical_content") <> ''
    AND "plan_hash" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
      'hex'
    )
  )
);

CREATE UNIQUE INDEX "rebalance_plan_run_id_key"
ON public."rebalance_plan"("run_id");

CREATE UNIQUE INDEX "rebalance_plan_identity_key"
ON public."rebalance_plan"(
  "snapshot_id",
  "target_config_version_id",
  "mode",
  "plan_hash"
);

CREATE INDEX "rebalance_plan_created_at_idx"
ON public."rebalance_plan"("created_at" DESC);

ALTER TABLE public."rebalance_plan"
ADD CONSTRAINT "rebalance_plan_run_id_fkey"
FOREIGN KEY ("run_id")
REFERENCES public."rebalance_run"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_plan"
ADD CONSTRAINT "rebalance_plan_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES public."portfolio_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_plan"
ADD CONSTRAINT "rebalance_plan_target_config_version_id_fkey"
FOREIGN KEY ("target_config_version_id")
REFERENCES public."target_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."rebalance_plan_order" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "candidate_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "asset_class_id" TEXT NOT NULL,
  "instrument_key" TEXT NOT NULL,
  "market_country" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "order_type" TEXT NOT NULL,
  "time_in_force" TEXT NOT NULL,
  "quantity" BIGINT NOT NULL,
  "limit_price_minor" BIGINT NOT NULL,
  "notional_minor" BIGINT NOT NULL,
  "unallocated_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebalance_plan_order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebalance_plan_order_identity_check" CHECK (
    BTRIM("candidate_id") <> ''
    AND BTRIM("asset_class_id") <> ''
    AND "instrument_key" = "market_country" || ':' || "symbol"
  ),
  CONSTRAINT "rebalance_plan_order_kr_limit_day_check" CHECK (
    "market_country" = 'KR'
    AND "currency" = 'KRW'
    AND "symbol" ~ '^[A-Z0-9]{6}$'
    AND "order_type" = 'LIMIT'
    AND "time_in_force" = 'DAY'
  ),
  CONSTRAINT "rebalance_plan_order_phase_side_check" CHECK (
    "phase" IN ('SELL', 'BUY')
    AND "side" = "phase"
  ),
  CONSTRAINT "rebalance_plan_order_amount_check" CHECK (
    "ordinal" >= 0
    AND "quantity" > 0
    AND "limit_price_minor" > 0
    AND "notional_minor" = "quantity" * "limit_price_minor"
    AND "unallocated_minor" >= 0
  )
);

CREATE UNIQUE INDEX "rebalance_plan_order_plan_candidate_key"
ON public."rebalance_plan_order"("plan_id", "candidate_id");

CREATE UNIQUE INDEX "rebalance_plan_order_plan_phase_ordinal_key"
ON public."rebalance_plan_order"("plan_id", "phase", "ordinal");

ALTER TABLE public."rebalance_plan_order"
ADD CONSTRAINT "rebalance_plan_order_plan_id_fkey"
FOREIGN KEY ("plan_id")
REFERENCES public."rebalance_plan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.guard_rebalance_run() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  snapshot_account_id UUID;
  snapshot_digest CHAR(64);
  snapshot_target_config_version_id UUID;
  snapshot_validation_status TEXT;
  target_content_hash CHAR(64);
  target_status TEXT;
  target_account_id UUID;
  latest_snapshot_id UUID;
  plan_status TEXT;
  plan_order_count BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance run is append-only';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT
      snapshot."account_id",
      snapshot."digest",
      snapshot."target_config_version_id",
      snapshot."validation_status"::TEXT,
      target."content_hash",
      target."status"::TEXT,
      config."account_id"
    INTO
      snapshot_account_id,
      snapshot_digest,
      snapshot_target_config_version_id,
      snapshot_validation_status,
      target_content_hash,
      target_status,
      target_account_id
    FROM public."portfolio_snapshot" AS snapshot
    JOIN public."target_config_version" AS target
      ON target."id" = NEW."target_config_version_id"
    JOIN public."target_config" AS config
      ON config."id" = target."config_id"
    WHERE snapshot."id" = NEW."snapshot_id";

    SELECT latest."id"
    INTO latest_snapshot_id
    FROM public."portfolio_snapshot" AS latest
    WHERE latest."account_id" = NEW."account_id"
    ORDER BY latest."observed_at" DESC, latest."persisted_at" DESC, latest."id" DESC
    LIMIT 1;

    IF NOT FOUND
      OR snapshot_account_id IS DISTINCT FROM NEW."account_id"
      OR snapshot_digest IS DISTINCT FROM NEW."snapshot_digest"
      OR snapshot_target_config_version_id IS DISTINCT FROM NEW."target_config_version_id"
      OR target_content_hash IS DISTINCT FROM NEW."target_config_content_hash"
      OR snapshot_validation_status IS DISTINCT FROM 'VERIFIED'
      OR target_status IS DISTINCT FROM 'ACTIVE'
      OR target_account_id IS DISTINCT FROM NEW."account_id"
      OR latest_snapshot_id IS DISTINCT FROM NEW."snapshot_id" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'rebalance run must pin one verified snapshot and its exact target config';
    END IF;

    IF NEW."status" <> 'RUNNING' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'rebalance run must start in RUNNING state';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'RUNNING' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'terminal rebalance run is immutable';
  END IF;

  IF
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."snapshot_id" IS DISTINCT FROM OLD."snapshot_id"
    OR NEW."snapshot_digest" IS DISTINCT FROM OLD."snapshot_digest"
    OR NEW."target_config_version_id" IS DISTINCT FROM OLD."target_config_version_id"
    OR NEW."target_config_content_hash" IS DISTINCT FROM OLD."target_config_content_hash"
    OR NEW."mode" IS DISTINCT FROM OLD."mode"
    OR NEW."dedupe_key" IS DISTINCT FROM OLD."dedupe_key"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
    OR NEW."app_version" IS DISTINCT FROM OLD."app_version"
    OR NEW."policy_version" IS DISTINCT FROM OLD."policy_version" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance run pinned identity is immutable';
  END IF;

  IF NEW."status" = 'RUNNING' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance run cannot be updated without becoming terminal';
  END IF;

  SELECT plan."status"::TEXT, COUNT(plan_order."id")
  INTO plan_status, plan_order_count
  FROM public."rebalance_plan" AS plan
  LEFT JOIN public."rebalance_plan_order" AS plan_order
    ON plan_order."plan_id" = plan."id"
  WHERE plan."run_id" = NEW."id"
  GROUP BY plan."status";

  IF NEW."status" = 'FAILED' THEN
    IF FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'failed rebalance run cannot retain a sealed plan';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT FOUND OR plan_status IS DISTINCT FROM NEW."status"::TEXT THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'terminal rebalance run status must match its sealed plan';
  END IF;

  IF
    (NEW."status" = 'PLANNED' AND plan_order_count = 0)
    OR (NEW."status" IN ('NO_ACTION', 'BLOCKED') AND plan_order_count <> 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan order count does not match the terminal status';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_rebalance_plan() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  run_snapshot_id UUID;
  run_target_config_version_id UUID;
  run_mode TEXT;
  run_status TEXT;
  run_policy_version TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan is append-only';
  END IF;

  SELECT
    run."snapshot_id",
    run."target_config_version_id",
    run."mode"::TEXT,
    run."status"::TEXT,
    run."policy_version"
  INTO
    run_snapshot_id,
    run_target_config_version_id,
    run_mode,
    run_status,
    run_policy_version
  FROM public."rebalance_run" AS run
  WHERE run."id" = NEW."run_id"
  FOR UPDATE;

  IF NOT FOUND
    OR run_status IS DISTINCT FROM 'RUNNING'
    OR run_snapshot_id IS DISTINCT FROM NEW."snapshot_id"
    OR run_target_config_version_id IS DISTINCT FROM NEW."target_config_version_id"
    OR run_mode IS DISTINCT FROM NEW."mode"::TEXT
    OR run_policy_version IS DISTINCT FROM NEW."canonical_version" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan must match one running pinned run';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_rebalance_plan_order() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  plan_status TEXT;
  run_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan order is append-only';
  END IF;

  SELECT plan."status"::TEXT, run."status"::TEXT
  INTO plan_status, run_status
  FROM public."rebalance_plan" AS plan
  JOIN public."rebalance_run" AS run
    ON run."id" = plan."run_id"
  WHERE plan."id" = NEW."plan_id"
  FOR UPDATE OF run;

  IF NOT FOUND
    OR plan_status IS DISTINCT FROM 'PLANNED'
    OR run_status IS DISTINCT FROM 'RUNNING' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'plan orders can only be inserted into a PLANNED result before run sealing';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_rebalance_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'rebalance audit tables cannot be truncated';
END;
$$;

CREATE TRIGGER rebalance_run_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."rebalance_run"
FOR EACH ROW EXECUTE FUNCTION public.guard_rebalance_run();

CREATE TRIGGER rebalance_plan_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."rebalance_plan"
FOR EACH ROW EXECUTE FUNCTION public.guard_rebalance_plan();

CREATE TRIGGER rebalance_plan_order_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."rebalance_plan_order"
FOR EACH ROW EXECUTE FUNCTION public.guard_rebalance_plan_order();

CREATE TRIGGER rebalance_run_truncate_guard
BEFORE TRUNCATE ON public."rebalance_run"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_rebalance_truncate();

CREATE TRIGGER rebalance_plan_truncate_guard
BEFORE TRUNCATE ON public."rebalance_plan"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_rebalance_truncate();

CREATE TRIGGER rebalance_plan_order_truncate_guard
BEFORE TRUNCATE ON public."rebalance_plan_order"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_rebalance_truncate();

ALTER TABLE public."rebalance_run" ENABLE ALWAYS TRIGGER "rebalance_run_guard";
ALTER TABLE public."rebalance_plan" ENABLE ALWAYS TRIGGER "rebalance_plan_guard";
ALTER TABLE public."rebalance_plan_order" ENABLE ALWAYS TRIGGER "rebalance_plan_order_guard";
ALTER TABLE public."rebalance_run" ENABLE ALWAYS TRIGGER "rebalance_run_truncate_guard";
ALTER TABLE public."rebalance_plan" ENABLE ALWAYS TRIGGER "rebalance_plan_truncate_guard";
ALTER TABLE public."rebalance_plan_order" ENABLE ALWAYS TRIGGER "rebalance_plan_order_truncate_guard";
