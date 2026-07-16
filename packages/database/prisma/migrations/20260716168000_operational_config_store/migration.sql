CREATE TABLE public."operational_config" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operational_config_account_id_key"
ON public."operational_config"("account_id");

ALTER TABLE public."operational_config"
ADD CONSTRAINT "operational_config_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."operational_config_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "config_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "schema_version" TEXT NOT NULL,
  "canonical_content" TEXT NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_config_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_config_version_content_check" CHECK (
    "version" >= 1
    AND "schema_version" = 'OPERATIONAL_CONFIG_V1'
    AND BTRIM("canonical_content") <> ''
    AND "content_hash" ~ '^[0-9a-f]{64}$'
    AND "content_hash" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
      'hex'
    )
    AND pg_catalog.jsonb_typeof("payload") = 'object'
    AND "payload" = "canonical_content"::JSONB
    AND "payload" ->> 'schemaVersion' = "schema_version"
    AND "payload" ->> 'mode' IN ('PAPER', 'LIVE')
    AND pg_catalog.jsonb_typeof("payload" -> 'killSwitch') = 'boolean'
    AND pg_catalog.jsonb_typeof("payload" #> '{freshness,quote}') = 'object'
    AND pg_catalog.jsonb_typeof("payload" #> '{freshness,calendar}') = 'object'
    AND pg_catalog.jsonb_typeof("payload" -> 'limits') = 'object'
    AND pg_catalog.jsonb_typeof("payload" -> 'live') = 'object'
    AND ("payload" #>> '{freshness,quote,planMaxAgeSeconds}')::INTEGER BETWEEN 1 AND 300
    AND ("payload" #>> '{freshness,quote,preSubmitMaxAgeSeconds}')::INTEGER BETWEEN 1 AND 30
    AND ("payload" #>> '{freshness,quote,preSubmitMaxAgeSeconds}')::INTEGER
      <= ("payload" #>> '{freshness,quote,planMaxAgeSeconds}')::INTEGER
    AND ("payload" #>> '{freshness,quote,futureToleranceSeconds}')::INTEGER BETWEEN 0 AND 60
    AND ("payload" #>> '{freshness,calendar,maxAgeSeconds}')::INTEGER BETWEEN 1 AND 172800
    AND ("payload" #>> '{freshness,calendar,futureToleranceSeconds}')::INTEGER BETWEEN 0 AND 60
    AND "payload" #>> '{limits,minimumOrderGrossMinor}' ~ '^[1-9][0-9]*$'
    AND "payload" #>> '{limits,feeBufferMinor}' ~ '^(0|[1-9][0-9]*)$'
    AND "payload" #>> '{limits,maxSingleOrderGrossMinor}' ~ '^[1-9][0-9]*$'
    AND "payload" #>> '{limits,maxDailyGrossMinor}' ~ '^[1-9][0-9]*$'
    AND ("payload" #>> '{limits,minimumOrderGrossMinor}')::NUMERIC
      <= ("payload" #>> '{limits,maxSingleOrderGrossMinor}')::NUMERIC
    AND ("payload" #>> '{limits,maxSingleOrderGrossMinor}')::NUMERIC
      <= ("payload" #>> '{limits,maxDailyGrossMinor}')::NUMERIC
    AND ("payload" #>> '{limits,maxDailyTurnoverBasisPoints}')::INTEGER BETWEEN 0 AND 10000
    AND ("payload" #>> '{limits,maxAbsolutePriceChangeBasisPoints}')::INTEGER BETWEEN 0 AND 10000
    AND ("payload" #>> '{limits,maxInstrumentWeightBasisPoints}')::INTEGER BETWEEN 0 AND 10000
    AND ("payload" #>> '{limits,maxAssetClassWeightBasisPoints}')::INTEGER BETWEEN 0 AND 10000
    AND ("payload" #>> '{limits,maxRiskyWeightBasisPoints}')::INTEGER BETWEEN 0 AND 10000
    AND pg_catalog.jsonb_typeof("payload" #> '{live,enabled}') = 'boolean'
    AND "payload" #>> '{live,marketCountry}' = 'KR'
    AND "payload" #>> '{live,allowedSession}' = 'REGULAR_MARKET'
    AND "payload" #>> '{live,orderType}' = 'LIMIT'
    AND "payload" #>> '{live,timeInForce}' = 'DAY'
    AND pg_catalog.jsonb_typeof("payload" #> '{live,accountAllowlistHmacs}') = 'array'
    AND pg_catalog.jsonb_array_length("payload" #> '{live,accountAllowlistHmacs}') <= 20
    AND pg_catalog.jsonb_typeof("payload" #> '{live,manualApprovalRequired}') = 'boolean'
    AND ("payload" #>> '{live,approvalTtlSeconds}')::INTEGER BETWEEN 1 AND 600
    AND "payload" #>> '{live,maxSingleOrderGrossMinor}' ~ '^[1-9][0-9]*$'
    AND "payload" #>> '{live,maxDailyGrossMinor}' ~ '^[1-9][0-9]*$'
    AND "payload" #>> '{live,tinyLiveMaxGrossMinor}' ~ '^[1-9][0-9]*$'
    AND ("payload" #>> '{live,maxSingleOrderGrossMinor}')::NUMERIC <= 100000
    AND ("payload" #>> '{live,maxDailyGrossMinor}')::NUMERIC <= 300000
    AND ("payload" #>> '{live,tinyLiveMaxGrossMinor}')::NUMERIC <= 50000
    AND ("payload" #>> '{live,maxSingleOrderGrossMinor}')::NUMERIC
      <= ("payload" #>> '{live,maxDailyGrossMinor}')::NUMERIC
    AND ("payload" #>> '{live,tinyLiveMaxGrossMinor}')::NUMERIC
      <= ("payload" #>> '{live,maxSingleOrderGrossMinor}')::NUMERIC
    AND ("payload" #>> '{live,maxSingleOrderGrossMinor}')::NUMERIC
      <= ("payload" #>> '{limits,maxSingleOrderGrossMinor}')::NUMERIC
    AND ("payload" #>> '{live,maxDailyGrossMinor}')::NUMERIC
      <= ("payload" #>> '{limits,maxDailyGrossMinor}')::NUMERIC
    AND (
      "payload" ->> 'mode' = 'PAPER'
      OR (
        "payload" ->> 'mode' = 'LIVE'
        AND ("payload" #>> '{live,enabled}')::BOOLEAN = TRUE
      )
    )
    AND (
      ("payload" #>> '{live,enabled}')::BOOLEAN = FALSE
      OR (
        ("payload" ->> 'killSwitch')::BOOLEAN = FALSE
        AND ("payload" #>> '{live,manualApprovalRequired}')::BOOLEAN = TRUE
        AND pg_catalog.jsonb_array_length("payload" #> '{live,accountAllowlistHmacs}') > 0
        AND ("payload" #>> '{limits,minimumOrderGrossMinor}')::NUMERIC
          <= ("payload" #>> '{live,tinyLiveMaxGrossMinor}')::NUMERIC
      )
    )
  )
);

CREATE UNIQUE INDEX "operational_config_version_config_version_key"
ON public."operational_config_version"("config_id", "version");

CREATE UNIQUE INDEX "operational_config_version_config_hash_key"
ON public."operational_config_version"("config_id", "content_hash");

CREATE INDEX "operational_config_version_config_id_created_at_idx"
ON public."operational_config_version"("config_id", "created_at" DESC);

ALTER TABLE public."operational_config_version"
ADD CONSTRAINT "operational_config_version_config_id_fkey"
FOREIGN KEY ("config_id")
REFERENCES public."operational_config"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."operational_config_activation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "config_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "operational_config_version_id" UUID NOT NULL,
  "actor" TEXT NOT NULL,
  "confirmation_version" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "operational_config_activation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_config_activation_content_check" CHECK (
    "version" >= 1
    AND BTRIM("actor") <> ''
    AND "confirmation_version" = 'OPERATIONAL_CONFIG_ACTIVATION_V1'
    AND "created_at" >= "occurred_at"
  )
);

CREATE UNIQUE INDEX "operational_config_activation_config_version_key"
ON public."operational_config_activation"("config_id", "version");

CREATE UNIQUE INDEX "operational_config_activation_config_version_id_key"
ON public."operational_config_activation"("operational_config_version_id");

CREATE INDEX "operational_config_activation_config_id_occurred_at_idx"
ON public."operational_config_activation"("config_id", "occurred_at" DESC);

ALTER TABLE public."operational_config_activation"
ADD CONSTRAINT "operational_config_activation_config_id_fkey"
FOREIGN KEY ("config_id")
REFERENCES public."operational_config"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."operational_config_activation"
ADD CONSTRAINT "operational_config_activation_config_version_id_fkey"
FOREIGN KEY ("operational_config_version_id")
REFERENCES public."operational_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."live_promotion_event"
ADD COLUMN "operational_config_version_id" UUID;

ALTER TABLE public."live_promotion_event"
ADD CONSTRAINT "live_promotion_event_operational_config_version_id_fkey"
FOREIGN KEY ("operational_config_version_id")
REFERENCES public."operational_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."execution_risk_evidence"
ADD COLUMN "operational_config_version_id" UUID;

ALTER TABLE public."execution_risk_evidence"
ADD CONSTRAINT "execution_risk_evidence_operational_config_version_id_fkey"
FOREIGN KEY ("operational_config_version_id")
REFERENCES public."operational_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.guard_operational_config() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'operational config identity is immutable';
  END IF;
  NEW."created_at" := pg_catalog.statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_operational_config_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  latest_version INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'operational config versions are immutable';
  END IF;

  PERFORM 1
  FROM public."operational_config" AS config
  WHERE config."id" = NEW."config_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'operational config version requires an existing config';
  END IF;

  SELECT MAX(version."version")
  INTO latest_version
  FROM public."operational_config_version" AS version
  WHERE version."config_id" = NEW."config_id";

  IF NEW."version" IS DISTINCT FROM COALESCE(latest_version, 0) + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'operational config versions must be contiguous';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements_text(
      NEW."payload" #> '{live,accountAllowlistHmacs}'
    ) AS allowlist(value)
    WHERE allowlist.value !~ '^[0-9a-f]{64}$'
  ) OR (
    SELECT COUNT(*)
    FROM pg_catalog.jsonb_array_elements_text(
      NEW."payload" #> '{live,accountAllowlistHmacs}'
    ) AS allowlist(value)
  ) IS DISTINCT FROM (
    SELECT COUNT(DISTINCT allowlist.value)
    FROM pg_catalog.jsonb_array_elements_text(
      NEW."payload" #> '{live,accountAllowlistHmacs}'
    ) AS allowlist(value)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'operational config account allowlist must contain unique SHA-256 HMAC values';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_operational_config_activation() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  previous_version INTEGER;
  linked_config_id UUID;
  latest_config_version_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'operational config activations are append-only';
  END IF;

  PERFORM 1
  FROM public."operational_config" AS config
  WHERE config."id" = NEW."config_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'operational config activation requires an existing config';
  END IF;

  SELECT version."config_id"
  INTO linked_config_id
  FROM public."operational_config_version" AS version
  WHERE version."id" = NEW."operational_config_version_id";

  SELECT version."id"
  INTO latest_config_version_id
  FROM public."operational_config_version" AS version
  WHERE version."config_id" = NEW."config_id"
  ORDER BY version."version" DESC
  LIMIT 1;

  SELECT MAX(activation."version")
  INTO previous_version
  FROM public."operational_config_activation" AS activation
  WHERE activation."config_id" = NEW."config_id";

  IF linked_config_id IS DISTINCT FROM NEW."config_id"
    OR latest_config_version_id IS DISTINCT FROM NEW."operational_config_version_id"
    OR NEW."version" IS DISTINCT FROM COALESCE(previous_version, 0) + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'activation must select the latest unactivated operational config version';
  END IF;

  NEW."occurred_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."occurred_at";
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_live_promotion_operational_config() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  config_account_id UUID;
  config_account_hmac CHAR(64);
  config_hash CHAR(64);
  config_payload JSONB;
  latest_active_version_id UUID;
BEGIN
  IF NEW."operational_config_version_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'live promotion requires the current active operational config version';
  END IF;

  SELECT
    config."account_id",
    account."external_ref_hmac",
    version."content_hash",
    version."payload"
  INTO
    config_account_id,
    config_account_hmac,
    config_hash,
    config_payload
  FROM public."operational_config_version" AS version
  JOIN public."operational_config" AS config
    ON config."id" = version."config_id"
  JOIN public."broker_account" AS account
    ON account."id" = config."account_id"
  WHERE version."id" = NEW."operational_config_version_id";

  SELECT activation."operational_config_version_id"
  INTO latest_active_version_id
  FROM public."operational_config_activation" AS activation
  WHERE activation."config_id" = (
    SELECT version."config_id"
    FROM public."operational_config_version" AS version
    WHERE version."id" = NEW."operational_config_version_id"
  )
  ORDER BY activation."version" DESC
  LIMIT 1;

  IF config_account_id IS DISTINCT FROM NEW."account_id"
    OR config_account_hmac IS DISTINCT FROM NEW."account_allowlist_hmac"
    OR config_hash IS DISTINCT FROM NEW."operational_config_sha256"
    OR latest_active_version_id IS DISTINCT FROM NEW."operational_config_version_id"
    OR (config_payload #>> '{live,maxSingleOrderGrossMinor}')::BIGINT
      IS DISTINCT FROM NEW."max_single_order_gross_minor"
    OR (config_payload #>> '{live,maxDailyGrossMinor}')::BIGINT
      IS DISTINCT FROM NEW."max_daily_gross_minor"
    OR (config_payload #>> '{live,tinyLiveMaxGrossMinor}')::BIGINT
      IS DISTINCT FROM NEW."tiny_live_max_gross_minor"
    OR (
      NEW."state"::TEXT = 'GRANTED'
      AND (
        config_payload ->> 'mode' IS DISTINCT FROM 'LIVE'
        OR (config_payload ->> 'killSwitch')::BOOLEAN IS DISTINCT FROM FALSE
        OR (config_payload #>> '{live,enabled}')::BOOLEAN IS DISTINCT FROM TRUE
        OR (config_payload #>> '{live,manualApprovalRequired}')::BOOLEAN IS DISTINCT FROM TRUE
        OR NOT (config_payload #> '{live,accountAllowlistHmacs}' ? NEW."account_allowlist_hmac")
      )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'live promotion must bind the current active operational config and GRANTED requires ACTIVE LIVE policy';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_execution_risk_operational_config() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  promotion_config_version_id UUID;
  config_account_id UUID;
  config_canonical TEXT;
  config_hash CHAR(64);
  latest_active_version_id UUID;
BEGIN
  IF NEW."operational_config_version_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'execution risk evidence requires the current active operational config version';
  END IF;

  SELECT promotion."operational_config_version_id"
  INTO promotion_config_version_id
  FROM public."live_promotion_event" AS promotion
  WHERE promotion."id" = NEW."promotion_event_id";

  SELECT
    config."account_id",
    version."canonical_content",
    version."content_hash"
  INTO
    config_account_id,
    config_canonical,
    config_hash
  FROM public."operational_config_version" AS version
  JOIN public."operational_config" AS config
    ON config."id" = version."config_id"
  WHERE version."id" = NEW."operational_config_version_id";

  SELECT activation."operational_config_version_id"
  INTO latest_active_version_id
  FROM public."operational_config_activation" AS activation
  WHERE activation."config_id" = (
    SELECT version."config_id"
    FROM public."operational_config_version" AS version
    WHERE version."id" = NEW."operational_config_version_id"
  )
  ORDER BY activation."version" DESC
  LIMIT 1;

  IF promotion_config_version_id IS DISTINCT FROM NEW."operational_config_version_id"
    OR config_account_id IS DISTINCT FROM NEW."account_id"
    OR config_canonical IS DISTINCT FROM NEW."operational_config_canonical"
    OR config_hash IS DISTINCT FROM NEW."operational_config_sha256"
    OR latest_active_version_id IS DISTINCT FROM NEW."operational_config_version_id" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'execution risk evidence must bind the exact current ACTIVE config used by promotion';
  END IF;

  RETURN NEW;
END;
$$;

CREATE VIEW public."operational_config_current" AS
SELECT
  config."id" AS "config_id",
  config."account_id",
  version."id" AS "operational_config_version_id",
  version."version" AS "config_version",
  version."schema_version",
  version."canonical_content",
  version."content_hash",
  version."payload",
  activation."version" AS "activation_version",
  activation."occurred_at" AS "activated_at"
FROM public."operational_config" AS config
JOIN LATERAL (
  SELECT current_activation.*
  FROM public."operational_config_activation" AS current_activation
  WHERE current_activation."config_id" = config."id"
  ORDER BY current_activation."version" DESC
  LIMIT 1
) AS activation ON TRUE
JOIN public."operational_config_version" AS version
  ON version."id" = activation."operational_config_version_id";

CREATE FUNCTION public.reject_operational_config_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'operational config audit tables cannot be truncated';
END;
$$;

CREATE TRIGGER operational_config_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."operational_config"
FOR EACH ROW EXECUTE FUNCTION public.guard_operational_config();

CREATE TRIGGER operational_config_version_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."operational_config_version"
FOR EACH ROW EXECUTE FUNCTION public.guard_operational_config_version();

CREATE TRIGGER operational_config_activation_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."operational_config_activation"
FOR EACH ROW EXECUTE FUNCTION public.guard_operational_config_activation();

CREATE TRIGGER live_promotion_operational_config_guard
BEFORE INSERT ON public."live_promotion_event"
FOR EACH ROW EXECUTE FUNCTION public.guard_live_promotion_operational_config();

CREATE TRIGGER execution_risk_operational_config_guard
BEFORE INSERT ON public."execution_risk_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_execution_risk_operational_config();

CREATE TRIGGER operational_config_truncate_guard
BEFORE TRUNCATE ON public."operational_config"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_operational_config_truncate();

CREATE TRIGGER operational_config_version_truncate_guard
BEFORE TRUNCATE ON public."operational_config_version"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_operational_config_truncate();

CREATE TRIGGER operational_config_activation_truncate_guard
BEFORE TRUNCATE ON public."operational_config_activation"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_operational_config_truncate();

ALTER TABLE public."operational_config"
ENABLE ALWAYS TRIGGER operational_config_guard;
ALTER TABLE public."operational_config"
ENABLE ALWAYS TRIGGER operational_config_truncate_guard;
ALTER TABLE public."operational_config_version"
ENABLE ALWAYS TRIGGER operational_config_version_guard;
ALTER TABLE public."operational_config_version"
ENABLE ALWAYS TRIGGER operational_config_version_truncate_guard;
ALTER TABLE public."operational_config_activation"
ENABLE ALWAYS TRIGGER operational_config_activation_guard;
ALTER TABLE public."operational_config_activation"
ENABLE ALWAYS TRIGGER operational_config_activation_truncate_guard;
ALTER TABLE public."live_promotion_event"
ENABLE ALWAYS TRIGGER live_promotion_operational_config_guard;
ALTER TABLE public."execution_risk_evidence"
ENABLE ALWAYS TRIGGER execution_risk_operational_config_guard;
