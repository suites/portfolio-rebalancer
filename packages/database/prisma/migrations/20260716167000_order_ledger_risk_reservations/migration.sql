CREATE TYPE public."OrderLedgerState" AS ENUM (
  'PLANNED',
  'SUBMITTING',
  'PENDING',
  'PARTIAL_FILLED',
  'FILLED',
  'CANCELED',
  'REJECTED',
  'UNKNOWN',
  'UNKNOWN_BLOCKED'
);

CREATE TYPE public."KillSwitchState" AS ENUM (
  'ENGAGED',
  'DISENGAGED'
);

CREATE TYPE public."BrokerOrderActionKind" AS ENUM (
  'CANCEL',
  'REPLACE'
);

CREATE TYPE public."BrokerOrderEvidenceKind" AS ENUM (
  'SUBMIT',
  'RECONCILE',
  'CANCEL_ATTEMPT',
  'REPLACE_ATTEMPT'
);

CREATE TYPE public."LivePromotionState" AS ENUM (
  'REVOKED',
  'GRANTED'
);

CREATE FUNCTION public.expected_toss_client_order_id(canonical_intent TEXT) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO pg_catalog
AS $$
  SELECT 'pr1_' || LEFT(
    TRANSLATE(
      RTRIM(
        pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(canonical_intent, 'UTF8')),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    ),
    32
  );
$$;

CREATE TABLE public."rebalance_plan_version" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "target_config_version_id" UUID NOT NULL,
  "mode" public."RebalanceMode" NOT NULL,
  "status" public."RebalancePlanStatus" NOT NULL,
  "canonical_version" TEXT NOT NULL,
  "plan_hash" CHAR(64) NOT NULL,
  "canonical_content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rebalance_plan_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rebalance_plan_version_identity_check" CHECK (
    "version" >= 1
    AND "phase" IN ('INITIAL', 'SELL', 'BUY')
    AND "mode" IN ('SHADOW', 'PAPER', 'LIVE')
    AND "plan_hash" ~ '^[0-9a-f]{64}$'
    AND BTRIM("canonical_version") <> ''
    AND BTRIM("canonical_content") <> ''
    AND "plan_hash" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
      'hex'
    )
  )
);

CREATE UNIQUE INDEX "rebalance_plan_version_plan_version_key"
ON public."rebalance_plan_version"("plan_id", "version");

CREATE UNIQUE INDEX "rebalance_plan_version_id_version_key"
ON public."rebalance_plan_version"("id", "version");

CREATE INDEX "rebalance_plan_version_snapshot_id_created_at_idx"
ON public."rebalance_plan_version"("snapshot_id", "created_at" DESC);

ALTER TABLE public."rebalance_plan_version"
ADD CONSTRAINT "rebalance_plan_version_plan_id_fkey"
FOREIGN KEY ("plan_id")
REFERENCES public."rebalance_plan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_plan_version"
ADD CONSTRAINT "rebalance_plan_version_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES public."portfolio_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."rebalance_plan_version"
ADD CONSTRAINT "rebalance_plan_version_target_config_version_id_fkey"
FOREIGN KEY ("target_config_version_id")
REFERENCES public."target_config_version"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

INSERT INTO public."rebalance_plan_version" (
  "plan_id",
  "version",
  "phase",
  "snapshot_id",
  "target_config_version_id",
  "mode",
  "status",
  "canonical_version",
  "plan_hash",
  "canonical_content",
  "created_at"
)
SELECT
  plan."id",
  1,
  'INITIAL',
  plan."snapshot_id",
  plan."target_config_version_id",
  plan."mode",
  plan."status",
  plan."canonical_version",
  plan."plan_hash",
  plan."canonical_content",
  plan."created_at"
FROM public."rebalance_plan" AS plan;

ALTER TABLE public."rebalance_plan_order"
ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1;

DROP INDEX public."rebalance_plan_order_plan_candidate_key";
DROP INDEX public."rebalance_plan_order_plan_phase_ordinal_key";

CREATE UNIQUE INDEX "rebalance_plan_order_plan_version_candidate_key"
ON public."rebalance_plan_order"("plan_id", "plan_version", "candidate_id");

CREATE UNIQUE INDEX "rebalance_plan_order_plan_version_phase_ordinal_key"
ON public."rebalance_plan_order"("plan_id", "plan_version", "phase", "ordinal");

ALTER TABLE public."rebalance_plan_order"
ADD CONSTRAINT "rebalance_plan_order_plan_id_plan_version_fkey"
FOREIGN KEY ("plan_id", "plan_version")
REFERENCES public."rebalance_plan_version"("plan_id", "version")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."live_promotion_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "state" public."LivePromotionState" NOT NULL,
  "operational_config_sha256" CHAR(64) NOT NULL,
  "account_allowlist_hmac" CHAR(64) NOT NULL,
  "max_single_order_gross_minor" BIGINT NOT NULL,
  "max_daily_gross_minor" BIGINT NOT NULL,
  "tiny_live_max_gross_minor" BIGINT NOT NULL,
  "actor" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "live_promotion_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "live_promotion_event_content_check" CHECK (
    "version" >= 1
    AND "operational_config_sha256" ~ '^[0-9a-f]{64}$'
    AND "account_allowlist_hmac" ~ '^[0-9a-f]{64}$'
    AND "max_single_order_gross_minor" > 0
    AND "max_single_order_gross_minor" <= 100000
    AND "max_daily_gross_minor" >= "max_single_order_gross_minor"
    AND "max_daily_gross_minor" <= 300000
    AND "tiny_live_max_gross_minor" > 0
    AND "tiny_live_max_gross_minor" <= "max_single_order_gross_minor"
    AND "tiny_live_max_gross_minor" <= 50000
    AND BTRIM("actor") <> ''
    AND BTRIM("reason") <> ''
    AND "created_at" >= "occurred_at"
  )
);

CREATE UNIQUE INDEX "live_promotion_event_account_version_key"
ON public."live_promotion_event"("account_id", "version");

CREATE INDEX "live_promotion_event_account_id_occurred_at_idx"
ON public."live_promotion_event"("account_id", "occurred_at" DESC);

ALTER TABLE public."live_promotion_event"
ADD CONSTRAINT "live_promotion_event_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."execution_risk_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "account_id" UUID NOT NULL,
  "promotion_event_id" UUID NOT NULL,
  "operational_config_canonical" TEXT NOT NULL,
  "operational_config_sha256" CHAR(64) NOT NULL,
  "account_allowlist_hmac" CHAR(64) NOT NULL,
  "checks" JSONB NOT NULL,
  "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "execution_risk_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "execution_risk_evidence_content_check" CHECK (
    "plan_version" >= 1
    AND "operational_config_sha256" ~ '^[0-9a-f]{64}$'
    AND "account_allowlist_hmac" ~ '^[0-9a-f]{64}$'
    AND BTRIM("operational_config_canonical") <> ''
    AND "operational_config_sha256" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("operational_config_canonical", 'UTF8')),
      'hex'
    )
    AND pg_catalog.jsonb_typeof("checks") = 'array'
    AND "expires_at" > "evaluated_at"
    AND "expires_at" <= "evaluated_at" + INTERVAL '30 seconds'
    AND "created_at" >= "evaluated_at"
  )
);

CREATE INDEX "execution_risk_evidence_plan_version_evaluated_at_idx"
ON public."execution_risk_evidence"("plan_id", "plan_version", "evaluated_at" DESC);

CREATE INDEX "execution_risk_evidence_account_id_expires_at_idx"
ON public."execution_risk_evidence"("account_id", "expires_at");

ALTER TABLE public."execution_risk_evidence"
ADD CONSTRAINT "execution_risk_evidence_plan_id_fkey"
FOREIGN KEY ("plan_id")
REFERENCES public."rebalance_plan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."execution_risk_evidence"
ADD CONSTRAINT "execution_risk_evidence_plan_id_plan_version_fkey"
FOREIGN KEY ("plan_id", "plan_version")
REFERENCES public."rebalance_plan_version"("plan_id", "version")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."execution_risk_evidence"
ADD CONSTRAINT "execution_risk_evidence_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."execution_risk_evidence"
ADD CONSTRAINT "execution_risk_evidence_promotion_event_id_fkey"
FOREIGN KEY ("promotion_event_id")
REFERENCES public."live_promotion_event"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."pre_submit_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "execution_risk_evidence_id" UUID NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "planned_price_snapshot_id" UUID NOT NULL,
  "quote_response_validation_id" UUID NOT NULL,
  "price_limit_response_validation_id" UUID NOT NULL,
  "calendar_response_validation_id" UUID NOT NULL,
  "capacity_response_validation_id" UUID NOT NULL,
  "instrument_response_validation_id" UUID NOT NULL,
  "warnings_response_validation_id" UUID NOT NULL,
  "open_orders_response_validation_id" UUID NOT NULL,
  "planned_quote_price_minor" BIGINT NOT NULL,
  "current_quote_price_minor" BIGINT NOT NULL,
  "lower_price_limit_minor" BIGINT NOT NULL,
  "upper_price_limit_minor" BIGINT NOT NULL,
  "reservation_basis_price_minor" BIGINT NOT NULL,
  "reserved_gross_minor" BIGINT NOT NULL,
  "checks" JSONB NOT NULL,
  "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pre_submit_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pre_submit_evidence_amount_check" CHECK (
    "planned_quote_price_minor" > 0
    AND "current_quote_price_minor" > 0
    AND "lower_price_limit_minor" > 0
    AND "upper_price_limit_minor" >= "lower_price_limit_minor"
    AND "reservation_basis_price_minor" > 0
    AND "reserved_gross_minor" > 0
  ),
  CONSTRAINT "pre_submit_evidence_content_check" CHECK (
    pg_catalog.jsonb_typeof("checks") = 'array'
    AND "expires_at" > "evaluated_at"
    AND "expires_at" <= "evaluated_at" + INTERVAL '30 seconds'
    AND "created_at" >= "evaluated_at"
  )
);

CREATE INDEX "pre_submit_evidence_plan_order_id_evaluated_at_idx"
ON public."pre_submit_evidence"("plan_order_id", "evaluated_at" DESC);

CREATE INDEX "pre_submit_evidence_account_id_expires_at_idx"
ON public."pre_submit_evidence"("account_id", "expires_at");

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_execution_risk_evidence_id_fkey"
FOREIGN KEY ("execution_risk_evidence_id")
REFERENCES public."execution_risk_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_plan_order_id_fkey"
FOREIGN KEY ("plan_order_id")
REFERENCES public."rebalance_plan_order"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_planned_price_snapshot_id_fkey"
FOREIGN KEY ("planned_price_snapshot_id")
REFERENCES public."price_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_quote_response_validation_id_fkey"
FOREIGN KEY ("quote_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_price_limit_response_validation_id_fkey"
FOREIGN KEY ("price_limit_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_calendar_response_validation_id_fkey"
FOREIGN KEY ("calendar_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_capacity_response_validation_id_fkey"
FOREIGN KEY ("capacity_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_instrument_response_validation_id_fkey"
FOREIGN KEY ("instrument_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_warnings_response_validation_id_fkey"
FOREIGN KEY ("warnings_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_open_orders_response_validation_id_fkey"
FOREIGN KEY ("open_orders_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."daily_trade_limit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "trade_day" DATE NOT NULL,
  "market_country" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "mode" public."RebalanceMode" NOT NULL,
  "gross_limit_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_trade_limit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_trade_limit_kr_mode_check" CHECK (
    "market_country" = 'KR'
    AND "currency" = 'KRW'
    AND "mode" IN ('PAPER', 'LIVE')
  ),
  CONSTRAINT "daily_trade_limit_amount_check" CHECK (
    "gross_limit_minor" > 0
    AND ("mode" <> 'LIVE' OR "gross_limit_minor" <= 300000)
    AND "trade_day" = ("created_at" AT TIME ZONE 'Asia/Seoul')::DATE
  )
);

CREATE UNIQUE INDEX "daily_trade_limit_account_day_market_mode_key"
ON public."daily_trade_limit"("account_id", "trade_day", "market_country", "mode");

CREATE INDEX "daily_trade_limit_account_id_trade_day_idx"
ON public."daily_trade_limit"("account_id", "trade_day" DESC);

ALTER TABLE public."daily_trade_limit"
ADD CONSTRAINT "daily_trade_limit_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "daily_trade_limit_id" UUID NOT NULL,
  "mode" public."RebalanceMode" NOT NULL,
  "logical_order_id" UUID NOT NULL,
  "client_order_id" CHAR(36) NOT NULL,
  "client_order_id_version" TEXT NOT NULL,
  "canonical_intent" TEXT NOT NULL,
  "intent_sha256" CHAR(64) NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "market_country" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "order_type" TEXT NOT NULL,
  "time_in_force" TEXT NOT NULL,
  "quantity" BIGINT NOT NULL,
  "limit_price_minor" BIGINT NOT NULL,
  "planned_gross_notional_minor" BIGINT NOT NULL,
  "reserved_gross_minor" BIGINT NOT NULL,
  "reservation_basis_price_minor" BIGINT NOT NULL,
  "reservation_policy_version" TEXT NOT NULL,
  "reservation_evidence_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_ledger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_ledger_mode_check" CHECK ("mode" IN ('PAPER', 'LIVE')),
  CONSTRAINT "order_ledger_client_order_id_check" CHECK (
    "client_order_id" ~ '^pr1_[A-Za-z0-9_-]{32}$'
    AND pg_catalog.char_length("client_order_id") = 36
    AND "client_order_id_version" = 'TOSS_CLIENT_ORDER_ID_V1'
    AND "client_order_id" = public.expected_toss_client_order_id("canonical_intent")
  ),
  CONSTRAINT "order_ledger_intent_hash_check" CHECK (
    "intent_sha256" ~ '^[0-9a-f]{64}$'
    AND "intent_sha256" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_intent", 'UTF8')),
      'hex'
    )
  ),
  CONSTRAINT "order_ledger_kr_limit_day_check" CHECK (
    "plan_version" >= 1
    AND "market_country" = 'KR'
    AND "currency" = 'KRW'
    AND "symbol" ~ '^[A-Z0-9]{6}$'
    AND "order_type" = 'LIMIT'
    AND "time_in_force" = 'DAY'
  ),
  CONSTRAINT "order_ledger_phase_side_check" CHECK (
    "phase" IN ('SELL', 'BUY')
    AND "side" = "phase"
  ),
  CONSTRAINT "order_ledger_amount_check" CHECK (
    "quantity" > 0
    AND "limit_price_minor" > 0
    AND "planned_gross_notional_minor" = "quantity" * "limit_price_minor"
    AND "reservation_policy_version" = 'ORDER_GROSS_RESERVATION_V1'
    AND "reservation_basis_price_minor" >= "limit_price_minor"
    AND "reserved_gross_minor" = "quantity" * "reservation_basis_price_minor"
    AND ("mode" <> 'LIVE' OR "reserved_gross_minor" <= 100000)
  )
);

CREATE UNIQUE INDEX "order_ledger_plan_order_id_key"
ON public."order_ledger"("plan_order_id");

CREATE UNIQUE INDEX "order_ledger_logical_order_id_key"
ON public."order_ledger"("logical_order_id");

CREATE UNIQUE INDEX "order_ledger_client_order_id_key"
ON public."order_ledger"("client_order_id");

CREATE UNIQUE INDEX "order_ledger_reservation_evidence_id_key"
ON public."order_ledger"("reservation_evidence_id");

CREATE INDEX "order_ledger_account_id_created_at_idx"
ON public."order_ledger"("account_id", "created_at" DESC);

CREATE INDEX "order_ledger_daily_trade_limit_id_idx"
ON public."order_ledger"("daily_trade_limit_id");

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_plan_id_fkey"
FOREIGN KEY ("plan_id")
REFERENCES public."rebalance_plan"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_plan_id_plan_version_fkey"
FOREIGN KEY ("plan_id", "plan_version")
REFERENCES public."rebalance_plan_version"("plan_id", "version")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_plan_order_id_fkey"
FOREIGN KEY ("plan_order_id")
REFERENCES public."rebalance_plan_order"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_daily_trade_limit_id_fkey"
FOREIGN KEY ("daily_trade_limit_id")
REFERENCES public."daily_trade_limit"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_ledger"
ADD CONSTRAINT "order_ledger_reservation_evidence_id_fkey"
FOREIGN KEY ("reservation_evidence_id")
REFERENCES public."pre_submit_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."broker_order_action" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "action_kind" public."BrokerOrderActionKind" NOT NULL,
  "original_broker_order_id" TEXT NOT NULL,
  "broker_action_order_id" TEXT NOT NULL,
  "broker_status_raw" TEXT NOT NULL,
  "authorization_id" TEXT NOT NULL,
  "canonical_request_digest" CHAR(64) NOT NULL,
  "request_id" TEXT,
  "http_status" INTEGER NOT NULL,
  "write_outcome" TEXT NOT NULL,
  "redacted_body" JSONB NOT NULL,
  "body_sha256" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "redaction_version" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broker_order_action_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broker_order_action_content_check" CHECK (
    BTRIM("original_broker_order_id") <> ''
    AND BTRIM("broker_action_order_id") <> ''
    AND "original_broker_order_id" <> "broker_action_order_id"
    AND "broker_status_raw" = 'REQUEST_ACCEPTED'
    AND BTRIM("authorization_id") <> ''
    AND "canonical_request_digest" ~ '^[0-9a-f]{64}$'
    AND "http_status" BETWEEN 200 AND 299
    AND "write_outcome" = 'ACKNOWLEDGED'
    AND BTRIM("redaction_version") <> ''
    AND ("request_id" IS NULL OR BTRIM("request_id") <> '')
    AND pg_catalog.jsonb_typeof("redacted_body") IN ('object', 'array')
    AND "created_at" >= "observed_at"
  ),
  CONSTRAINT "broker_order_action_kind_status_check" CHECK (
    "action_kind" IN ('CANCEL', 'REPLACE')
  )
);

CREATE UNIQUE INDEX "broker_order_action_order_action_id_key"
ON public."broker_order_action"("order_id", "broker_action_order_id");

CREATE UNIQUE INDEX "broker_order_action_authorization_id_key"
ON public."broker_order_action"("authorization_id");

CREATE INDEX "broker_order_action_order_id_observed_at_idx"
ON public."broker_order_action"("order_id", "observed_at" DESC);

ALTER TABLE public."broker_order_action"
ADD CONSTRAINT "broker_order_action_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."broker_order_response_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "evidence_kind" public."BrokerOrderEvidenceKind" NOT NULL,
  "dispatch_claim_id" UUID,
  "broker_order_id" TEXT,
  "broker_status_raw" TEXT,
  "normalization_version" TEXT NOT NULL,
  "validated_normalized_state" public."OrderLedgerState",
  "request_id" TEXT,
  "http_status" INTEGER,
  "write_outcome" TEXT NOT NULL,
  "safe_error_code" TEXT,
  "redacted_body" JSONB NOT NULL,
  "body_sha256" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "redaction_version" TEXT NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broker_order_response_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broker_order_response_evidence_content_check" CHECK (
    ("broker_order_id" IS NULL OR BTRIM("broker_order_id") <> '')
    AND ("broker_status_raw" IS NULL OR BTRIM("broker_status_raw") <> '')
    AND ("request_id" IS NULL OR BTRIM("request_id") <> '')
    AND ("http_status" IS NULL OR "http_status" BETWEEN 100 AND 599)
    AND BTRIM("normalization_version") <> ''
    AND "write_outcome" IN ('ACKNOWLEDGED', 'REJECTED', 'AMBIGUOUS', 'INTEGRITY_BLOCKED', 'OBSERVED')
    AND ("safe_error_code" IS NULL OR BTRIM("safe_error_code") <> '')
    AND BTRIM("redaction_version") <> ''
    AND pg_catalog.jsonb_typeof("redacted_body") IN ('object', 'array')
    AND "created_at" >= "observed_at"
    AND (
      "broker_order_id" IS NOT NULL
      OR "broker_status_raw" IS NOT NULL
      OR "safe_error_code" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "broker_order_response_evidence_identity_key"
ON public."broker_order_response_evidence"("order_id", "evidence_kind", "body_sha256");

CREATE INDEX "broker_order_response_evidence_order_id_observed_at_idx"
ON public."broker_order_response_evidence"("order_id", "observed_at" DESC);

CREATE INDEX "broker_order_response_evidence_request_id_idx"
ON public."broker_order_response_evidence"("request_id");

ALTER TABLE public."broker_order_response_evidence"
ADD CONSTRAINT "broker_order_response_evidence_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."manual_order_approval" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_order_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "approval_hash" CHAR(64) NOT NULL,
  "plan_hash" CHAR(64) NOT NULL,
  "actor" TEXT NOT NULL,
  "confirmation_version" TEXT NOT NULL,
  "canonical_content" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumed_at" TIMESTAMPTZ(6),
  "consumed_by_order_id" UUID,
  CONSTRAINT "manual_order_approval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "manual_order_approval_hash_check" CHECK (
    "approval_hash" ~ '^[0-9a-f]{64}$'
    AND "plan_hash" ~ '^[0-9a-f]{64}$'
    AND "approval_hash" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
      'hex'
    )
    AND BTRIM("actor") <> ''
    AND BTRIM("confirmation_version") <> ''
    AND BTRIM("canonical_content") <> ''
  ),
  CONSTRAINT "manual_order_approval_expiry_check" CHECK (
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + INTERVAL '600 seconds'
  ),
  CONSTRAINT "manual_order_approval_consumption_shape_check" CHECK (
    ("consumed_at" IS NULL AND "consumed_by_order_id" IS NULL)
    OR (
      "consumed_at" IS NOT NULL
      AND "consumed_by_order_id" IS NOT NULL
      AND "consumed_at" >= "created_at"
      AND "consumed_at" < "expires_at"
    )
  )
);

CREATE INDEX "manual_order_approval_plan_order_id_expires_at_idx"
ON public."manual_order_approval"("plan_order_id", "expires_at");

CREATE UNIQUE INDEX "manual_order_approval_hash_key"
ON public."manual_order_approval"("approval_hash");

CREATE UNIQUE INDEX "manual_order_approval_consumed_by_order_id_key"
ON public."manual_order_approval"("consumed_by_order_id");

CREATE INDEX "manual_order_approval_account_id_expires_at_idx"
ON public."manual_order_approval"("account_id", "expires_at");

ALTER TABLE public."manual_order_approval"
ADD CONSTRAINT "manual_order_approval_plan_order_id_fkey"
FOREIGN KEY ("plan_order_id")
REFERENCES public."rebalance_plan_order"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."manual_order_approval"
ADD CONSTRAINT "manual_order_approval_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."manual_order_approval"
ADD CONSTRAINT "manual_order_approval_consumed_by_order_id_fkey"
FOREIGN KEY ("consumed_by_order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_state_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "normalized_state" public."OrderLedgerState" NOT NULL,
  "actor" TEXT NOT NULL,
  "broker_status_raw" TEXT,
  "broker_order_id" TEXT,
  "broker_action_id" UUID,
  "broker_response_evidence_id" UUID,
  "manual_approval_id" UUID,
  "submission_authorization_id" UUID,
  "filled_quantity" BIGINT NOT NULL DEFAULT 0,
  "filled_gross_notional_minor" BIGINT NOT NULL DEFAULT 0,
  "fee_minor" BIGINT NOT NULL DEFAULT 0,
  "request_id" TEXT,
  "detail" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_state_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_state_history_sequence_amount_check" CHECK (
    "sequence" >= 0
    AND "filled_quantity" >= 0
    AND "filled_gross_notional_minor" >= 0
    AND "fee_minor" >= 0
  ),
  CONSTRAINT "order_state_history_detail_check" CHECK (
    pg_catalog.jsonb_typeof("detail") = 'object'
  ),
  CONSTRAINT "order_state_history_optional_text_check" CHECK (
    "actor" IN ('EXECUTOR', 'RECONCILER', 'OPERATOR')
    AND
    ("broker_status_raw" IS NULL OR BTRIM("broker_status_raw") <> '')
    AND ("broker_order_id" IS NULL OR BTRIM("broker_order_id") <> '')
    AND ("request_id" IS NULL OR BTRIM("request_id") <> '')
  )
);

CREATE UNIQUE INDEX "order_state_history_order_sequence_key"
ON public."order_state_history"("order_id", "sequence");

CREATE UNIQUE INDEX "order_state_history_manual_approval_id_key"
ON public."order_state_history"("manual_approval_id");

CREATE UNIQUE INDEX "order_state_history_submission_authorization_id_key"
ON public."order_state_history"("submission_authorization_id");

CREATE UNIQUE INDEX "order_state_history_broker_action_id_key"
ON public."order_state_history"("broker_action_id");

CREATE UNIQUE INDEX "order_state_history_broker_response_evidence_id_key"
ON public."order_state_history"("broker_response_evidence_id");

CREATE INDEX "order_state_history_order_id_occurred_at_idx"
ON public."order_state_history"("order_id", "occurred_at" DESC);

CREATE INDEX "order_state_history_broker_order_id_idx"
ON public."order_state_history"("broker_order_id");

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_manual_approval_id_fkey"
FOREIGN KEY ("manual_approval_id")
REFERENCES public."manual_order_approval"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_broker_action_id_fkey"
FOREIGN KEY ("broker_action_id")
REFERENCES public."broker_order_action"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_broker_response_evidence_id_fkey"
FOREIGN KEY ("broker_response_evidence_id")
REFERENCES public."broker_order_response_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."daily_trade_reservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "daily_trade_limit_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "reserved_gross_minor" BIGINT NOT NULL,
  "filled_gross_minor" BIGINT NOT NULL DEFAULT 0,
  "released_gross_minor" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_trade_reservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_trade_reservation_amount_check" CHECK (
    "reserved_gross_minor" > 0
    AND "filled_gross_minor" >= 0
    AND "released_gross_minor" >= 0
    AND "filled_gross_minor" + "released_gross_minor" <= "reserved_gross_minor"
  ),
  CONSTRAINT "daily_trade_reservation_time_check" CHECK (
    "updated_at" >= "created_at"
  )
);

CREATE UNIQUE INDEX "daily_trade_reservation_order_id_key"
ON public."daily_trade_reservation"("order_id");

CREATE UNIQUE INDEX "daily_trade_reservation_limit_order_key"
ON public."daily_trade_reservation"("daily_trade_limit_id", "order_id");

CREATE INDEX "daily_trade_reservation_daily_trade_limit_id_idx"
ON public."daily_trade_reservation"("daily_trade_limit_id");

ALTER TABLE public."daily_trade_reservation"
ADD CONSTRAINT "daily_trade_reservation_daily_trade_limit_id_fkey"
FOREIGN KEY ("daily_trade_limit_id")
REFERENCES public."daily_trade_limit"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."daily_trade_reservation"
ADD CONSTRAINT "daily_trade_reservation_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_submission_authorization" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "logical_order_id" UUID NOT NULL,
  "plan_id" UUID NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "canonical_preparation" TEXT NOT NULL,
  "canonical_preparation_digest" CHAR(64) NOT NULL,
  "authorized_request_digest" CHAR(64) NOT NULL,
  "client_order_id" CHAR(36) NOT NULL,
  "broker_account_reference_hmac" CHAR(64) NOT NULL,
  "execution_risk_evidence_id" UUID NOT NULL,
  "pre_submit_evidence_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "approval_id" UUID NOT NULL,
  "prepared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "order_submission_authorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_submission_authorization_content_check" CHECK (
    "plan_version" >= 1
    AND BTRIM("canonical_preparation") <> ''
    AND "canonical_preparation_digest" ~ '^[0-9a-f]{64}$'
    AND "canonical_preparation_digest" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_preparation", 'UTF8')),
      'hex'
    )
    AND "authorized_request_digest" ~ '^[0-9a-f]{64}$'
    AND "client_order_id" ~ '^pr1_[A-Za-z0-9_-]{32}$'
    AND "broker_account_reference_hmac" ~ '^[0-9a-f]{64}$'
    AND "expires_at" > "prepared_at"
    AND "expires_at" <= "prepared_at" + INTERVAL '30 seconds'
  )
);

CREATE UNIQUE INDEX "order_submission_authorization_order_id_key"
ON public."order_submission_authorization"("order_id");

CREATE UNIQUE INDEX "order_submission_authorization_logical_order_id_key"
ON public."order_submission_authorization"("logical_order_id");

CREATE UNIQUE INDEX "order_submission_authorization_client_order_id_key"
ON public."order_submission_authorization"("client_order_id");

CREATE UNIQUE INDEX "order_submission_authorization_reservation_id_key"
ON public."order_submission_authorization"("reservation_id");

CREATE UNIQUE INDEX "order_submission_authorization_approval_id_key"
ON public."order_submission_authorization"("approval_id");

CREATE INDEX "order_submission_authorization_plan_version_order_idx"
ON public."order_submission_authorization"("plan_id", "plan_version", "plan_order_id");

CREATE INDEX "order_submission_authorization_expires_at_idx"
ON public."order_submission_authorization"("expires_at");

ALTER TABLE public."order_submission_authorization"
ADD CONSTRAINT "order_submission_authorization_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_submission_authorization"
ADD CONSTRAINT "order_submission_authorization_execution_risk_evidence_id_fkey"
FOREIGN KEY ("execution_risk_evidence_id")
REFERENCES public."execution_risk_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_submission_authorization"
ADD CONSTRAINT "order_submission_authorization_pre_submit_evidence_id_fkey"
FOREIGN KEY ("pre_submit_evidence_id")
REFERENCES public."pre_submit_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_submission_authorization"
ADD CONSTRAINT "order_submission_authorization_reservation_id_fkey"
FOREIGN KEY ("reservation_id")
REFERENCES public."daily_trade_reservation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_submission_authorization"
ADD CONSTRAINT "order_submission_authorization_approval_id_fkey"
FOREIGN KEY ("approval_id")
REFERENCES public."manual_order_approval"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_submission_authorization_id_fkey"
FOREIGN KEY ("submission_authorization_id")
REFERENCES public."order_submission_authorization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_dispatch_claim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_authorization_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "logical_order_id" UUID NOT NULL,
  "authorization_id" TEXT NOT NULL,
  "plan_id" UUID NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "canonical_request" TEXT NOT NULL,
  "claim_envelope_digest" CHAR(64) NOT NULL,
  "authorized_request_digest" CHAR(64) NOT NULL,
  "client_order_id" CHAR(36) NOT NULL,
  "broker_account_reference_hmac" CHAR(64) NOT NULL,
  "authorization_issued_at" TIMESTAMPTZ(6) NOT NULL,
  "authorization_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "intent_audited_at" TIMESTAMPTZ(6) NOT NULL,
  "dispatch_started_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "order_dispatch_claim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_dispatch_claim_content_check" CHECK (
    BTRIM("authorization_id") <> ''
    AND "plan_version" >= 1
    AND BTRIM("canonical_request") <> ''
    AND "claim_envelope_digest" ~ '^[0-9a-f]{64}$'
    AND "claim_envelope_digest" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_request", 'UTF8')),
      'hex'
    )
    AND "authorized_request_digest" ~ '^[0-9a-f]{64}$'
    AND "client_order_id" ~ '^pr1_[A-Za-z0-9_-]{32}$'
    AND "broker_account_reference_hmac" ~ '^[0-9a-f]{64}$'
    AND "authorization_expires_at" > "authorization_issued_at"
    AND "authorization_expires_at" <= "authorization_issued_at" + INTERVAL '30 seconds'
    AND "claimed_at" >= "authorization_issued_at"
    AND "claimed_at" < "authorization_expires_at"
    AND "intent_audited_at" >= "claimed_at"
    AND "dispatch_started_at" >= "intent_audited_at"
    AND "dispatch_started_at" < "authorization_expires_at"
  )
);

CREATE UNIQUE INDEX "order_dispatch_claim_submission_authorization_id_key"
ON public."order_dispatch_claim"("submission_authorization_id");

CREATE UNIQUE INDEX "order_dispatch_claim_order_id_key"
ON public."order_dispatch_claim"("order_id");

CREATE UNIQUE INDEX "order_dispatch_claim_logical_order_id_key"
ON public."order_dispatch_claim"("logical_order_id");

CREATE UNIQUE INDEX "order_dispatch_claim_authorization_id_key"
ON public."order_dispatch_claim"("authorization_id");

CREATE UNIQUE INDEX "order_dispatch_claim_client_order_id_key"
ON public."order_dispatch_claim"("client_order_id");

CREATE INDEX "order_dispatch_claim_plan_version_order_idx"
ON public."order_dispatch_claim"("plan_id", "plan_version", "plan_order_id");

CREATE INDEX "order_dispatch_claim_authorization_expires_at_idx"
ON public."order_dispatch_claim"("authorization_expires_at");

ALTER TABLE public."order_dispatch_claim"
ADD CONSTRAINT "order_dispatch_claim_submission_authorization_id_fkey"
FOREIGN KEY ("submission_authorization_id")
REFERENCES public."order_submission_authorization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_dispatch_claim"
ADD CONSTRAINT "order_dispatch_claim_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."broker_order_response_evidence"
ADD CONSTRAINT "broker_order_response_evidence_dispatch_claim_id_fkey"
FOREIGN KEY ("dispatch_claim_id")
REFERENCES public."order_dispatch_claim"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."kill_switch_event" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "state" public."KillSwitchState" NOT NULL,
  "reason" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kill_switch_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kill_switch_event_content_check" CHECK (
    "version" >= 1
    AND BTRIM("reason") <> ''
    AND BTRIM("actor") <> ''
    AND "created_at" >= "occurred_at"
  )
);

CREATE UNIQUE INDEX "kill_switch_event_account_version_key"
ON public."kill_switch_event"("account_id", "version");

CREATE INDEX "kill_switch_event_account_id_occurred_at_idx"
ON public."kill_switch_event"("account_id", "occurred_at" DESC);

ALTER TABLE public."kill_switch_event"
ADD CONSTRAINT "kill_switch_event_account_id_fkey"
FOREIGN KEY ("account_id")
REFERENCES public."broker_account"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.has_required_passed_checks(checks JSONB, required_codes TEXT[]) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO pg_catalog
AS $$
  SELECT
    pg_catalog.jsonb_typeof(checks) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(checks) AS item
      WHERE pg_catalog.jsonb_typeof(item) <> 'object'
        OR COALESCE(item ->> 'code', '') = ''
        OR item ->> 'outcome' IS DISTINCT FROM 'PASSED'
    )
    AND (
      SELECT COUNT(*)
      FROM pg_catalog.jsonb_array_elements(checks) AS item
    ) = (
      SELECT COUNT(DISTINCT item ->> 'code')
      FROM pg_catalog.jsonb_array_elements(checks) AS item
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(required_codes) AS required(code)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(checks) AS item
        WHERE item ->> 'code' = required.code
      )
    );
$$;

CREATE FUNCTION public.expected_broker_normalized_state(
  evidence_kind public."BrokerOrderEvidenceKind",
  broker_status_raw TEXT
) RETURNS public."OrderLedgerState"
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $$
  SELECT CASE
    WHEN evidence_kind = 'SUBMIT' AND broker_status_raw IN ('ACKNOWLEDGED', 'PENDING')
      THEN 'PENDING'::public."OrderLedgerState"
    WHEN evidence_kind = 'SUBMIT' AND broker_status_raw = 'REJECTED'
      THEN 'REJECTED'::public."OrderLedgerState"
    WHEN evidence_kind = 'SUBMIT' AND broker_status_raw = 'AMBIGUOUS'
      THEN 'UNKNOWN'::public."OrderLedgerState"
    WHEN evidence_kind = 'SUBMIT' AND broker_status_raw = 'INTEGRITY_BLOCKED'
      THEN 'UNKNOWN_BLOCKED'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE' AND broker_status_raw IN ('PENDING', 'PENDING_CANCEL')
      THEN 'PENDING'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE' AND broker_status_raw = 'PARTIAL_FILLED'
      THEN 'PARTIAL_FILLED'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE' AND broker_status_raw = 'FILLED'
      THEN 'FILLED'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE' AND broker_status_raw = 'CANCELED'
      THEN 'CANCELED'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE' AND broker_status_raw = 'REJECTED'
      THEN 'REJECTED'::public."OrderLedgerState"
    WHEN evidence_kind = 'RECONCILE'
      THEN 'UNKNOWN_BLOCKED'::public."OrderLedgerState"
    WHEN evidence_kind IN ('CANCEL_ATTEMPT', 'REPLACE_ATTEMPT')
      AND broker_status_raw = 'AMBIGUOUS'
      THEN 'UNKNOWN'::public."OrderLedgerState"
    WHEN evidence_kind IN ('CANCEL_ATTEMPT', 'REPLACE_ATTEMPT')
      AND broker_status_raw = 'INTEGRITY_BLOCKED'
      THEN 'UNKNOWN_BLOCKED'::public."OrderLedgerState"
    ELSE NULL
  END;
$$;

CREATE FUNCTION public.guard_live_promotion_event() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  previous_version INTEGER;
  previous_state TEXT;
  previous_occurred_at TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'live promotion events are append-only';
  END IF;

  NEW."occurred_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."occurred_at";

  PERFORM 1
  FROM public."broker_account" AS account
  WHERE account."id" = NEW."account_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'live promotion account does not exist';
  END IF;

  SELECT event."version", event."state"::TEXT, event."occurred_at"
  INTO previous_version, previous_state, previous_occurred_at
  FROM public."live_promotion_event" AS event
  WHERE event."account_id" = NEW."account_id"
  ORDER BY event."version" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW."version" <> 1 OR NEW."state"::TEXT <> 'REVOKED' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'live promotion must begin in REVOKED version 1';
    END IF;
  ELSIF
    NEW."version" <> previous_version + 1
    OR NEW."state"::TEXT = previous_state
    OR NEW."occurred_at" < previous_occurred_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'live promotion must be a contiguous state-changing version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_execution_risk_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  config JSONB;
  plan_mode TEXT;
  plan_status TEXT;
  plan_account_id UUID;
  plan_snapshot_id UUID;
  plan_target_config_version_id UUID;
  snapshot_validation_status TEXT;
  latest_snapshot_id UUID;
  target_status TEXT;
  promotion_account_id UUID;
  promotion_state TEXT;
  promotion_config_sha CHAR(64);
  promotion_account_hmac CHAR(64);
  promotion_single BIGINT;
  promotion_daily BIGINT;
  promotion_tiny BIGINT;
  latest_promotion_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'execution risk evidence is append-only';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();
  config := NEW."operational_config_canonical"::JSONB;

  SELECT
    version."mode"::TEXT,
    version."status"::TEXT,
    run."account_id",
    version."snapshot_id",
    version."target_config_version_id",
    snapshot."validation_status"::TEXT,
    target."status"::TEXT
  INTO
    plan_mode,
    plan_status,
    plan_account_id,
    plan_snapshot_id,
    plan_target_config_version_id,
    snapshot_validation_status,
    target_status
  FROM public."rebalance_plan_version" AS version
  JOIN public."rebalance_plan" AS plan
    ON plan."id" = version."plan_id"
  JOIN public."rebalance_run" AS run
    ON run."id" = plan."run_id"
  JOIN public."portfolio_snapshot" AS snapshot
    ON snapshot."id" = version."snapshot_id"
  JOIN public."target_config_version" AS target
    ON target."id" = version."target_config_version_id"
  WHERE version."plan_id" = NEW."plan_id"
    AND version."version" = NEW."plan_version";

  SELECT snapshot."id"
  INTO latest_snapshot_id
  FROM public."portfolio_snapshot" AS snapshot
  WHERE snapshot."account_id" = NEW."account_id"
  ORDER BY snapshot."observed_at" DESC, snapshot."persisted_at" DESC, snapshot."id" DESC
  LIMIT 1;

  SELECT
    event."account_id",
    event."state"::TEXT,
    event."operational_config_sha256",
    event."account_allowlist_hmac",
    event."max_single_order_gross_minor",
    event."max_daily_gross_minor",
    event."tiny_live_max_gross_minor"
  INTO
    promotion_account_id,
    promotion_state,
    promotion_config_sha,
    promotion_account_hmac,
    promotion_single,
    promotion_daily,
    promotion_tiny
  FROM public."live_promotion_event" AS event
  WHERE event."id" = NEW."promotion_event_id";

  SELECT event."id"
  INTO latest_promotion_id
  FROM public."live_promotion_event" AS event
  WHERE event."account_id" = NEW."account_id"
  ORDER BY event."version" DESC
  LIMIT 1;

  IF NOT FOUND
    OR plan_mode IS DISTINCT FROM 'LIVE'
    OR plan_status IS DISTINCT FROM 'PLANNED'
    OR plan_account_id IS DISTINCT FROM NEW."account_id"
    OR snapshot_validation_status IS DISTINCT FROM 'VERIFIED'
    OR target_status IS DISTINCT FROM 'ACTIVE'
    OR latest_snapshot_id IS DISTINCT FROM plan_snapshot_id
    OR promotion_account_id IS DISTINCT FROM NEW."account_id"
    OR promotion_state IS DISTINCT FROM 'GRANTED'
    OR latest_promotion_id IS DISTINCT FROM NEW."promotion_event_id"
    OR promotion_config_sha IS DISTINCT FROM NEW."operational_config_sha256"
    OR promotion_account_hmac IS DISTINCT FROM NEW."account_allowlist_hmac"
    OR config ->> 'schemaVersion' IS DISTINCT FROM 'OPERATIONAL_CONFIG_V1'
    OR config ->> 'mode' IS DISTINCT FROM 'LIVE'
    OR (config ->> 'killSwitch')::BOOLEAN IS DISTINCT FROM FALSE
    OR (config #>> '{live,enabled}')::BOOLEAN IS DISTINCT FROM TRUE
    OR (config #>> '{live,manualApprovalRequired}')::BOOLEAN IS DISTINCT FROM TRUE
    OR config #>> '{live,marketCountry}' IS DISTINCT FROM 'KR'
    OR config #>> '{live,allowedSession}' IS DISTINCT FROM 'REGULAR_MARKET'
    OR config #>> '{live,orderType}' IS DISTINCT FROM 'LIMIT'
    OR config #>> '{live,timeInForce}' IS DISTINCT FROM 'DAY'
    OR NOT (config #> '{live,accountAllowlistHmacs}' ? NEW."account_allowlist_hmac")
    OR (config #>> '{freshness,quote,preSubmitMaxAgeSeconds}')::INTEGER NOT BETWEEN 1 AND 30
    OR (config #>> '{freshness,quote,futureToleranceSeconds}')::INTEGER NOT BETWEEN 0 AND 60
    OR (config #>> '{freshness,calendar,maxAgeSeconds}')::INTEGER NOT BETWEEN 1 AND 172800
    OR (config #>> '{freshness,calendar,futureToleranceSeconds}')::INTEGER NOT BETWEEN 0 AND 60
    OR (config #>> '{limits,maxAbsolutePriceChangeBasisPoints}')::INTEGER NOT BETWEEN 0 AND 10000
    OR (config #>> '{live,maxSingleOrderGrossMinor}')::BIGINT IS DISTINCT FROM promotion_single
    OR (config #>> '{live,maxDailyGrossMinor}')::BIGINT IS DISTINCT FROM promotion_daily
    OR (config #>> '{live,tinyLiveMaxGrossMinor}')::BIGINT IS DISTINCT FROM promotion_tiny
    OR NEW."evaluated_at" < pg_catalog.statement_timestamp() - INTERVAL '5 seconds'
    OR NEW."evaluated_at" > pg_catalog.statement_timestamp() + INTERVAL '5 seconds'
    OR NEW."expires_at" <= pg_catalog.statement_timestamp()
    OR NOT public.has_required_passed_checks(
      NEW."checks",
      ARRAY[
        'EXECUTION_MODE_MATCHED',
        'KILL_SWITCH_RELEASED',
        'PLAN_MODE_MATCHED',
        'MINIMUM_ORDER_GROSS_OK',
        'PLAN_IDENTITY_CURRENT',
        'NO_UNRESOLVED_ORDERS',
        'TRADE_LIMITS_OK',
        'EXPOSURE_LIMITS_OK',
        'LIVE_EXPLICITLY_ENABLED',
        'LIVE_ACCOUNT_ALLOWLISTED',
        'LIVE_ORDER_SHAPE_ALLOWED',
        'LIVE_TRADE_LIMITS_OK',
        'TINY_LIVE_GROSS_LIMIT_OK',
        'LIVE_MANUAL_APPROVAL_VALID'
      ]
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'execution risk evidence must pin the latest LIVE plan, config and granted promotion with all required checks passed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_pre_submit_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  config JSONB;
  risk_plan_id UUID;
  risk_plan_version INTEGER;
  risk_account_id UUID;
  risk_expires_at TIMESTAMPTZ;
  plan_snapshot_id UUID;
  order_plan_id UUID;
  order_plan_version INTEGER;
  order_market_country TEXT;
  order_currency TEXT;
  order_symbol TEXT;
  order_side TEXT;
  order_quantity BIGINT;
  order_limit_price BIGINT;
  planned_snapshot_id UUID;
  planned_snapshot_market TEXT;
  planned_snapshot_currency TEXT;
  planned_snapshot_symbol TEXT;
  planned_snapshot_price TEXT;
  validation_ids UUID[];
  expected_operations TEXT[];
  validation_bodies JSONB[];
  validation_id UUID;
  expected_operation TEXT;
  validation_operation TEXT;
  validation_outcome TEXT;
  validation_body JSONB;
  attempt_operation TEXT;
  attempt_outcome TEXT;
  attempt_http_status INTEGER;
  attempt_completed_at TIMESTAMPTZ;
  attempt_correlation_id UUID;
  request_summary JSONB;
  quote_item JSONB;
  quote_item_count BIGINT;
  stock_item JSONB;
  stock_item_count BIGINT;
  quote_timestamp TIMESTAMPTZ;
  quote_price BIGINT;
  price_limit_timestamp TIMESTAMPTZ;
  lower_limit BIGINT;
  upper_limit BIGINT;
  calendar_date DATE;
  regular_start TIMESTAMPTZ;
  regular_end TIMESTAMPTZ;
  capacity_amount BIGINT;
  quote_max_age_seconds INTEGER;
  quote_future_seconds INTEGER;
  calendar_max_age_seconds INTEGER;
  calendar_future_seconds INTEGER;
  max_price_change_bp INTEGER;
  expected_reserved BIGINT;
  index INTEGER;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit evidence is append-only';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();

  SELECT
    risk."plan_id",
    risk."plan_version",
    risk."account_id",
    risk."operational_config_canonical"::JSONB,
    risk."expires_at"
  INTO
    risk_plan_id,
    risk_plan_version,
    risk_account_id,
    config,
    risk_expires_at
  FROM public."execution_risk_evidence" AS risk
  WHERE risk."id" = NEW."execution_risk_evidence_id";

  SELECT
    plan_order."plan_id",
    plan_order."plan_version",
    plan_order."market_country",
    plan_order."currency",
    plan_order."symbol",
    plan_order."side",
    plan_order."quantity",
    plan_order."limit_price_minor",
    version."snapshot_id"
  INTO
    order_plan_id,
    order_plan_version,
    order_market_country,
    order_currency,
    order_symbol,
    order_side,
    order_quantity,
    order_limit_price,
    plan_snapshot_id
  FROM public."rebalance_plan_order" AS plan_order
  JOIN public."rebalance_plan_version" AS version
    ON version."plan_id" = plan_order."plan_id"
   AND version."version" = plan_order."plan_version"
  WHERE plan_order."id" = NEW."plan_order_id";

  SELECT
    price."snapshot_id",
    price."market_country",
    price."currency",
    price."symbol",
    price."last_price"
  INTO
    planned_snapshot_id,
    planned_snapshot_market,
    planned_snapshot_currency,
    planned_snapshot_symbol,
    planned_snapshot_price
  FROM public."price_snapshot" AS price
  WHERE price."id" = NEW."planned_price_snapshot_id";

  quote_max_age_seconds := (config #>> '{freshness,quote,preSubmitMaxAgeSeconds}')::INTEGER;
  quote_future_seconds := (config #>> '{freshness,quote,futureToleranceSeconds}')::INTEGER;
  calendar_max_age_seconds := (config #>> '{freshness,calendar,maxAgeSeconds}')::INTEGER;
  calendar_future_seconds := (config #>> '{freshness,calendar,futureToleranceSeconds}')::INTEGER;
  max_price_change_bp := (config #>> '{limits,maxAbsolutePriceChangeBasisPoints}')::INTEGER;

  IF risk_plan_id IS DISTINCT FROM order_plan_id
    OR risk_plan_version IS DISTINCT FROM order_plan_version
    OR risk_account_id IS DISTINCT FROM NEW."account_id"
    OR risk_expires_at <= NEW."evaluated_at"
    OR plan_snapshot_id IS DISTINCT FROM planned_snapshot_id
    OR planned_snapshot_market IS DISTINCT FROM order_market_country
    OR planned_snapshot_currency IS DISTINCT FROM order_currency
    OR planned_snapshot_symbol IS DISTINCT FROM order_symbol
    OR order_market_country IS DISTINCT FROM 'KR'
    OR order_currency IS DISTINCT FROM 'KRW'
    OR planned_snapshot_price !~ '^[0-9]+([.][0]+)?$'
    OR split_part(planned_snapshot_price, '.', 1)::BIGINT IS DISTINCT FROM NEW."planned_quote_price_minor"
    OR NEW."evaluated_at" < pg_catalog.statement_timestamp() - INTERVAL '5 seconds'
    OR NEW."evaluated_at" > pg_catalog.statement_timestamp() + INTERVAL '5 seconds'
    OR NEW."expires_at" <= pg_catalog.statement_timestamp()
    OR NOT public.has_required_passed_checks(
      NEW."checks",
      ARRAY[
        'PRE_SUBMIT_EVIDENCE_IDENTITY_MATCHED',
        'QUOTE_FRESH',
        'PRICE_MOVEMENT_ACCEPTABLE',
        'PRICE_LIMIT_FRESH',
        'MARKET_SESSION_OPEN',
        'ORDER_PRICE_WITHIN_DAILY_LIMITS',
        'ORDER_RESERVATION_READY',
        'INSTRUMENT_WARNING_EVIDENCE_FRESH',
        'INSTRUMENT_TRADE_RESTRICTIONS_CLEAR',
        'BROKER_OPEN_ORDERS_RECONCILED',
        'NO_CONFLICTING_BROKER_OPEN_ORDER'
      ] || CASE
        WHEN order_side = 'BUY' THEN ARRAY[
          'BUYING_POWER_FRESH',
          'BUYING_POWER_SUFFICIENT'
        ]
        ELSE ARRAY[
          'SELLABLE_QUANTITY_FRESH',
          'SELLABLE_QUANTITY_SUFFICIENT'
        ]
      END
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit evidence must match one current LIVE plan order and all required checks';
  END IF;

  validation_ids := ARRAY[
    NEW."quote_response_validation_id",
    NEW."price_limit_response_validation_id",
    NEW."calendar_response_validation_id",
    NEW."capacity_response_validation_id",
    NEW."instrument_response_validation_id",
    NEW."warnings_response_validation_id",
    NEW."open_orders_response_validation_id"
  ];
  expected_operations := ARRAY[
    'getPrices',
    'getPriceLimit',
    'getKrMarketCalendar',
    CASE WHEN order_side = 'BUY' THEN 'getBuyingPower' ELSE 'getSellableQuantity' END,
    'getStocks',
    'getStockWarnings',
    'getOrders'
  ];
  validation_bodies := ARRAY[]::JSONB[];

  FOR index IN 1..pg_catalog.array_length(validation_ids, 1) LOOP
    validation_id := validation_ids[index];
    expected_operation := expected_operations[index];
    SELECT
      validation."operation_id",
      validation."outcome"::TEXT,
      validation."redacted_body",
      attempt."operation_id",
      attempt."outcome"::TEXT,
      attempt."http_status",
      attempt."completed_at",
      attempt."correlation_id",
      attempt."redacted_request_summary"
    INTO
      validation_operation,
      validation_outcome,
      validation_body,
      attempt_operation,
      attempt_outcome,
      attempt_http_status,
      attempt_completed_at,
      attempt_correlation_id,
      request_summary
    FROM public."broker_response_validation" AS validation
    JOIN public."broker_request_attempt" AS attempt
      ON attempt."id" = validation."request_attempt_id"
    WHERE validation."id" = validation_id;

    IF NOT FOUND
      OR validation_operation IS DISTINCT FROM expected_operation
      OR attempt_operation IS DISTINCT FROM expected_operation
      OR validation_outcome IS DISTINCT FROM 'PASSED'
      OR attempt_outcome IS DISTINCT FROM 'SUCCEEDED'
      OR attempt_http_status NOT BETWEEN 200 AND 299
      OR attempt_correlation_id IS DISTINCT FROM NEW."id"
      OR attempt_completed_at > NEW."evaluated_at" + make_interval(secs => GREATEST(quote_future_seconds, calendar_future_seconds))
      OR (
        index IN (1, 2)
        AND NEW."evaluated_at" - attempt_completed_at > make_interval(secs => quote_max_age_seconds)
      )
      OR (
        index = 3
        AND NEW."evaluated_at" - attempt_completed_at > make_interval(secs => calendar_max_age_seconds)
      )
      OR (
        index > 3
        AND NEW."evaluated_at" - attempt_completed_at > INTERVAL '30 seconds'
      )
      OR (
        index IN (1, 2, 4, 5, 6)
        AND request_summary ->> 'symbol' IS DISTINCT FROM order_symbol
      )
      OR (
        index IN (4, 7)
        AND request_summary ->> 'accountId' IS DISTINCT FROM NEW."account_id"::TEXT
      ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'pre-submit evidence requires fresh, passed broker validations with exact operation and request scope';
    END IF;
    validation_bodies := pg_catalog.array_append(validation_bodies, validation_body);
  END LOOP;

  SELECT item, COUNT(*) OVER ()
  INTO quote_item, quote_item_count
  FROM pg_catalog.jsonb_array_elements(validation_bodies[1] -> 'result') AS item
  WHERE item ->> 'symbol' = order_symbol;

  IF quote_item_count IS DISTINCT FROM 1
    OR quote_item ->> 'currency' IS DISTINCT FROM 'KRW'
    OR quote_item ->> 'lastPrice' !~ '^[0-9]+([.][0]+)?$'
    OR quote_item ->> 'timestamp' IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'current quote validation must contain exactly one whole-unit KRW price for the order symbol';
  END IF;
  quote_price := split_part(quote_item ->> 'lastPrice', '.', 1)::BIGINT;
  quote_timestamp := (quote_item ->> 'timestamp')::TIMESTAMPTZ;

  IF validation_bodies[2] #>> '{result,currency}' IS DISTINCT FROM 'KRW'
    OR validation_bodies[2] #>> '{result,lowerLimitPrice}' !~ '^[0-9]+([.][0]+)?$'
    OR validation_bodies[2] #>> '{result,upperLimitPrice}' !~ '^[0-9]+([.][0]+)?$'
    OR validation_bodies[2] #>> '{result,timestamp}' IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'price-limit validation must contain whole-unit KRW lower and upper prices';
  END IF;
  lower_limit := split_part(validation_bodies[2] #>> '{result,lowerLimitPrice}', '.', 1)::BIGINT;
  upper_limit := split_part(validation_bodies[2] #>> '{result,upperLimitPrice}', '.', 1)::BIGINT;
  price_limit_timestamp := (validation_bodies[2] #>> '{result,timestamp}')::TIMESTAMPTZ;

  calendar_date := (validation_bodies[3] #>> '{result,today,date}')::DATE;
  regular_start := (validation_bodies[3] #>> '{result,today,integrated,regularMarket,startTime}')::TIMESTAMPTZ;
  regular_end := (validation_bodies[3] #>> '{result,today,integrated,regularMarket,endTime}')::TIMESTAMPTZ;

  IF calendar_date IS DISTINCT FROM (NEW."evaluated_at" AT TIME ZONE 'Asia/Seoul')::DATE
    OR NEW."evaluated_at" < regular_start
    OR NEW."evaluated_at" >= regular_end
    OR quote_timestamp < NEW."evaluated_at" - make_interval(secs => quote_max_age_seconds)
    OR quote_timestamp > NEW."evaluated_at" + make_interval(secs => quote_future_seconds)
    OR price_limit_timestamp < NEW."evaluated_at" - make_interval(secs => quote_max_age_seconds)
    OR price_limit_timestamp > NEW."evaluated_at" + make_interval(secs => quote_future_seconds)
    OR quote_price IS DISTINCT FROM NEW."current_quote_price_minor"
    OR lower_limit IS DISTINCT FROM NEW."lower_price_limit_minor"
    OR upper_limit IS DISTINCT FROM NEW."upper_price_limit_minor"
    OR order_limit_price < lower_limit
    OR order_limit_price > upper_limit
    OR ABS(quote_price - NEW."planned_quote_price_minor")::NUMERIC * 10000
      > NEW."planned_quote_price_minor"::NUMERIC * max_price_change_bp::NUMERIC THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit quote, price limit, movement or regular-market session evidence is invalid';
  END IF;

  IF order_side = 'BUY' THEN
    IF validation_bodies[4] #>> '{result,currency}' IS DISTINCT FROM 'KRW'
      OR validation_bodies[4] #>> '{result,cashBuyingPower}' !~ '^[0-9]+([.][0]+)?$' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'BUY pre-submit evidence requires KRW cash buying power';
    END IF;
    capacity_amount := split_part(validation_bodies[4] #>> '{result,cashBuyingPower}', '.', 1)::BIGINT;
    expected_reserved := order_quantity * order_limit_price;
    IF capacity_amount < expected_reserved
      OR NEW."reservation_basis_price_minor" IS DISTINCT FROM order_limit_price THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'BUY capacity or reservation basis is insufficient';
    END IF;
  ELSE
    IF validation_bodies[4] #>> '{result,sellableQuantity}' !~ '^[0-9]+([.][0]+)?$' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SELL pre-submit evidence requires whole-unit sellable quantity';
    END IF;
    capacity_amount := split_part(validation_bodies[4] #>> '{result,sellableQuantity}', '.', 1)::BIGINT;
    expected_reserved := order_quantity * upper_limit;
    IF capacity_amount < order_quantity
      OR NEW."reservation_basis_price_minor" IS DISTINCT FROM upper_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SELL capacity or verified upper-limit reservation basis is insufficient';
    END IF;
  END IF;

  SELECT item, COUNT(*) OVER ()
  INTO stock_item, stock_item_count
  FROM pg_catalog.jsonb_array_elements(validation_bodies[5] -> 'result') AS item
  WHERE item ->> 'symbol' = order_symbol;

  IF stock_item_count IS DISTINCT FROM 1
    OR stock_item ->> 'currency' IS DISTINCT FROM 'KRW'
    OR stock_item ->> 'market' NOT IN ('KOSPI', 'KOSDAQ')
    OR stock_item ->> 'status' IS DISTINCT FROM 'ACTIVE'
    OR stock_item ->> 'securityType' NOT IN ('STOCK', 'INFRASTRUCTURE_FUND', 'REIT', 'ETF')
    OR (
      stock_item ->> 'securityType' = 'STOCK'
      AND (stock_item ->> 'isCommonShare')::BOOLEAN IS DISTINCT FROM TRUE
    )
    OR (
      stock_item ->> 'securityType' = 'ETF'
      AND COALESCE(stock_item ->> 'leverageFactor', '') !~ '^1([.]0+)?$'
    )
    OR (
      stock_item ->> 'securityType' <> 'ETF'
      AND stock_item ->> 'leverageFactor' IS NOT NULL
    )
    OR (stock_item #>> '{koreanMarketDetail,liquidationTrading}')::BOOLEAN IS DISTINCT FROM FALSE
    OR (stock_item #>> '{koreanMarketDetail,krxTradingSuspended}')::BOOLEAN IS DISTINCT FROM FALSE
    OR pg_catalog.jsonb_typeof(validation_bodies[6] -> 'result') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(validation_bodies[6] -> 'result') <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit instrument and warning evidence must prove an active unrestricted stock';
  END IF;

  IF NEW."reserved_gross_minor" IS DISTINCT FROM expected_reserved
    OR pg_catalog.jsonb_typeof(validation_bodies[7] #> '{result,orders}') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(validation_bodies[7] #> '{result,orders}') <> 0
    OR (validation_bodies[7] #>> '{result,hasNext}')::BOOLEAN IS DISTINCT FROM FALSE
    OR validation_bodies[7] #>> '{result,nextCursor}' IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit reservation or open-order reconciliation evidence is invalid';
  END IF;

  RETURN NEW;
END;
$$;

/* Superseded by the two-stage authorization and dispatch guards below.
CREATE FUNCTION public.guard_order_submission_claim() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  order_plan_id UUID;
  order_plan_version INTEGER;
  order_plan_order_id UUID;
  order_account_id UUID;
  order_mode TEXT;
  order_logical_order_id UUID;
  order_client_order_id CHAR(36);
  order_intent_sha CHAR(64);
  account_external_ref_hmac CHAR(64);
  latest_state TEXT;
  reservation_order_id UUID;
  reservation_reserved BIGINT;
  reservation_released BIGINT;
  risk_plan_id UUID;
  risk_plan_version INTEGER;
  risk_account_id UUID;
  risk_promotion_event_id UUID;
  risk_expires_at TIMESTAMPTZ;
  pre_risk_id UUID;
  pre_plan_order_id UUID;
  pre_account_id UUID;
  pre_reserved BIGINT;
  pre_expires_at TIMESTAMPTZ;
  approval_plan_order_id UUID;
  approval_account_id UUID;
  approval_expires_at TIMESTAMPTZ;
  approval_consumed_at TIMESTAMPTZ;
  latest_promotion_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order submission claim is append-only';
  END IF;

  NEW."claimed_at" := pg_catalog.statement_timestamp();
  NEW."intent_audited_at" := NEW."claimed_at";
  NEW."dispatch_started_at" := NEW."claimed_at";

  SELECT
    ledger."plan_id",
    ledger."plan_version",
    ledger."plan_order_id",
    ledger."account_id",
    ledger."mode"::TEXT,
    ledger."logical_order_id",
    ledger."client_order_id",
    ledger."intent_sha256",
    account."external_ref_hmac"
  INTO
    order_plan_id,
    order_plan_version,
    order_plan_order_id,
    order_account_id,
    order_mode,
    order_logical_order_id,
    order_client_order_id,
    order_intent_sha,
    account_external_ref_hmac
  FROM public."order_ledger" AS ledger
  JOIN public."broker_account" AS account
    ON account."id" = ledger."account_id"
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE OF ledger;

  SELECT history."normalized_state"::TEXT
  INTO latest_state
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT
    reservation."order_id",
    reservation."reserved_gross_minor",
    reservation."released_gross_minor"
  INTO
    reservation_order_id,
    reservation_reserved,
    reservation_released
  FROM public."daily_trade_reservation" AS reservation
  WHERE reservation."id" = NEW."reservation_id";

  SELECT
    risk."plan_id",
    risk."plan_version",
    risk."account_id",
    risk."promotion_event_id",
    risk."expires_at"
  INTO
    risk_plan_id,
    risk_plan_version,
    risk_account_id,
    risk_promotion_event_id,
    risk_expires_at
  FROM public."execution_risk_evidence" AS risk
  WHERE risk."id" = NEW."execution_risk_evidence_id";

  SELECT
    evidence."execution_risk_evidence_id",
    evidence."plan_order_id",
    evidence."account_id",
    evidence."reserved_gross_minor",
    evidence."expires_at"
  INTO
    pre_risk_id,
    pre_plan_order_id,
    pre_account_id,
    pre_reserved,
    pre_expires_at
  FROM public."pre_submit_evidence" AS evidence
  WHERE evidence."id" = NEW."pre_submit_evidence_id";

  SELECT
    approval."plan_order_id",
    approval."account_id",
    approval."expires_at",
    approval."consumed_at"
  INTO
    approval_plan_order_id,
    approval_account_id,
    approval_expires_at,
    approval_consumed_at
  FROM public."manual_order_approval" AS approval
  WHERE approval."id" = NEW."approval_id"
  FOR UPDATE;

  SELECT event."id"
  INTO latest_promotion_id
  FROM public."live_promotion_event" AS event
  WHERE event."account_id" = order_account_id
  ORDER BY event."version" DESC
  LIMIT 1;

  IF NOT FOUND
    OR order_mode IS DISTINCT FROM 'LIVE'
    OR latest_state IS DISTINCT FROM 'PLANNED'
    OR order_plan_id IS DISTINCT FROM NEW."plan_id"
    OR order_plan_version IS DISTINCT FROM NEW."plan_version"
    OR order_plan_order_id IS DISTINCT FROM NEW."plan_order_id"
    OR order_logical_order_id IS DISTINCT FROM NEW."logical_order_id"
    OR order_client_order_id IS DISTINCT FROM NEW."client_order_id"
    OR account_external_ref_hmac IS DISTINCT FROM NEW."broker_account_reference_hmac"
    OR reservation_order_id IS DISTINCT FROM NEW."order_id"
    OR reservation_reserved IS DISTINCT FROM pre_reserved
    OR reservation_released <> 0
    OR risk_plan_id IS DISTINCT FROM order_plan_id
    OR risk_plan_version IS DISTINCT FROM order_plan_version
    OR risk_account_id IS DISTINCT FROM order_account_id
    OR risk_expires_at <= NEW."claimed_at"
    OR latest_promotion_id IS DISTINCT FROM risk_promotion_event_id
    OR pre_risk_id IS DISTINCT FROM NEW."execution_risk_evidence_id"
    OR pre_plan_order_id IS DISTINCT FROM order_plan_order_id
    OR pre_account_id IS DISTINCT FROM order_account_id
    OR pre_expires_at <= NEW."claimed_at"
    OR approval_plan_order_id IS DISTINCT FROM order_plan_order_id
    OR approval_account_id IS DISTINCT FROM order_account_id
    OR approval_expires_at <= NEW."claimed_at"
    OR approval_consumed_at IS NOT NULL
    OR NEW."authorization_issued_at" > NEW."claimed_at"
    OR NEW."authorization_expires_at" <= NEW."claimed_at"
    OR EXISTS (
      SELECT 1
      FROM public."order_ledger_current_state" AS current_state
      WHERE current_state."account_id" = order_account_id
        AND current_state."order_id" <> NEW."order_id"
        AND current_state."normalized_state"::TEXT IN (
          'PLANNED', 'SUBMITTING', 'PENDING', 'PARTIAL_FILLED', 'UNKNOWN', 'UNKNOWN_BLOCKED'
        )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order submission claim must exclusively bind one unexpired LIVE authorization, evidence, reservation and approval';
  END IF;

  canonical_payload := NEW."canonical_request"::JSONB;
  IF canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'version', 'ORDER_SUBMISSION_CLAIM_V1',
    'authorizationId', NEW."authorization_id",
    'planId', NEW."plan_id"::TEXT,
    'planVersion', NEW."plan_version",
    'planOrderId', NEW."plan_order_id"::TEXT,
    'logicalOrderId', NEW."logical_order_id"::TEXT,
    'accountId', order_account_id::TEXT,
    'clientOrderId', NEW."client_order_id"::TEXT,
    'canonicalIntentSha256', order_intent_sha::TEXT,
    'authorizedRequestDigest', NEW."authorized_request_digest"::TEXT,
    'brokerAccountReferenceHmac', NEW."broker_account_reference_hmac"::TEXT,
    'executionRiskEvidenceId', NEW."execution_risk_evidence_id"::TEXT,
    'preSubmitEvidenceId', NEW."pre_submit_evidence_id"::TEXT,
    'reservationId', NEW."reservation_id"::TEXT,
    'approvalId', NEW."approval_id"::TEXT,
    'authorizationIssuedAt', pg_catalog.to_char(
      NEW."authorization_issued_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'authorizationExpiresAt', pg_catalog.to_char(
      NEW."authorization_expires_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order submission canonical request does not match its immutable claim columns';
  END IF;

  RETURN NEW;
END;
$$;
*/

CREATE FUNCTION public.guard_order_submission_authorization() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  order_plan_id UUID;
  order_plan_version INTEGER;
  order_plan_order_id UUID;
  order_account_id UUID;
  order_mode TEXT;
  order_logical_order_id UUID;
  order_client_order_id CHAR(36);
  order_intent_sha CHAR(64);
  account_external_ref_hmac CHAR(64);
  latest_state TEXT;
  latest_sequence INTEGER;
  reservation_order_id UUID;
  reservation_reserved BIGINT;
  reservation_released BIGINT;
  risk_plan_id UUID;
  risk_plan_version INTEGER;
  risk_account_id UUID;
  risk_promotion_event_id UUID;
  risk_expires_at TIMESTAMPTZ;
  pre_risk_id UUID;
  pre_plan_order_id UUID;
  pre_account_id UUID;
  pre_reserved BIGINT;
  pre_expires_at TIMESTAMPTZ;
  approval_plan_order_id UUID;
  approval_account_id UUID;
  approval_expires_at TIMESTAMPTZ;
  approval_consumed_at TIMESTAMPTZ;
  approval_consumed_by UUID;
  latest_promotion_id UUID;
  latest_kill_state TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order submission authorization is append-only';
  END IF;

  NEW."prepared_at" := pg_catalog.statement_timestamp();

  SELECT
    ledger."plan_id",
    ledger."plan_version",
    ledger."plan_order_id",
    ledger."account_id",
    ledger."mode"::TEXT,
    ledger."logical_order_id",
    ledger."client_order_id",
    ledger."intent_sha256",
    account."external_ref_hmac"
  INTO
    order_plan_id,
    order_plan_version,
    order_plan_order_id,
    order_account_id,
    order_mode,
    order_logical_order_id,
    order_client_order_id,
    order_intent_sha,
    account_external_ref_hmac
  FROM public."order_ledger" AS ledger
  JOIN public."broker_account" AS account
    ON account."id" = ledger."account_id"
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE OF ledger, account;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'submission authorization requires an existing order and account';
  END IF;

  SELECT history."sequence", history."normalized_state"::TEXT
  INTO latest_sequence, latest_state
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT
    reservation."order_id",
    reservation."reserved_gross_minor",
    reservation."released_gross_minor"
  INTO
    reservation_order_id,
    reservation_reserved,
    reservation_released
  FROM public."daily_trade_reservation" AS reservation
  WHERE reservation."id" = NEW."reservation_id";

  SELECT
    risk."plan_id",
    risk."plan_version",
    risk."account_id",
    risk."promotion_event_id",
    risk."expires_at"
  INTO
    risk_plan_id,
    risk_plan_version,
    risk_account_id,
    risk_promotion_event_id,
    risk_expires_at
  FROM public."execution_risk_evidence" AS risk
  WHERE risk."id" = NEW."execution_risk_evidence_id";

  SELECT
    evidence."execution_risk_evidence_id",
    evidence."plan_order_id",
    evidence."account_id",
    evidence."reserved_gross_minor",
    evidence."expires_at"
  INTO
    pre_risk_id,
    pre_plan_order_id,
    pre_account_id,
    pre_reserved,
    pre_expires_at
  FROM public."pre_submit_evidence" AS evidence
  WHERE evidence."id" = NEW."pre_submit_evidence_id";

  SELECT
    approval."plan_order_id",
    approval."account_id",
    approval."expires_at",
    approval."consumed_at",
    approval."consumed_by_order_id"
  INTO
    approval_plan_order_id,
    approval_account_id,
    approval_expires_at,
    approval_consumed_at,
    approval_consumed_by
  FROM public."manual_order_approval" AS approval
  WHERE approval."id" = NEW."approval_id"
  FOR UPDATE;

  SELECT event."id"
  INTO latest_promotion_id
  FROM public."live_promotion_event" AS event
  WHERE event."account_id" = order_account_id
  ORDER BY event."version" DESC
  LIMIT 1;

  SELECT event."state"::TEXT
  INTO latest_kill_state
  FROM public."kill_switch_event" AS event
  WHERE event."account_id" = order_account_id
  ORDER BY event."version" DESC
  LIMIT 1;

  IF order_mode IS DISTINCT FROM 'LIVE'
    OR latest_sequence IS DISTINCT FROM 0
    OR latest_state IS DISTINCT FROM 'PLANNED'
    OR order_plan_id IS DISTINCT FROM NEW."plan_id"
    OR order_plan_version IS DISTINCT FROM NEW."plan_version"
    OR order_plan_order_id IS DISTINCT FROM NEW."plan_order_id"
    OR order_logical_order_id IS DISTINCT FROM NEW."logical_order_id"
    OR order_client_order_id IS DISTINCT FROM NEW."client_order_id"
    OR account_external_ref_hmac IS DISTINCT FROM NEW."broker_account_reference_hmac"
    OR reservation_order_id IS DISTINCT FROM NEW."order_id"
    OR reservation_reserved IS DISTINCT FROM pre_reserved
    OR reservation_released <> 0
    OR risk_plan_id IS DISTINCT FROM order_plan_id
    OR risk_plan_version IS DISTINCT FROM order_plan_version
    OR risk_account_id IS DISTINCT FROM order_account_id
    OR risk_expires_at <= NEW."prepared_at"
    OR latest_promotion_id IS DISTINCT FROM risk_promotion_event_id
    OR pre_risk_id IS DISTINCT FROM NEW."execution_risk_evidence_id"
    OR pre_plan_order_id IS DISTINCT FROM order_plan_order_id
    OR pre_account_id IS DISTINCT FROM order_account_id
    OR pre_expires_at <= NEW."prepared_at"
    OR approval_plan_order_id IS DISTINCT FROM order_plan_order_id
    OR approval_account_id IS DISTINCT FROM order_account_id
    OR approval_expires_at <= NEW."prepared_at"
    OR approval_consumed_at IS NOT NULL
    OR approval_consumed_by IS NOT NULL
    OR latest_kill_state IS DISTINCT FROM 'DISENGAGED'
    OR NEW."expires_at" <= NEW."prepared_at"
    OR NEW."expires_at" > LEAST(risk_expires_at, pre_expires_at, approval_expires_at)
    OR EXISTS (
      SELECT 1
      FROM public."order_ledger_current_state" AS current_state
      WHERE current_state."account_id" = order_account_id
        AND current_state."order_id" <> NEW."order_id"
        AND current_state."normalized_state"::TEXT IN (
          'SUBMITTING', 'PENDING', 'PARTIAL_FILLED', 'UNKNOWN', 'UNKNOWN_BLOCKED'
        )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'submission authorization must exclusively bind fresh LIVE risk, pre-submit, reservation, approval and kill-switch evidence';
  END IF;

  canonical_payload := NEW."canonical_preparation"::JSONB;
  IF canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'version', 'ORDER_SUBMISSION_AUTHORIZATION_V1',
    'submissionAuthorizationId', NEW."id"::TEXT,
    'planId', NEW."plan_id"::TEXT,
    'planVersion', NEW."plan_version",
    'planOrderId', NEW."plan_order_id"::TEXT,
    'logicalOrderId', NEW."logical_order_id"::TEXT,
    'accountId', order_account_id::TEXT,
    'clientOrderId', NEW."client_order_id"::TEXT,
    'canonicalIntentSha256', order_intent_sha::TEXT,
    'authorizedRequestDigest', NEW."authorized_request_digest"::TEXT,
    'brokerAccountReferenceHmac', NEW."broker_account_reference_hmac"::TEXT,
    'executionRiskEvidenceId', NEW."execution_risk_evidence_id"::TEXT,
    'preSubmitEvidenceId', NEW."pre_submit_evidence_id"::TEXT,
    'reservationId', NEW."reservation_id"::TEXT,
    'approvalId', NEW."approval_id"::TEXT,
    'expiresAt', pg_catalog.to_char(
      NEW."expires_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'submission authorization canonical preparation does not match its immutable columns';
  END IF;

  UPDATE public."manual_order_approval"
  SET
    "consumed_at" = NEW."prepared_at",
    "consumed_by_order_id" = NEW."order_id"
  WHERE "id" = NEW."approval_id";

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.initialize_order_submission_authorization() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  INSERT INTO public."order_state_history" (
    "order_id",
    "sequence",
    "normalized_state",
    "actor",
    "manual_approval_id",
    "submission_authorization_id",
    "detail",
    "occurred_at",
    "created_at"
  ) VALUES (
    NEW."order_id",
    1,
    'SUBMITTING',
    'EXECUTOR',
    NEW."approval_id",
    NEW."id",
    pg_catalog.jsonb_build_object(
      'reason', 'LIVE_SUBMISSION_AUTHORIZED',
      'submissionAuthorizationId', NEW."id"::TEXT
    ),
    NEW."prepared_at",
    NEW."prepared_at"
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_dispatch_claim() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  auth_order_id UUID;
  auth_logical_order_id UUID;
  auth_plan_id UUID;
  auth_plan_version INTEGER;
  auth_plan_order_id UUID;
  auth_client_order_id CHAR(36);
  auth_account_hmac CHAR(64);
  auth_authorized_request_digest CHAR(64);
  auth_risk_id UUID;
  auth_pre_submit_id UUID;
  auth_reservation_id UUID;
  auth_approval_id UUID;
  auth_expires_at TIMESTAMPTZ;
  order_account_id UUID;
  order_intent_sha CHAR(64);
  latest_state TEXT;
  latest_state_authorization_id UUID;
  latest_kill_state TEXT;
  approval_consumed_at TIMESTAMPTZ;
  approval_consumed_by UUID;
  risk_expires_at TIMESTAMPTZ;
  pre_expires_at TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order dispatch claim is append-only';
  END IF;

  NEW."claimed_at" := pg_catalog.statement_timestamp();
  NEW."intent_audited_at" := NEW."claimed_at";
  NEW."dispatch_started_at" := NEW."claimed_at";

  SELECT
    auth."order_id",
    auth."logical_order_id",
    auth."plan_id",
    auth."plan_version",
    auth."plan_order_id",
    auth."client_order_id",
    auth."broker_account_reference_hmac",
    auth."authorized_request_digest",
    auth."execution_risk_evidence_id",
    auth."pre_submit_evidence_id",
    auth."reservation_id",
    auth."approval_id",
    auth."expires_at"
  INTO
    auth_order_id,
    auth_logical_order_id,
    auth_plan_id,
    auth_plan_version,
    auth_plan_order_id,
    auth_client_order_id,
    auth_account_hmac,
    auth_authorized_request_digest,
    auth_risk_id,
    auth_pre_submit_id,
    auth_reservation_id,
    auth_approval_id,
    auth_expires_at
  FROM public."order_submission_authorization" AS auth
  WHERE auth."id" = NEW."submission_authorization_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'dispatch claim requires an existing submission authorization';
  END IF;

  SELECT ledger."account_id", ledger."intent_sha256"
  INTO order_account_id, order_intent_sha
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = auth_order_id
  FOR UPDATE;

  SELECT history."normalized_state"::TEXT, history."submission_authorization_id"
  INTO latest_state, latest_state_authorization_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = auth_order_id
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT approval."consumed_at", approval."consumed_by_order_id"
  INTO approval_consumed_at, approval_consumed_by
  FROM public."manual_order_approval" AS approval
  WHERE approval."id" = auth_approval_id;

  SELECT risk."expires_at"
  INTO risk_expires_at
  FROM public."execution_risk_evidence" AS risk
  WHERE risk."id" = auth_risk_id;

  SELECT evidence."expires_at"
  INTO pre_expires_at
  FROM public."pre_submit_evidence" AS evidence
  WHERE evidence."id" = auth_pre_submit_id;

  SELECT event."state"::TEXT
  INTO latest_kill_state
  FROM public."kill_switch_event" AS event
  WHERE event."account_id" = order_account_id
  ORDER BY event."version" DESC
  LIMIT 1;

  IF auth_order_id IS DISTINCT FROM NEW."order_id"
    OR auth_logical_order_id IS DISTINCT FROM NEW."logical_order_id"
    OR auth_plan_id IS DISTINCT FROM NEW."plan_id"
    OR auth_plan_version IS DISTINCT FROM NEW."plan_version"
    OR auth_plan_order_id IS DISTINCT FROM NEW."plan_order_id"
    OR auth_client_order_id IS DISTINCT FROM NEW."client_order_id"
    OR auth_account_hmac IS DISTINCT FROM NEW."broker_account_reference_hmac"
    OR auth_authorized_request_digest IS DISTINCT FROM NEW."authorized_request_digest"
    OR latest_state IS DISTINCT FROM 'SUBMITTING'
    OR latest_state_authorization_id IS DISTINCT FROM NEW."submission_authorization_id"
    OR approval_consumed_at IS NULL
    OR approval_consumed_by IS DISTINCT FROM auth_order_id
    OR latest_kill_state IS DISTINCT FROM 'DISENGAGED'
    OR auth_expires_at <= NEW."claimed_at"
    OR risk_expires_at <= NEW."claimed_at"
    OR pre_expires_at <= NEW."claimed_at"
    OR NEW."authorization_issued_at" > NEW."claimed_at"
    OR NEW."authorization_expires_at" <= NEW."claimed_at"
    OR NEW."authorization_expires_at" > auth_expires_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'dispatch claim must be the first one-time audit of the exact unexpired SUBMITTING authorization';
  END IF;

  canonical_payload := NEW."canonical_request"::JSONB;
  IF canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'version', 'ORDER_DISPATCH_CLAIM_V1',
    'dispatchClaimId', NEW."id"::TEXT,
    'submissionAuthorizationId', NEW."submission_authorization_id"::TEXT,
    'authorizationId', NEW."authorization_id",
    'planId', NEW."plan_id"::TEXT,
    'planVersion', NEW."plan_version",
    'planOrderId', NEW."plan_order_id"::TEXT,
    'logicalOrderId', NEW."logical_order_id"::TEXT,
    'accountId', order_account_id::TEXT,
    'clientOrderId', NEW."client_order_id"::TEXT,
    'canonicalIntentSha256', order_intent_sha::TEXT,
    'authorizedRequestDigest', NEW."authorized_request_digest"::TEXT,
    'brokerAccountReferenceHmac', NEW."broker_account_reference_hmac"::TEXT,
    'executionRiskEvidenceId', auth_risk_id::TEXT,
    'preSubmitEvidenceId', auth_pre_submit_id::TEXT,
    'reservationId', auth_reservation_id::TEXT,
    'approvalId', auth_approval_id::TEXT,
    'authorizationIssuedAt', pg_catalog.to_char(
      NEW."authorization_issued_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'authorizationExpiresAt', pg_catalog.to_char(
      NEW."authorization_expires_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'dispatch canonical request does not match its immutable claim columns';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_daily_trade_limit() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'daily trade limit is immutable';
  END IF;
  NEW."created_at" := pg_catalog.statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_ledger() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  linked_plan_id UUID;
  linked_plan_version INTEGER;
  linked_run_id UUID;
  linked_account_id UUID;
  linked_plan_hash CHAR(64);
  linked_plan_mode TEXT;
  linked_plan_status TEXT;
  linked_run_status TEXT;
  linked_phase TEXT;
  linked_market_country TEXT;
  linked_currency TEXT;
  linked_symbol TEXT;
  linked_side TEXT;
  linked_order_type TEXT;
  linked_time_in_force TEXT;
  linked_quantity BIGINT;
  linked_limit_price_minor BIGINT;
  linked_notional_minor BIGINT;
  limit_account_id UUID;
  limit_market_country TEXT;
  limit_currency TEXT;
  limit_mode TEXT;
  limit_trade_day DATE;
  reservation_evidence_plan_order_id UUID;
  reservation_evidence_account_id UUID;
  reservation_evidence_basis BIGINT;
  reservation_evidence_reserved BIGINT;
  reservation_evidence_expires_at TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order intent is immutable';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();

  SELECT
    plan_order."plan_id",
    plan_order."plan_version",
    run."id",
    run."account_id",
    version."plan_hash",
    version."mode"::TEXT,
    version."status"::TEXT,
    run."status"::TEXT,
    plan_order."phase",
    plan_order."market_country",
    plan_order."currency",
    plan_order."symbol",
    plan_order."side",
    plan_order."order_type",
    plan_order."time_in_force",
    plan_order."quantity",
    plan_order."limit_price_minor",
    plan_order."notional_minor"
  INTO
    linked_plan_id,
    linked_plan_version,
    linked_run_id,
    linked_account_id,
    linked_plan_hash,
    linked_plan_mode,
    linked_plan_status,
    linked_run_status,
    linked_phase,
    linked_market_country,
    linked_currency,
    linked_symbol,
    linked_side,
    linked_order_type,
    linked_time_in_force,
    linked_quantity,
    linked_limit_price_minor,
    linked_notional_minor
  FROM public."rebalance_plan_order" AS plan_order
  JOIN public."rebalance_plan" AS plan
    ON plan."id" = plan_order."plan_id"
  JOIN public."rebalance_plan_version" AS version
    ON version."plan_id" = plan_order."plan_id"
   AND version."version" = plan_order."plan_version"
  JOIN public."rebalance_run" AS run
    ON run."id" = plan."run_id"
  WHERE plan_order."id" = NEW."plan_order_id";

  IF NOT FOUND
    OR linked_plan_status IS DISTINCT FROM 'PLANNED'
    OR linked_run_status IS DISTINCT FROM 'PLANNED'
    OR linked_plan_id IS DISTINCT FROM NEW."plan_id"
    OR linked_plan_version IS DISTINCT FROM NEW."plan_version"
    OR linked_plan_mode NOT IN ('PAPER', 'LIVE')
    OR linked_plan_mode IS DISTINCT FROM NEW."mode"::TEXT
    OR linked_account_id IS DISTINCT FROM NEW."account_id"
    OR linked_phase IS DISTINCT FROM NEW."phase"
    OR linked_market_country IS DISTINCT FROM NEW."market_country"
    OR linked_currency IS DISTINCT FROM NEW."currency"
    OR linked_symbol IS DISTINCT FROM NEW."symbol"
    OR linked_side IS DISTINCT FROM NEW."side"
    OR linked_order_type IS DISTINCT FROM NEW."order_type"
    OR linked_time_in_force IS DISTINCT FROM NEW."time_in_force"
    OR linked_quantity IS DISTINCT FROM NEW."quantity"
    OR linked_limit_price_minor IS DISTINCT FROM NEW."limit_price_minor"
    OR linked_notional_minor IS DISTINCT FROM NEW."planned_gross_notional_minor" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order intent must exactly match one sealed PAPER or LIVE plan order';
  END IF;

  SELECT
    daily_limit."account_id",
    daily_limit."market_country",
    daily_limit."currency",
    daily_limit."mode"::TEXT,
    daily_limit."trade_day"
  INTO
    limit_account_id,
    limit_market_country,
    limit_currency,
    limit_mode,
    limit_trade_day
  FROM public."daily_trade_limit" AS daily_limit
  WHERE daily_limit."id" = NEW."daily_trade_limit_id";

  IF NOT FOUND
    OR limit_account_id IS DISTINCT FROM NEW."account_id"
    OR limit_market_country IS DISTINCT FROM NEW."market_country"
    OR limit_currency IS DISTINCT FROM NEW."currency"
    OR limit_mode IS DISTINCT FROM NEW."mode"::TEXT
    OR limit_trade_day IS DISTINCT FROM (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Seoul')::DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order intent daily limit scope does not match its account, market, currency and mode';
  END IF;

  IF NEW."mode" = 'LIVE' THEN
    SELECT
      evidence."plan_order_id",
      evidence."account_id",
      evidence."reservation_basis_price_minor",
      evidence."reserved_gross_minor",
      evidence."expires_at"
    INTO
      reservation_evidence_plan_order_id,
      reservation_evidence_account_id,
      reservation_evidence_basis,
      reservation_evidence_reserved,
      reservation_evidence_expires_at
    FROM public."pre_submit_evidence" AS evidence
    WHERE evidence."id" = NEW."reservation_evidence_id";

    IF NOT FOUND
      OR reservation_evidence_plan_order_id IS DISTINCT FROM NEW."plan_order_id"
      OR reservation_evidence_account_id IS DISTINCT FROM NEW."account_id"
      OR reservation_evidence_basis IS DISTINCT FROM NEW."reservation_basis_price_minor"
      OR reservation_evidence_reserved IS DISTINCT FROM NEW."reserved_gross_minor"
      OR reservation_evidence_expires_at <= NEW."created_at" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'LIVE order reservation must use its exact unexpired pre-submit evidence';
    END IF;
  ELSIF NEW."reservation_evidence_id" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PAPER order must not attach LIVE pre-submit reservation evidence';
  END IF;

  IF NEW."side" = 'BUY'
    AND NEW."reservation_basis_price_minor" IS DISTINCT FROM NEW."limit_price_minor" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'BUY reservation basis must equal its limit price';
  END IF;

  canonical_payload := NEW."canonical_intent"::JSONB;
  IF canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'version', NEW."client_order_id_version",
    'logicalOrderId', NEW."logical_order_id"::TEXT,
    'rebalanceRunId', linked_run_id::TEXT,
    'planId', linked_plan_id::TEXT,
    'planVersion', NEW."plan_version",
    'planHash', linked_plan_hash::TEXT,
    'phase', NEW."phase",
    'marketCountry', NEW."market_country",
    'symbol', NEW."symbol",
    'side', NEW."side",
    'orderType', NEW."order_type",
    'timeInForce', NEW."time_in_force",
    'quantity', NEW."quantity"::TEXT,
    'price', NEW."limit_price_minor"::TEXT
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'canonical order intent does not match immutable ledger columns';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_broker_order_action() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  known_original_broker_order_id TEXT;
  order_mode TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker order actions are append-only';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();
  NEW."body_sha256" := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW."redacted_body"::TEXT, 'UTF8')),
    'hex'
  );

  SELECT ledger."mode"::TEXT
  INTO order_mode
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF NOT FOUND OR order_mode IS DISTINCT FROM 'LIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker order action requires an existing LIVE logical order';
  END IF;

  SELECT history."broker_order_id"
  INTO known_original_broker_order_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
    AND history."broker_order_id" IS NOT NULL
  ORDER BY history."sequence" DESC
  LIMIT 1;

  IF NOT FOUND
    OR known_original_broker_order_id IS DISTINCT FROM NEW."original_broker_order_id" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker action must pin the original broker order before storing its child order ID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_broker_order_response_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  known_original_broker_order_id TEXT;
  expected_state public."OrderLedgerState";
  claim_order_id UUID;
  claim_dispatch_started_at TIMESTAMPTZ;
  order_mode TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker order response evidence is append-only';
  END IF;

  SELECT ledger."mode"::TEXT
  INTO order_mode
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF NOT FOUND OR order_mode IS DISTINCT FROM 'LIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker order response evidence requires an existing LIVE logical order';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();
  NEW."body_sha256" := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW."redacted_body"::TEXT, 'UTF8')),
    'hex'
  );
  expected_state := public.expected_broker_normalized_state(
    NEW."evidence_kind",
    NEW."broker_status_raw"
  );

  IF NEW."normalization_version" IS DISTINCT FROM 'TOSS_ORDER_NORMALIZATION_V1'
    OR expected_state IS DISTINCT FROM NEW."validated_normalized_state" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker response evidence normalized outcome does not match the sealed normalization policy';
  END IF;

  IF NEW."evidence_kind" = 'SUBMIT' THEN
    SELECT claim."order_id", claim."dispatch_started_at"
    INTO claim_order_id, claim_dispatch_started_at
    FROM public."order_dispatch_claim" AS claim
    WHERE claim."id" = NEW."dispatch_claim_id";

    IF NOT FOUND
      OR claim_order_id IS DISTINCT FROM NEW."order_id"
      OR NEW."observed_at" < claim_dispatch_started_at
      OR NEW."write_outcome" NOT IN ('ACKNOWLEDGED', 'REJECTED', 'AMBIGUOUS', 'INTEGRITY_BLOCKED')
      OR NEW."write_outcome" IS DISTINCT FROM NEW."broker_status_raw"
      OR (
        NEW."write_outcome" = 'ACKNOWLEDGED'
        AND (NEW."http_status" NOT BETWEEN 200 AND 299 OR NEW."broker_order_id" IS NULL)
      )
      OR (
        NEW."write_outcome" = 'REJECTED'
        AND NEW."http_status" NOT IN (400, 422)
      ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'SUBMIT response evidence must bind its exact dispatch claim, HTTP outcome and broker order ID';
    END IF;
  ELSIF NEW."evidence_kind" = 'RECONCILE' THEN
    IF NEW."dispatch_claim_id" IS NOT NULL
      OR (
        NEW."write_outcome" = 'OBSERVED'
        AND (
          NEW."http_status" NOT BETWEEN 200 AND 299
          OR NEW."broker_order_id" IS NULL
          OR NEW."broker_status_raw" IS NULL
          OR NEW."safe_error_code" IS NOT NULL
        )
      )
      OR (
        NEW."write_outcome" = 'INTEGRITY_BLOCKED'
        AND (
          NEW."validated_normalized_state"::TEXT IS DISTINCT FROM 'UNKNOWN_BLOCKED'
          OR NEW."safe_error_code" IS NULL
          OR NEW."broker_status_raw" IS DISTINCT FROM 'INTEGRITY_BLOCKED'
        )
      )
      OR NEW."write_outcome" NOT IN ('OBSERVED', 'INTEGRITY_BLOCKED') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'RECONCILE evidence must be an observed broker order or a sealed integrity block';
    END IF;
  ELSE
    IF NEW."dispatch_claim_id" IS NOT NULL
      OR NEW."write_outcome" NOT IN ('REJECTED', 'AMBIGUOUS', 'INTEGRITY_BLOCKED')
      OR NEW."broker_order_id" IS NULL
      OR NEW."broker_status_raw" IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'cancel or replace attempt evidence must preserve the original broker order without a submit claim';
    END IF;
  END IF;

  IF NEW."broker_order_id" IS NOT NULL THEN
    SELECT history."broker_order_id"
    INTO known_original_broker_order_id
    FROM public."order_state_history" AS history
    WHERE history."order_id" = NEW."order_id"
      AND history."broker_order_id" IS NOT NULL
    ORDER BY history."sequence" DESC
    LIMIT 1;

    IF FOUND AND known_original_broker_order_id IS DISTINCT FROM NEW."broker_order_id" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'broker response evidence cannot replace the original broker order ID';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_daily_trade_reservation() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  daily_limit_minor BIGINT;
  daily_limit_account_id UUID;
  daily_limit_mode TEXT;
  order_limit_id UUID;
  order_account_id UUID;
  order_mode TEXT;
  order_reserved_gross BIGINT;
  current_usage NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'daily trade reservation cannot be deleted';
  END IF;

  IF pg_catalog.pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'daily trade reservation can only change with its order ledger event';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT
      daily_limit."gross_limit_minor",
      daily_limit."account_id",
      daily_limit."mode"::TEXT
    INTO daily_limit_minor, daily_limit_account_id, daily_limit_mode
    FROM public."daily_trade_limit" AS daily_limit
    WHERE daily_limit."id" = NEW."daily_trade_limit_id"
    FOR UPDATE;

    SELECT
      ledger."daily_trade_limit_id",
      ledger."account_id",
      ledger."mode"::TEXT,
      ledger."reserved_gross_minor"
    INTO order_limit_id, order_account_id, order_mode, order_reserved_gross
    FROM public."order_ledger" AS ledger
    WHERE ledger."id" = NEW."order_id";

    IF NOT FOUND
      OR order_limit_id IS DISTINCT FROM NEW."daily_trade_limit_id"
      OR order_account_id IS DISTINCT FROM daily_limit_account_id
      OR order_mode IS DISTINCT FROM daily_limit_mode
      OR order_reserved_gross IS DISTINCT FROM NEW."reserved_gross_minor"
      OR NEW."filled_gross_minor" <> 0
      OR NEW."released_gross_minor" <> 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'daily trade reservation must exactly match its immutable order intent';
    END IF;

    SELECT COALESCE(
      SUM((reservation."reserved_gross_minor" - reservation."released_gross_minor")::NUMERIC),
      0
    )
    INTO current_usage
    FROM public."daily_trade_reservation" AS reservation
    WHERE reservation."daily_trade_limit_id" = NEW."daily_trade_limit_id";

    IF current_usage + NEW."reserved_gross_minor"::NUMERIC > daily_limit_minor::NUMERIC THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'daily KR gross trade limit would be exceeded';
    END IF;

    RETURN NEW;
  END IF;

  IF
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."daily_trade_limit_id" IS DISTINCT FROM OLD."daily_trade_limit_id"
    OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
    OR NEW."reserved_gross_minor" IS DISTINCT FROM OLD."reserved_gross_minor"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."filled_gross_minor" < OLD."filled_gross_minor"
    OR NEW."released_gross_minor" < OLD."released_gross_minor"
    OR NEW."filled_gross_minor" + NEW."released_gross_minor" > NEW."reserved_gross_minor"
    OR NEW."updated_at" < OLD."updated_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'daily trade reservation update violates monotonic invariants';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_manual_order_approval() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  linked_account_id UUID;
  linked_plan_hash CHAR(64);
  linked_plan_mode TEXT;
  linked_plan_status TEXT;
  linked_run_status TEXT;
  consumed_order_plan_order_id UUID;
  consumed_order_account_id UUID;
  consumed_order_mode TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'manual order approval cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    canonical_payload := NEW."canonical_content"::JSONB;
    SELECT
      run."account_id",
      version."plan_hash",
      version."mode"::TEXT,
      version."status"::TEXT,
      run."status"::TEXT
    INTO
      linked_account_id,
      linked_plan_hash,
      linked_plan_mode,
      linked_plan_status,
      linked_run_status
    FROM public."rebalance_plan_order" AS plan_order
    JOIN public."rebalance_plan" AS plan
      ON plan."id" = plan_order."plan_id"
    JOIN public."rebalance_plan_version" AS version
      ON version."plan_id" = plan_order."plan_id"
     AND version."version" = plan_order."plan_version"
    JOIN public."rebalance_run" AS run
      ON run."id" = plan."run_id"
    WHERE plan_order."id" = NEW."plan_order_id";

    IF NOT FOUND
      OR linked_account_id IS DISTINCT FROM NEW."account_id"
      OR linked_plan_hash IS DISTINCT FROM NEW."plan_hash"
      OR linked_plan_mode IS DISTINCT FROM 'LIVE'
      OR linked_plan_status IS DISTINCT FROM 'PLANNED'
      OR linked_run_status IS DISTINCT FROM 'PLANNED'
      OR canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
        'version', NEW."confirmation_version",
        'accountId', NEW."account_id"::TEXT,
        'planOrderId', NEW."plan_order_id"::TEXT,
        'planHash', NEW."plan_hash"::TEXT,
        'actor', NEW."actor",
        'createdAt', canonical_payload ->> 'createdAt',
        'expiresAt', canonical_payload ->> 'expiresAt'
      )
      OR (canonical_payload ->> 'createdAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."created_at"
      OR (canonical_payload ->> 'expiresAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."expires_at"
      OR NEW."created_at" < pg_catalog.statement_timestamp() - INTERVAL '5 seconds'
      OR NEW."created_at" > pg_catalog.statement_timestamp() + INTERVAL '5 seconds'
      OR NEW."expires_at" <= pg_catalog.statement_timestamp()
      OR NEW."consumed_at" IS NOT NULL
      OR NEW."consumed_by_order_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'manual approval must pin one unexpired sealed LIVE plan order';
    END IF;

    RETURN NEW;
  END IF;

  IF pg_catalog.pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'manual order approval can only be consumed by a LIVE submit transition';
  END IF;

  IF
    OLD."consumed_at" IS NOT NULL
    OR OLD."consumed_by_order_id" IS NOT NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."plan_order_id" IS DISTINCT FROM OLD."plan_order_id"
    OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."approval_hash" IS DISTINCT FROM OLD."approval_hash"
    OR NEW."plan_hash" IS DISTINCT FROM OLD."plan_hash"
    OR NEW."actor" IS DISTINCT FROM OLD."actor"
    OR NEW."confirmation_version" IS DISTINCT FROM OLD."confirmation_version"
    OR NEW."canonical_content" IS DISTINCT FROM OLD."canonical_content"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."consumed_at" IS NULL
    OR NEW."consumed_by_order_id" IS NULL
    OR NEW."consumed_at" IS DISTINCT FROM pg_catalog.statement_timestamp()
    OR NEW."consumed_at" >= OLD."expires_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'manual order approval consumption is immutable and one-time';
  END IF;

  SELECT
    ledger."plan_order_id",
    ledger."account_id",
    ledger."mode"::TEXT
  INTO
    consumed_order_plan_order_id,
    consumed_order_account_id,
    consumed_order_mode
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."consumed_by_order_id";

  IF NOT FOUND
    OR consumed_order_plan_order_id IS DISTINCT FROM OLD."plan_order_id"
    OR consumed_order_account_id IS DISTINCT FROM OLD."account_id"
    OR consumed_order_mode IS DISTINCT FROM 'LIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'manual order approval can only be consumed by its exact LIVE order';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_kill_switch_event() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  previous_version INTEGER;
  previous_state TEXT;
  previous_occurred_at TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'kill switch events are append-only';
  END IF;

  NEW."occurred_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."occurred_at";

  PERFORM 1
  FROM public."broker_account" AS account
  WHERE account."id" = NEW."account_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'kill switch account does not exist';
  END IF;

  SELECT
    event."version",
    event."state"::TEXT,
    event."occurred_at"
  INTO previous_version, previous_state, previous_occurred_at
  FROM public."kill_switch_event" AS event
  WHERE event."account_id" = NEW."account_id"
  ORDER BY event."version" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW."version" <> 1 OR NEW."state"::TEXT <> 'ENGAGED' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'kill switch must begin in ENGAGED version 1';
    END IF;
  ELSIF
    NEW."version" <> previous_version + 1
    OR NEW."state"::TEXT = previous_state
    OR NEW."occurred_at" < previous_occurred_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'kill switch event must be a contiguous state-changing version';
  END IF;

  RETURN NEW;
END;
$$;

/* Superseded by the evidence-bound state guard below.
CREATE FUNCTION public.guard_order_state_history() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  order_mode TEXT;
  order_account_id UUID;
  order_plan_order_id UUID;
  order_quantity BIGINT;
  order_created_at TIMESTAMPTZ;
  previous_sequence INTEGER;
  previous_state TEXT;
  previous_filled_quantity BIGINT;
  previous_filled_gross BIGINT;
  previous_fee BIGINT;
  previous_occurred_at TIMESTAMPTZ;
  known_broker_order_id TEXT;
  latest_kill_state TEXT;
  approval_plan_order_id UUID;
  approval_account_id UUID;
  approval_expires_at TIMESTAMPTZ;
  approval_consumed_at TIMESTAMPTZ;
  approval_consumed_by UUID;
  action_order_id UUID;
  action_kind TEXT;
  action_original_broker_order_id TEXT;
  action_broker_order_id TEXT;
  action_broker_status_raw TEXT;
  evidence_order_id UUID;
  evidence_broker_order_id TEXT;
  evidence_broker_status_raw TEXT;
  reservation_reserved BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state history is append-only';
  END IF;

  SELECT
    ledger."mode"::TEXT,
    ledger."account_id",
    ledger."plan_order_id",
    ledger."quantity",
    ledger."created_at"
  INTO
    order_mode,
    order_account_id,
    order_plan_order_id,
    order_quantity,
    order_created_at
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'order state history requires an existing order';
  END IF;

  SELECT
    history."sequence",
    history."normalized_state"::TEXT,
    history."filled_quantity",
    history."filled_gross_notional_minor",
    history."fee_minor",
    history."occurred_at"
  INTO
    previous_sequence,
    previous_state,
    previous_filled_quantity,
    previous_filled_gross,
    previous_fee,
    previous_occurred_at
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF
      NEW."sequence" <> 0
      OR NEW."normalized_state"::TEXT <> 'PLANNED'
      OR NEW."filled_quantity" <> 0
      OR NEW."filled_gross_notional_minor" <> 0
      OR NEW."fee_minor" <> 0
      OR NEW."actor" <> 'EXECUTOR'
      OR NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
      OR NEW."manual_approval_id" IS NOT NULL
      OR NEW."occurred_at" < order_created_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'order state history must begin with one zero-filled PLANNED event';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."sequence" <> previous_sequence + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state sequence must be contiguous';
  END IF;

  SELECT history."broker_order_id"
  INTO known_broker_order_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
    AND history."broker_order_id" IS NOT NULL
  ORDER BY history."sequence" DESC
  LIMIT 1;

  IF NOT (
    (previous_state = 'PLANNED' AND NEW."normalized_state"::TEXT = 'SUBMITTING')
    OR (previous_state = 'SUBMITTING' AND NEW."normalized_state"::TEXT IN ('PENDING', 'REJECTED', 'UNKNOWN'))
    OR (previous_state = 'PENDING' AND NEW."normalized_state"::TEXT IN ('PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED'))
    OR (previous_state = 'PARTIAL_FILLED' AND NEW."normalized_state"::TEXT IN ('PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED'))
    OR (previous_state = 'UNKNOWN' AND NEW."normalized_state"::TEXT IN ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN_BLOCKED'))
    OR (previous_state = 'UNKNOWN_BLOCKED' AND NEW."normalized_state"::TEXT IN ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'illegal normalized order state transition';
  END IF;

  IF NEW."broker_status_raw" IN ('CANCEL_REJECTED', 'REPLACE_REJECTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cancel or replace rejection is a separate broker order record and cannot mutate the original logical order state';
  END IF;

  IF NEW."broker_action_id" IS NOT NULL THEN
    SELECT
      action."order_id",
      action."action_kind"::TEXT,
      action."original_broker_order_id",
      action."broker_action_order_id",
      action."broker_status_raw"
    INTO
      action_order_id,
      action_kind,
      action_original_broker_order_id,
      action_broker_order_id,
      action_broker_status_raw
    FROM public."broker_order_action" AS action
    WHERE action."id" = NEW."broker_action_id";

    IF NOT FOUND
      OR action_order_id IS DISTINCT FROM NEW."order_id"
      OR action_kind IS DISTINCT FROM 'CANCEL'
      OR NEW."normalized_state"::TEXT <> 'CANCELED'
      OR action_broker_status_raw IN ('CANCEL_REJECTED', 'REPLACE_REJECTED')
      OR NEW."broker_order_id" IS DISTINCT FROM action_original_broker_order_id
      OR NEW."broker_status_raw" IS DISTINCT FROM action_broker_status_raw THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'CANCELED state must reference its exact accepted CANCEL child order action';
    END IF;
  END IF;

  IF NEW."broker_response_evidence_id" IS NOT NULL THEN
    SELECT
      evidence."order_id",
      evidence."broker_order_id",
      evidence."broker_status_raw"
    INTO
      evidence_order_id,
      evidence_broker_order_id,
      evidence_broker_status_raw
    FROM public."broker_order_response_evidence" AS evidence
    WHERE evidence."id" = NEW."broker_response_evidence_id";

    IF NOT FOUND
      OR evidence_order_id IS DISTINCT FROM NEW."order_id"
      OR (
        evidence_broker_order_id IS NOT NULL
        AND NEW."broker_order_id" IS DISTINCT FROM evidence_broker_order_id
      )
      OR (
        evidence_broker_status_raw IS NOT NULL
        AND NEW."broker_status_raw" IS DISTINCT FROM evidence_broker_status_raw
      ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'normalized state must match its exact broker response evidence';
    END IF;
  END IF;

  SELECT reservation."reserved_gross_minor"
  INTO reservation_reserved
  FROM public."daily_trade_reservation" AS reservation
  WHERE reservation."order_id" = NEW."order_id";

  IF NOT FOUND
    OR NEW."filled_quantity" < previous_filled_quantity
    OR NEW."filled_quantity" > order_quantity
    OR NEW."filled_gross_notional_minor" < previous_filled_gross
    OR NEW."filled_gross_notional_minor" > reservation_reserved
    OR NEW."fee_minor" < previous_fee
    OR NEW."occurred_at" < previous_occurred_at
    OR (
      known_broker_order_id IS NOT NULL
      AND NEW."broker_order_id" IS NOT NULL
      AND NEW."broker_order_id" IS DISTINCT FROM known_broker_order_id
    )
    OR (
      (NEW."filled_quantity" = 0)
      IS DISTINCT FROM (NEW."filled_gross_notional_minor" = 0)
    )
    OR (
      NEW."normalized_state"::TEXT = 'PARTIAL_FILLED'
      AND (NEW."filled_quantity" <= 0 OR NEW."filled_quantity" >= order_quantity)
    )
    OR (
      NEW."normalized_state"::TEXT = 'FILLED'
      AND NEW."filled_quantity" <> order_quantity
    )
    OR (
      NEW."normalized_state"::TEXT IN ('CANCELED', 'REJECTED')
      AND NEW."filled_quantity" >= order_quantity
    )
    OR (
      NEW."normalized_state"::TEXT = 'UNKNOWN_BLOCKED'
      AND (
        NEW."filled_quantity" <> previous_filled_quantity
        OR NEW."filled_gross_notional_minor" <> previous_filled_gross
        OR NEW."fee_minor" <> previous_fee
      )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state event violates monotonic fill, fee or time invariants';
  END IF;

  IF previous_state = 'PARTIAL_FILLED'
    AND NEW."normalized_state"::TEXT = 'PARTIAL_FILLED'
    AND NEW."filled_quantity" = previous_filled_quantity
    AND NEW."filled_gross_notional_minor" = previous_filled_gross THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'repeated PARTIAL_FILLED must add a fill';
  END IF;

  IF previous_state = 'PLANNED'
    AND NEW."normalized_state"::TEXT = 'SUBMITTING'
    AND NEW."actor" <> 'EXECUTOR' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PLANNED to SUBMITTING requires EXECUTOR actor';
  END IF;

  IF previous_state = 'UNKNOWN_BLOCKED' THEN
    IF NEW."actor" <> 'OPERATOR' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'UNKNOWN_BLOCKED recovery requires OPERATOR actor';
    END IF;
    IF NEW."broker_response_evidence_id" IS NULL AND NEW."broker_action_id" IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'UNKNOWN_BLOCKED recovery requires persisted broker evidence';
    END IF;
    IF NEW."broker_response_evidence_id" IS NOT NULL
      AND evidence_broker_status_raw IS DISTINCT FROM NEW."normalized_state"::TEXT THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'UNKNOWN_BLOCKED recovery evidence must prove the target broker state';
    END IF;
  ELSIF NEW."actor" = 'OPERATOR' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'OPERATOR actor is reserved for UNKNOWN_BLOCKED recovery';
  END IF;

  IF order_mode = 'LIVE'
    AND NEW."normalized_state"::TEXT IN ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'REJECTED')
    AND NEW."broker_response_evidence_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'LIVE broker state requires append-only response evidence';
  END IF;

  IF order_mode = 'LIVE'
    AND NEW."normalized_state"::TEXT = 'CANCELED'
    AND NEW."broker_response_evidence_id" IS NULL
    AND NEW."broker_action_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'LIVE CANCELED state requires response evidence or a CANCEL action';
  END IF;

  IF previous_state = 'PLANNED' AND NEW."normalized_state"::TEXT = 'SUBMITTING' THEN
    IF order_mode = 'LIVE' THEN
      IF NEW."manual_approval_id" IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'LIVE submission requires one manual approval';
      END IF;

      PERFORM 1
      FROM public."broker_account" AS account
      WHERE account."id" = order_account_id
      FOR UPDATE;

      SELECT event."state"::TEXT
      INTO latest_kill_state
      FROM public."kill_switch_event" AS event
      WHERE event."account_id" = order_account_id
      ORDER BY event."version" DESC
      LIMIT 1;

      IF NOT FOUND OR latest_kill_state IS DISTINCT FROM 'DISENGAGED' THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'LIVE submission is blocked unless the latest kill switch event is DISENGAGED';
      END IF;

      SELECT
        approval."plan_order_id",
        approval."account_id",
        approval."expires_at",
        approval."consumed_at",
        approval."consumed_by_order_id"
      INTO
        approval_plan_order_id,
        approval_account_id,
        approval_expires_at,
        approval_consumed_at,
        approval_consumed_by
      FROM public."manual_order_approval" AS approval
      WHERE approval."id" = NEW."manual_approval_id"
      FOR UPDATE;

      IF NOT FOUND
        OR approval_plan_order_id IS DISTINCT FROM order_plan_order_id
        OR approval_account_id IS DISTINCT FROM order_account_id
        OR approval_expires_at <= pg_catalog.statement_timestamp()
        OR approval_consumed_at IS NOT NULL
        OR approval_consumed_by IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'LIVE manual approval is missing, expired, mismatched or already consumed';
      END IF;

      UPDATE public."manual_order_approval"
      SET
        "consumed_at" = pg_catalog.statement_timestamp(),
        "consumed_by_order_id" = NEW."order_id"
      WHERE "id" = NEW."manual_approval_id";
    ELSIF NEW."manual_approval_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PAPER submission must not consume a LIVE approval';
    END IF;
  ELSIF NEW."manual_approval_id" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'manual approval can only be attached to PLANNED to SUBMITTING';
  END IF;

  UPDATE public."daily_trade_reservation"
  SET
    "filled_gross_minor" = NEW."filled_gross_notional_minor",
    "released_gross_minor" = CASE
      WHEN NEW."normalized_state"::TEXT IN ('FILLED', 'CANCELED', 'REJECTED')
        THEN "reserved_gross_minor" - NEW."filled_gross_notional_minor"
      ELSE "released_gross_minor"
    END,
    "updated_at" = pg_catalog.statement_timestamp()
  WHERE "order_id" = NEW."order_id";

  RETURN NEW;
END;
$$;
*/

CREATE FUNCTION public.guard_order_state_history() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  order_mode TEXT;
  order_account_id UUID;
  order_plan_order_id UUID;
  order_quantity BIGINT;
  order_created_at TIMESTAMPTZ;
  previous_sequence INTEGER;
  previous_state TEXT;
  previous_filled_quantity BIGINT;
  previous_filled_gross BIGINT;
  previous_fee BIGINT;
  previous_occurred_at TIMESTAMPTZ;
  previous_submission_authorization_id UUID;
  known_broker_order_id TEXT;
  approval_plan_order_id UUID;
  approval_account_id UUID;
  approval_consumed_at TIMESTAMPTZ;
  approval_consumed_by UUID;
  authorization_order_id UUID;
  authorization_approval_id UUID;
  authorization_prepared_at TIMESTAMPTZ;
  authorization_expires_at TIMESTAMPTZ;
  action_order_id UUID;
  action_kind TEXT;
  action_original_broker_order_id TEXT;
  action_broker_status_raw TEXT;
  evidence_order_id UUID;
  evidence_kind TEXT;
  evidence_dispatch_claim_id UUID;
  evidence_broker_order_id TEXT;
  evidence_broker_status_raw TEXT;
  evidence_validated_state TEXT;
  dispatch_authorization_id UUID;
  dispatch_order_id UUID;
  reservation_reserved BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state history is append-only';
  END IF;

  NEW."occurred_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."occurred_at";

  SELECT
    ledger."mode"::TEXT,
    ledger."account_id",
    ledger."plan_order_id",
    ledger."quantity",
    ledger."created_at"
  INTO
    order_mode,
    order_account_id,
    order_plan_order_id,
    order_quantity,
    order_created_at
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'order state history requires an existing order';
  END IF;

  SELECT
    history."sequence",
    history."normalized_state"::TEXT,
    history."filled_quantity",
    history."filled_gross_notional_minor",
    history."fee_minor",
    history."occurred_at",
    history."submission_authorization_id"
  INTO
    previous_sequence,
    previous_state,
    previous_filled_quantity,
    previous_filled_gross,
    previous_fee,
    previous_occurred_at,
    previous_submission_authorization_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  IF NOT FOUND THEN
    IF NEW."sequence" <> 0
      OR NEW."normalized_state"::TEXT <> 'PLANNED'
      OR NEW."filled_quantity" <> 0
      OR NEW."filled_gross_notional_minor" <> 0
      OR NEW."fee_minor" <> 0
      OR NEW."actor" <> 'EXECUTOR'
      OR NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
      OR NEW."manual_approval_id" IS NOT NULL
      OR NEW."submission_authorization_id" IS NOT NULL
      OR NEW."occurred_at" < order_created_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'order state history must begin with one zero-filled PLANNED event';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."sequence" <> previous_sequence + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state sequence must be contiguous';
  END IF;

  IF NOT (
    (previous_state = 'PLANNED' AND NEW."normalized_state"::TEXT = 'SUBMITTING')
    OR (previous_state = 'SUBMITTING' AND NEW."normalized_state"::TEXT IN ('PENDING', 'REJECTED', 'UNKNOWN', 'UNKNOWN_BLOCKED'))
    OR (previous_state = 'PENDING' AND NEW."normalized_state"::TEXT IN ('PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN', 'UNKNOWN_BLOCKED'))
    OR (previous_state = 'PARTIAL_FILLED' AND NEW."normalized_state"::TEXT IN ('PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN', 'UNKNOWN_BLOCKED'))
    OR (previous_state = 'UNKNOWN' AND NEW."normalized_state"::TEXT IN ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN_BLOCKED'))
    OR (previous_state = 'UNKNOWN_BLOCKED' AND NEW."normalized_state"::TEXT IN ('PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'illegal normalized order state transition';
  END IF;

  IF NEW."broker_status_raw" IN ('CANCEL_REJECTED', 'REPLACE_REJECTED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cancel or replace rejection cannot mutate the original logical order state';
  END IF;

  IF NEW."broker_response_evidence_id" IS NOT NULL THEN
    SELECT
      evidence."order_id",
      evidence."evidence_kind"::TEXT,
      evidence."dispatch_claim_id",
      evidence."broker_order_id",
      evidence."broker_status_raw",
      evidence."validated_normalized_state"::TEXT
    INTO
      evidence_order_id,
      evidence_kind,
      evidence_dispatch_claim_id,
      evidence_broker_order_id,
      evidence_broker_status_raw,
      evidence_validated_state
    FROM public."broker_order_response_evidence" AS evidence
    WHERE evidence."id" = NEW."broker_response_evidence_id";

    IF NOT FOUND
      OR evidence_order_id IS DISTINCT FROM NEW."order_id"
      OR evidence_validated_state IS DISTINCT FROM NEW."normalized_state"::TEXT
      OR NEW."broker_order_id" IS DISTINCT FROM evidence_broker_order_id
      OR NEW."broker_status_raw" IS DISTINCT FROM evidence_broker_status_raw THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'normalized state must match its exact validated broker response evidence';
    END IF;

    IF previous_state = 'SUBMITTING' THEN
      SELECT claim."submission_authorization_id", claim."order_id"
      INTO dispatch_authorization_id, dispatch_order_id
      FROM public."order_dispatch_claim" AS claim
      WHERE claim."id" = evidence_dispatch_claim_id;

      IF evidence_kind IS DISTINCT FROM 'SUBMIT'
        OR dispatch_order_id IS DISTINCT FROM NEW."order_id"
        OR dispatch_authorization_id IS DISTINCT FROM previous_submission_authorization_id THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'first LIVE broker outcome must bind the exact one-time dispatch claim';
      END IF;
    ELSIF evidence_kind IS DISTINCT FROM 'RECONCILE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'post-submit state changes require reconciliation evidence';
    END IF;
  END IF;

  IF NEW."broker_action_id" IS NOT NULL THEN
    SELECT
      action."order_id",
      action."action_kind"::TEXT,
      action."original_broker_order_id",
      action."broker_status_raw"
    INTO
      action_order_id,
      action_kind,
      action_original_broker_order_id,
      action_broker_status_raw
    FROM public."broker_order_action" AS action
    WHERE action."id" = NEW."broker_action_id";

    IF NOT FOUND
      OR action_order_id IS DISTINCT FROM NEW."order_id"
      OR action_kind IS DISTINCT FROM 'CANCEL'
      OR action_broker_status_raw IS DISTINCT FROM 'REQUEST_ACCEPTED'
      OR NEW."normalized_state"::TEXT <> 'CANCELED'
      OR NEW."broker_order_id" IS DISTINCT FROM action_original_broker_order_id
      OR NEW."broker_response_evidence_id" IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'CANCELED may reference only an accepted CANCEL child action plus final broker evidence';
    END IF;
  END IF;

  SELECT history."broker_order_id"
  INTO known_broker_order_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
    AND history."broker_order_id" IS NOT NULL
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT reservation."reserved_gross_minor"
  INTO reservation_reserved
  FROM public."daily_trade_reservation" AS reservation
  WHERE reservation."order_id" = NEW."order_id";

  IF NOT FOUND
    OR NEW."filled_quantity" < previous_filled_quantity
    OR NEW."filled_quantity" > order_quantity
    OR NEW."filled_gross_notional_minor" < previous_filled_gross
    OR NEW."filled_gross_notional_minor" > reservation_reserved
    OR NEW."fee_minor" < previous_fee
    OR NEW."occurred_at" < previous_occurred_at
    OR (known_broker_order_id IS NOT NULL AND NEW."broker_order_id" IS DISTINCT FROM known_broker_order_id)
    OR ((NEW."filled_quantity" = 0) IS DISTINCT FROM (NEW."filled_gross_notional_minor" = 0))
    OR (
      NEW."normalized_state"::TEXT = 'PARTIAL_FILLED'
      AND (NEW."filled_quantity" <= 0 OR NEW."filled_quantity" >= order_quantity)
    )
    OR (NEW."normalized_state"::TEXT = 'FILLED' AND NEW."filled_quantity" <> order_quantity)
    OR (
      NEW."normalized_state"::TEXT IN ('CANCELED', 'REJECTED')
      AND NEW."filled_quantity" >= order_quantity
    )
    OR (
      NEW."normalized_state"::TEXT = 'UNKNOWN_BLOCKED'
      AND (
        NEW."filled_quantity" <> previous_filled_quantity
        OR NEW."filled_gross_notional_minor" <> previous_filled_gross
        OR NEW."fee_minor" <> previous_fee
      )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order state event violates monotonic fill, broker ID, fee or time invariants';
  END IF;

  IF previous_state = 'PARTIAL_FILLED'
    AND NEW."normalized_state"::TEXT = 'PARTIAL_FILLED'
    AND NEW."filled_quantity" = previous_filled_quantity
    AND NEW."filled_gross_notional_minor" = previous_filled_gross THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'repeated PARTIAL_FILLED must add a fill';
  END IF;

  IF previous_state = 'UNKNOWN_BLOCKED' THEN
    IF NEW."actor" <> 'OPERATOR'
      OR NEW."broker_response_evidence_id" IS NULL
      OR evidence_kind IS DISTINCT FROM 'RECONCILE' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'UNKNOWN_BLOCKED recovery requires OPERATOR and exact reconciliation evidence';
    END IF;
  ELSIF NEW."actor" = 'OPERATOR' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'OPERATOR actor is reserved for UNKNOWN_BLOCKED recovery';
  END IF;

  IF order_mode = 'LIVE'
    AND NEW."normalized_state"::TEXT IN (
      'PENDING', 'PARTIAL_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'UNKNOWN', 'UNKNOWN_BLOCKED'
    )
    AND NEW."broker_response_evidence_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'every LIVE broker state requires append-only validated response evidence';
  END IF;

  IF order_mode = 'PAPER'
    AND (
      NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'PAPER state events must keep broker fields empty and store simulator evidence in detail';
  END IF;

  IF previous_state = 'PLANNED' AND NEW."normalized_state"::TEXT = 'SUBMITTING' THEN
    IF NEW."actor" <> 'EXECUTOR' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PLANNED to SUBMITTING requires EXECUTOR actor';
    END IF;

    IF order_mode = 'LIVE' THEN
      IF NEW."manual_approval_id" IS NULL OR NEW."submission_authorization_id" IS NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'LIVE SUBMITTING requires its atomic submission authorization and consumed approval';
      END IF;

      SELECT
        auth."order_id",
        auth."approval_id",
        auth."prepared_at",
        auth."expires_at"
      INTO
        authorization_order_id,
        authorization_approval_id,
        authorization_prepared_at,
        authorization_expires_at
      FROM public."order_submission_authorization" AS auth
      WHERE auth."id" = NEW."submission_authorization_id";

      SELECT
        approval."plan_order_id",
        approval."account_id",
        approval."consumed_at",
        approval."consumed_by_order_id"
      INTO
        approval_plan_order_id,
        approval_account_id,
        approval_consumed_at,
        approval_consumed_by
      FROM public."manual_order_approval" AS approval
      WHERE approval."id" = NEW."manual_approval_id";

      IF authorization_order_id IS DISTINCT FROM NEW."order_id"
        OR authorization_approval_id IS DISTINCT FROM NEW."manual_approval_id"
        OR authorization_prepared_at IS DISTINCT FROM NEW."occurred_at"
        OR authorization_expires_at <= pg_catalog.statement_timestamp()
        OR approval_plan_order_id IS DISTINCT FROM order_plan_order_id
        OR approval_account_id IS DISTINCT FROM order_account_id
        OR approval_consumed_at IS DISTINCT FROM authorization_prepared_at
        OR approval_consumed_by IS DISTINCT FROM NEW."order_id" THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'LIVE SUBMITTING must be created by the exact fresh authorization preparation transaction';
      END IF;
    ELSIF NEW."manual_approval_id" IS NOT NULL OR NEW."submission_authorization_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PAPER submission must not consume LIVE authorization state';
    END IF;
  ELSIF NEW."manual_approval_id" IS NOT NULL OR NEW."submission_authorization_id" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'submission authorization and approval only belong to PLANNED to SUBMITTING';
  END IF;

  UPDATE public."daily_trade_reservation"
  SET
    "filled_gross_minor" = NEW."filled_gross_notional_minor",
    "released_gross_minor" = CASE
      WHEN NEW."normalized_state"::TEXT IN ('FILLED', 'CANCELED', 'REJECTED')
        THEN "reserved_gross_minor" - NEW."filled_gross_notional_minor"
      ELSE "released_gross_minor"
    END,
    "updated_at" = pg_catalog.statement_timestamp()
  WHERE "order_id" = NEW."order_id";

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.initialize_rebalance_plan_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  INSERT INTO public."rebalance_plan_version" (
    "plan_id",
    "version",
    "phase",
    "snapshot_id",
    "target_config_version_id",
    "mode",
    "status",
    "canonical_version",
    "plan_hash",
    "canonical_content",
    "created_at"
  ) VALUES (
    NEW."id",
    1,
    'INITIAL',
    NEW."snapshot_id",
    NEW."target_config_version_id",
    NEW."mode",
    NEW."status",
    NEW."canonical_version",
    NEW."plan_hash",
    NEW."canonical_content",
    NEW."created_at"
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_rebalance_plan_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  plan_snapshot_id UUID;
  plan_target_config_version_id UUID;
  plan_mode TEXT;
  plan_status TEXT;
  plan_canonical_version TEXT;
  plan_hash CHAR(64);
  plan_canonical_content TEXT;
  run_account_id UUID;
  run_status TEXT;
  latest_version INTEGER;
  latest_snapshot_id UUID;
  snapshot_account_id UUID;
  snapshot_validation_status TEXT;
  snapshot_observed_at TIMESTAMPTZ;
  target_account_id UUID;
  target_status TEXT;
  previous_order_count BIGINT;
  previous_non_sell_count BIGINT;
  previous_unresolved_count BIGINT;
  previous_terminal_at TIMESTAMPTZ;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan versions are append-only';
  END IF;

  SELECT
    plan."snapshot_id",
    plan."target_config_version_id",
    plan."mode"::TEXT,
    plan."status"::TEXT,
    plan."canonical_version",
    plan."plan_hash",
    plan."canonical_content",
    run."account_id",
    run."status"::TEXT
  INTO
    plan_snapshot_id,
    plan_target_config_version_id,
    plan_mode,
    plan_status,
    plan_canonical_version,
    plan_hash,
    plan_canonical_content,
    run_account_id,
    run_status
  FROM public."rebalance_plan" AS plan
  JOIN public."rebalance_run" AS run
    ON run."id" = plan."run_id"
  WHERE plan."id" = NEW."plan_id"
  FOR UPDATE OF run;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'rebalance plan version requires an existing plan';
  END IF;

  NEW."created_at" := pg_catalog.statement_timestamp();
  IF NEW."version" = 1 THEN
    IF pg_catalog.pg_trigger_depth() < 2
      OR NEW."phase" IS DISTINCT FROM 'INITIAL'
      OR NEW."snapshot_id" IS DISTINCT FROM plan_snapshot_id
      OR NEW."target_config_version_id" IS DISTINCT FROM plan_target_config_version_id
      OR NEW."mode"::TEXT IS DISTINCT FROM plan_mode
      OR NEW."status"::TEXT IS DISTINCT FROM plan_status
      OR NEW."canonical_version" IS DISTINCT FROM plan_canonical_version
      OR NEW."plan_hash" IS DISTINCT FROM plan_hash
      OR NEW."canonical_content" IS DISTINCT FROM plan_canonical_content THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'plan version 1 must be initialized from its sealed plan';
    END IF;
    RETURN NEW;
  END IF;

  SELECT MAX(version."version")
  INTO latest_version
  FROM public."rebalance_plan_version" AS version
  WHERE version."plan_id" = NEW."plan_id";

  SELECT
    snapshot."account_id",
    snapshot."validation_status"::TEXT,
    snapshot."observed_at",
    target."status"::TEXT,
    config."account_id"
  INTO
    snapshot_account_id,
    snapshot_validation_status,
    snapshot_observed_at,
    target_status,
    target_account_id
  FROM public."portfolio_snapshot" AS snapshot
  JOIN public."target_config_version" AS target
    ON target."id" = NEW."target_config_version_id"
  JOIN public."target_config" AS config
    ON config."id" = target."config_id"
  WHERE snapshot."id" = NEW."snapshot_id";

  SELECT snapshot."id"
  INTO latest_snapshot_id
  FROM public."portfolio_snapshot" AS snapshot
  WHERE snapshot."account_id" = run_account_id
  ORDER BY snapshot."observed_at" DESC, snapshot."persisted_at" DESC, snapshot."id" DESC
  LIMIT 1;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE plan_order."side" <> 'SELL'),
    COUNT(*) FILTER (
      WHERE current_state."normalized_state" IS NULL
        OR current_state."normalized_state"::TEXT NOT IN ('FILLED', 'CANCELED', 'REJECTED')
    ),
    MAX(current_state."occurred_at")
  INTO
    previous_order_count,
    previous_non_sell_count,
    previous_unresolved_count,
    previous_terminal_at
  FROM public."rebalance_plan_order" AS plan_order
  LEFT JOIN public."order_ledger" AS ledger
    ON ledger."plan_order_id" = plan_order."id"
  LEFT JOIN public."order_ledger_current_state" AS current_state
    ON current_state."order_id" = ledger."id"
  WHERE plan_order."plan_id" = NEW."plan_id"
    AND plan_order."plan_version" = latest_version;

  IF latest_version IS DISTINCT FROM 1
    OR NEW."version" <> 2
    OR NEW."phase" IS DISTINCT FROM 'BUY'
    OR run_status IS DISTINCT FROM 'PLANNED'
    OR plan_mode IS DISTINCT FROM NEW."mode"::TEXT
    OR NEW."status"::TEXT IS DISTINCT FROM 'PLANNED'
    OR snapshot_account_id IS DISTINCT FROM run_account_id
    OR snapshot_validation_status IS DISTINCT FROM 'VERIFIED'
    OR target_status IS DISTINCT FROM 'ACTIVE'
    OR target_account_id IS DISTINCT FROM run_account_id
    OR latest_snapshot_id IS DISTINCT FROM NEW."snapshot_id"
    OR snapshot_observed_at <= previous_terminal_at
    OR previous_order_count = 0
    OR previous_non_sell_count <> 0
    OR previous_unresolved_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Phase B version 2 requires a refreshed verified snapshot after all Phase A SELL orders are terminal';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_rebalance_plan_order() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  version_status TEXT;
  version_phase TEXT;
  run_status TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'rebalance plan order is append-only';
  END IF;

  SELECT version."status"::TEXT, version."phase", run."status"::TEXT
  INTO version_status, version_phase, run_status
  FROM public."rebalance_plan_version" AS version
  JOIN public."rebalance_plan" AS plan
    ON plan."id" = version."plan_id"
  JOIN public."rebalance_run" AS run
    ON run."id" = plan."run_id"
  WHERE version."plan_id" = NEW."plan_id"
    AND version."version" = NEW."plan_version"
  FOR UPDATE OF run;

  IF NOT FOUND
    OR version_status IS DISTINCT FROM 'PLANNED'
    OR (NEW."plan_version" = 1 AND run_status IS DISTINCT FROM 'RUNNING')
    OR (NEW."plan_version" = 2 AND run_status IS DISTINCT FROM 'PLANNED')
    OR (version_phase IN ('SELL', 'BUY') AND NEW."phase" IS DISTINCT FROM version_phase) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'plan orders must belong to an open matching plan version and saga phase';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.initialize_order_ledger() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  INSERT INTO public."daily_trade_reservation" (
    "daily_trade_limit_id",
    "order_id",
    "reserved_gross_minor"
  ) VALUES (
    NEW."daily_trade_limit_id",
    NEW."id",
    NEW."reserved_gross_minor"
  );

  INSERT INTO public."order_state_history" (
    "order_id",
    "sequence",
    "normalized_state",
    "actor",
    "detail",
    "occurred_at"
  ) VALUES (
    NEW."id",
    0,
    'PLANNED',
    'EXECUTOR',
    pg_catalog.jsonb_build_object('source', 'ORDER_LEDGER_INSERT'),
    NEW."created_at"
  );

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_order_ledger_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'order ledger and risk audit tables cannot be truncated';
END;
$$;

CREATE TRIGGER daily_trade_limit_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."daily_trade_limit"
FOR EACH ROW EXECUTE FUNCTION public.guard_daily_trade_limit();

CREATE TRIGGER rebalance_plan_initialize_version
AFTER INSERT ON public."rebalance_plan"
FOR EACH ROW EXECUTE FUNCTION public.initialize_rebalance_plan_version();

CREATE TRIGGER rebalance_plan_version_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."rebalance_plan_version"
FOR EACH ROW EXECUTE FUNCTION public.guard_rebalance_plan_version();

CREATE TRIGGER live_promotion_event_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."live_promotion_event"
FOR EACH ROW EXECUTE FUNCTION public.guard_live_promotion_event();

CREATE TRIGGER execution_risk_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."execution_risk_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_execution_risk_evidence();

CREATE TRIGGER pre_submit_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."pre_submit_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_pre_submit_evidence();

CREATE TRIGGER order_ledger_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_ledger"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_ledger();

CREATE TRIGGER order_ledger_initialize
AFTER INSERT ON public."order_ledger"
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_ledger();

CREATE TRIGGER order_state_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_state_history"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_state_history();

CREATE TRIGGER broker_order_action_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."broker_order_action"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_order_action();

CREATE TRIGGER broker_order_response_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."broker_order_response_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_order_response_evidence();

CREATE TRIGGER daily_trade_reservation_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."daily_trade_reservation"
FOR EACH ROW EXECUTE FUNCTION public.guard_daily_trade_reservation();

CREATE TRIGGER order_submission_authorization_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_submission_authorization"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_submission_authorization();

CREATE TRIGGER order_submission_authorization_initialize
AFTER INSERT ON public."order_submission_authorization"
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_submission_authorization();

CREATE TRIGGER order_dispatch_claim_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_dispatch_claim"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_dispatch_claim();

CREATE TRIGGER manual_order_approval_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."manual_order_approval"
FOR EACH ROW EXECUTE FUNCTION public.guard_manual_order_approval();

CREATE TRIGGER kill_switch_event_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."kill_switch_event"
FOR EACH ROW EXECUTE FUNCTION public.guard_kill_switch_event();

CREATE TRIGGER daily_trade_limit_truncate_guard
BEFORE TRUNCATE ON public."daily_trade_limit"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER rebalance_plan_version_truncate_guard
BEFORE TRUNCATE ON public."rebalance_plan_version"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER live_promotion_event_truncate_guard
BEFORE TRUNCATE ON public."live_promotion_event"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER execution_risk_evidence_truncate_guard
BEFORE TRUNCATE ON public."execution_risk_evidence"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER pre_submit_evidence_truncate_guard
BEFORE TRUNCATE ON public."pre_submit_evidence"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_ledger_truncate_guard
BEFORE TRUNCATE ON public."order_ledger"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_state_history_truncate_guard
BEFORE TRUNCATE ON public."order_state_history"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER broker_order_action_truncate_guard
BEFORE TRUNCATE ON public."broker_order_action"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER broker_order_response_evidence_truncate_guard
BEFORE TRUNCATE ON public."broker_order_response_evidence"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER daily_trade_reservation_truncate_guard
BEFORE TRUNCATE ON public."daily_trade_reservation"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_submission_authorization_truncate_guard
BEFORE TRUNCATE ON public."order_submission_authorization"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_dispatch_claim_truncate_guard
BEFORE TRUNCATE ON public."order_dispatch_claim"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER manual_order_approval_truncate_guard
BEFORE TRUNCATE ON public."manual_order_approval"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER kill_switch_event_truncate_guard
BEFORE TRUNCATE ON public."kill_switch_event"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

ALTER TABLE public."daily_trade_limit" ENABLE ALWAYS TRIGGER "daily_trade_limit_guard";
ALTER TABLE public."rebalance_plan" ENABLE ALWAYS TRIGGER "rebalance_plan_initialize_version";
ALTER TABLE public."rebalance_plan_version" ENABLE ALWAYS TRIGGER "rebalance_plan_version_guard";
ALTER TABLE public."live_promotion_event" ENABLE ALWAYS TRIGGER "live_promotion_event_guard";
ALTER TABLE public."execution_risk_evidence" ENABLE ALWAYS TRIGGER "execution_risk_evidence_guard";
ALTER TABLE public."pre_submit_evidence" ENABLE ALWAYS TRIGGER "pre_submit_evidence_guard";
ALTER TABLE public."order_ledger" ENABLE ALWAYS TRIGGER "order_ledger_guard";
ALTER TABLE public."order_ledger" ENABLE ALWAYS TRIGGER "order_ledger_initialize";
ALTER TABLE public."order_state_history" ENABLE ALWAYS TRIGGER "order_state_history_guard";
ALTER TABLE public."broker_order_action" ENABLE ALWAYS TRIGGER "broker_order_action_guard";
ALTER TABLE public."broker_order_response_evidence" ENABLE ALWAYS TRIGGER "broker_order_response_evidence_guard";
ALTER TABLE public."daily_trade_reservation" ENABLE ALWAYS TRIGGER "daily_trade_reservation_guard";
ALTER TABLE public."order_submission_authorization" ENABLE ALWAYS TRIGGER "order_submission_authorization_guard";
ALTER TABLE public."order_submission_authorization" ENABLE ALWAYS TRIGGER "order_submission_authorization_initialize";
ALTER TABLE public."order_dispatch_claim" ENABLE ALWAYS TRIGGER "order_dispatch_claim_guard";
ALTER TABLE public."manual_order_approval" ENABLE ALWAYS TRIGGER "manual_order_approval_guard";
ALTER TABLE public."kill_switch_event" ENABLE ALWAYS TRIGGER "kill_switch_event_guard";
ALTER TABLE public."daily_trade_limit" ENABLE ALWAYS TRIGGER "daily_trade_limit_truncate_guard";
ALTER TABLE public."rebalance_plan_version" ENABLE ALWAYS TRIGGER "rebalance_plan_version_truncate_guard";
ALTER TABLE public."live_promotion_event" ENABLE ALWAYS TRIGGER "live_promotion_event_truncate_guard";
ALTER TABLE public."execution_risk_evidence" ENABLE ALWAYS TRIGGER "execution_risk_evidence_truncate_guard";
ALTER TABLE public."pre_submit_evidence" ENABLE ALWAYS TRIGGER "pre_submit_evidence_truncate_guard";
ALTER TABLE public."order_ledger" ENABLE ALWAYS TRIGGER "order_ledger_truncate_guard";
ALTER TABLE public."order_state_history" ENABLE ALWAYS TRIGGER "order_state_history_truncate_guard";
ALTER TABLE public."broker_order_action" ENABLE ALWAYS TRIGGER "broker_order_action_truncate_guard";
ALTER TABLE public."broker_order_response_evidence" ENABLE ALWAYS TRIGGER "broker_order_response_evidence_truncate_guard";
ALTER TABLE public."daily_trade_reservation" ENABLE ALWAYS TRIGGER "daily_trade_reservation_truncate_guard";
ALTER TABLE public."order_submission_authorization" ENABLE ALWAYS TRIGGER "order_submission_authorization_truncate_guard";
ALTER TABLE public."order_dispatch_claim" ENABLE ALWAYS TRIGGER "order_dispatch_claim_truncate_guard";
ALTER TABLE public."manual_order_approval" ENABLE ALWAYS TRIGGER "manual_order_approval_truncate_guard";
ALTER TABLE public."kill_switch_event" ENABLE ALWAYS TRIGGER "kill_switch_event_truncate_guard";

CREATE VIEW public."order_ledger_current_state"
WITH (security_barrier = true)
AS
SELECT
  ledger."id" AS "order_id",
  ledger."account_id",
  ledger."mode",
  ledger."logical_order_id",
  ledger."client_order_id",
  history."sequence",
  history."normalized_state",
  history."actor",
  history."broker_status_raw",
  history."broker_order_id",
  history."broker_action_id",
  action."broker_action_order_id",
  history."broker_response_evidence_id",
  history."submission_authorization_id",
  evidence."dispatch_claim_id",
  evidence."request_id" AS "broker_response_request_id",
  evidence."http_status" AS "broker_response_http_status",
  evidence."write_outcome" AS "broker_response_write_outcome",
  evidence."validated_normalized_state" AS "broker_response_validated_state",
  history."filled_quantity",
  history."filled_gross_notional_minor",
  history."fee_minor",
  history."occurred_at"
FROM public."order_ledger" AS ledger
JOIN LATERAL (
  SELECT event.*
  FROM public."order_state_history" AS event
  WHERE event."order_id" = ledger."id"
  ORDER BY event."sequence" DESC
  LIMIT 1
) AS history ON TRUE
LEFT JOIN public."broker_order_action" AS action
  ON action."id" = history."broker_action_id"
LEFT JOIN public."broker_order_response_evidence" AS evidence
  ON evidence."id" = history."broker_response_evidence_id";
