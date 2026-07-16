CREATE TABLE public."cancel_operator_authorization" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "authorization_id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "confirmation_version" TEXT NOT NULL,
  "canonical_content" TEXT NOT NULL,
  "canonical_request_digest" CHAR(64) NOT NULL,
  "authorization_digest" CHAR(64) NOT NULL,
  "authorized_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cancel_operator_authorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cancel_operator_authorization_content_check" CHECK (
    BTRIM("authorization_id") <> ''
    AND BTRIM("actor") <> ''
    AND "action" = 'CANCEL'
    AND "confirmation_version" = 'CANCEL_ORDER_CONFIRMATION_V1'
    AND BTRIM("canonical_content") <> ''
    AND "canonical_request_digest" ~ '^[0-9a-f]{64}$'
    AND "authorization_digest" ~ '^[0-9a-f]{64}$'
    AND "authorization_digest" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
      'hex'
    )
    AND "expires_at" > "authorized_at"
    AND "expires_at" <= "authorized_at" + INTERVAL '30 seconds'
    AND ("consumed_at" IS NULL OR (
      "consumed_at" >= "authorized_at"
      AND "consumed_at" < "expires_at"
    ))
    AND "created_at" >= "authorized_at"
  )
);

CREATE UNIQUE INDEX "cancel_operator_authorization_authorization_id_key"
ON public."cancel_operator_authorization"("authorization_id");

CREATE UNIQUE INDEX "cancel_operator_authorization_digest_key"
ON public."cancel_operator_authorization"("authorization_digest");

CREATE INDEX "cancel_operator_authorization_order_id_expires_at_idx"
ON public."cancel_operator_authorization"("order_id", "expires_at");

ALTER TABLE public."cancel_operator_authorization"
ADD CONSTRAINT "cancel_operator_authorization_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_cancel_dispatch_claim" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cancel_operator_authorization_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "authorization_id" TEXT NOT NULL,
  "plan_id" UUID NOT NULL,
  "plan_version" INTEGER NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "logical_order_id" UUID NOT NULL,
  "canonical_request" TEXT NOT NULL,
  "claim_envelope_digest" CHAR(64) NOT NULL,
  "authorized_request_digest" CHAR(64) NOT NULL,
  "client_order_id" CHAR(36) NOT NULL,
  "broker_account_reference_hmac" CHAR(64) NOT NULL,
  "broker_order_id" TEXT NOT NULL,
  "ledger_state" public."OrderLedgerState" NOT NULL,
  "operator_authorization_digest" CHAR(64) NOT NULL,
  "authorization_issued_at" TIMESTAMPTZ(6) NOT NULL,
  "authorization_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "intent_audited_at" TIMESTAMPTZ(6) NOT NULL,
  "dispatch_started_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "order_cancel_dispatch_claim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_cancel_dispatch_claim_content_check" CHECK (
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
    AND BTRIM("broker_order_id") <> ''
    AND "ledger_state" IN ('PENDING', 'PARTIAL_FILLED')
    AND "operator_authorization_digest" ~ '^[0-9a-f]{64}$'
    AND "authorization_expires_at" > "authorization_issued_at"
    AND "authorization_expires_at" <= "authorization_issued_at" + INTERVAL '30 seconds'
    AND "claimed_at" >= "authorization_issued_at"
    AND "claimed_at" < "authorization_expires_at"
    AND "intent_audited_at" >= "claimed_at"
    AND "dispatch_started_at" >= "intent_audited_at"
    AND "dispatch_started_at" < "authorization_expires_at"
  )
);

CREATE UNIQUE INDEX "order_cancel_dispatch_claim_operator_authorization_id_key"
ON public."order_cancel_dispatch_claim"("cancel_operator_authorization_id");

CREATE UNIQUE INDEX "order_cancel_dispatch_claim_order_id_key"
ON public."order_cancel_dispatch_claim"("order_id");

CREATE UNIQUE INDEX "order_cancel_dispatch_claim_authorization_id_key"
ON public."order_cancel_dispatch_claim"("authorization_id");

CREATE INDEX "order_cancel_dispatch_claim_order_id_claimed_at_idx"
ON public."order_cancel_dispatch_claim"("order_id", "claimed_at" DESC);

CREATE INDEX "order_cancel_dispatch_claim_plan_version_order_idx"
ON public."order_cancel_dispatch_claim"("plan_id", "plan_version", "plan_order_id");

CREATE INDEX "order_cancel_dispatch_claim_authorization_expires_at_idx"
ON public."order_cancel_dispatch_claim"("authorization_expires_at");

ALTER TABLE public."order_cancel_dispatch_claim"
ADD CONSTRAINT "order_cancel_dispatch_claim_operator_authorization_id_fkey"
FOREIGN KEY ("cancel_operator_authorization_id")
REFERENCES public."cancel_operator_authorization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_cancel_dispatch_claim"
ADD CONSTRAINT "order_cancel_dispatch_claim_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."broker_order_action"
ADD COLUMN "cancel_dispatch_claim_id" UUID;

CREATE UNIQUE INDEX "broker_order_action_cancel_dispatch_claim_id_key"
ON public."broker_order_action"("cancel_dispatch_claim_id");

ALTER TABLE public."broker_order_action"
ADD CONSTRAINT "broker_order_action_cancel_dispatch_claim_id_fkey"
FOREIGN KEY ("cancel_dispatch_claim_id")
REFERENCES public."order_cancel_dispatch_claim"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."broker_order_response_evidence"
ADD COLUMN "cancel_dispatch_claim_id" UUID;

CREATE UNIQUE INDEX "broker_order_response_evidence_cancel_dispatch_claim_id_key"
ON public."broker_order_response_evidence"("cancel_dispatch_claim_id");

ALTER TABLE public."broker_order_response_evidence"
ADD CONSTRAINT "broker_order_response_evidence_cancel_dispatch_claim_id_fkey"
FOREIGN KEY ("cancel_dispatch_claim_id")
REFERENCES public."order_cancel_dispatch_claim"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.guard_cancel_operator_authorization() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  linked_plan_id UUID;
  linked_plan_order_id UUID;
  linked_logical_order_id UUID;
  linked_account_id UUID;
  linked_client_order_id CHAR(36);
  linked_mode TEXT;
  linked_state TEXT;
  linked_broker_order_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."created_at" := pg_catalog.statement_timestamp();

    SELECT
      ledger."plan_id",
      ledger."plan_order_id",
      ledger."logical_order_id",
      ledger."account_id",
      ledger."client_order_id",
      ledger."mode"::TEXT
    INTO
      linked_plan_id,
      linked_plan_order_id,
      linked_logical_order_id,
      linked_account_id,
      linked_client_order_id,
      linked_mode
    FROM public."order_ledger" AS ledger
    WHERE ledger."id" = NEW."order_id"
    FOR UPDATE;

    SELECT
      history."normalized_state"::TEXT,
      history."broker_order_id"
    INTO
      linked_state,
      linked_broker_order_id
    FROM public."order_state_history" AS history
    WHERE history."order_id" = NEW."order_id"
    ORDER BY history."sequence" DESC
    LIMIT 1;

    canonical_payload := NEW."canonical_content"::JSONB;
    IF NOT FOUND
      OR linked_mode IS DISTINCT FROM 'LIVE'
      OR linked_state NOT IN ('PENDING', 'PARTIAL_FILLED')
      OR linked_broker_order_id IS NULL
      OR NEW."authorized_at" > pg_catalog.statement_timestamp()
      OR NEW."authorized_at" < pg_catalog.statement_timestamp() - INTERVAL '5 seconds'
      OR NEW."expires_at" <= pg_catalog.statement_timestamp()
      OR NEW."consumed_at" IS NOT NULL
      OR canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
        'version', 'CANCEL_OPERATOR_AUTHORIZATION_V1',
        'authorizationId', NEW."authorization_id",
        'actor', NEW."actor",
        'action', 'CANCEL',
        'orderIdentity', pg_catalog.jsonb_build_object(
          'planId', linked_plan_id::TEXT,
          'planOrderId', linked_plan_order_id::TEXT,
          'logicalOrderId', linked_logical_order_id::TEXT,
          'accountId', linked_account_id::TEXT,
          'clientOrderId', linked_client_order_id::TEXT,
          'brokerOrderId', linked_broker_order_id
        ),
        'canonicalRequestDigest', NEW."canonical_request_digest"::TEXT,
        'authorizedAt', pg_catalog.to_char(
          NEW."authorized_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'expiresAt', pg_catalog.to_char(
          NEW."expires_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'evidenceReference', NEW."id"::TEXT
      ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'cancel operator authorization must seal one current cancelable LIVE order without account secrets';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' OR pg_catalog.pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cancel operator authorization is append-only and can only be consumed by its dispatch claim';
  END IF;

  IF OLD."consumed_at" IS NOT NULL
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."order_id" IS DISTINCT FROM OLD."order_id"
    OR NEW."authorization_id" IS DISTINCT FROM OLD."authorization_id"
    OR NEW."actor" IS DISTINCT FROM OLD."actor"
    OR NEW."action" IS DISTINCT FROM OLD."action"
    OR NEW."confirmation_version" IS DISTINCT FROM OLD."confirmation_version"
    OR NEW."canonical_content" IS DISTINCT FROM OLD."canonical_content"
    OR NEW."canonical_request_digest" IS DISTINCT FROM OLD."canonical_request_digest"
    OR NEW."authorization_digest" IS DISTINCT FROM OLD."authorization_digest"
    OR NEW."authorized_at" IS DISTINCT FROM OLD."authorized_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."consumed_at" IS NULL
    OR NEW."consumed_at" IS DISTINCT FROM pg_catalog.statement_timestamp()
    OR NEW."consumed_at" >= OLD."expires_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cancel operator authorization consumption is immutable and one-time';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_cancel_dispatch_claim() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  operator_order_id UUID;
  operator_authorization_id TEXT;
  operator_request_digest CHAR(64);
  operator_digest CHAR(64);
  operator_authorized_at TIMESTAMPTZ;
  operator_expires_at TIMESTAMPTZ;
  operator_consumed_at TIMESTAMPTZ;
  linked_plan_id UUID;
  linked_plan_version INTEGER;
  linked_plan_order_id UUID;
  linked_logical_order_id UUID;
  linked_account_id UUID;
  linked_client_order_id CHAR(36);
  linked_intent_sha CHAR(64);
  linked_account_hmac CHAR(64);
  linked_mode TEXT;
  linked_state TEXT;
  linked_broker_order_id TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order cancel dispatch claims are append-only';
  END IF;

  NEW."claimed_at" := pg_catalog.statement_timestamp();
  NEW."intent_audited_at" := NEW."claimed_at";
  NEW."dispatch_started_at" := NEW."claimed_at";

  SELECT
    operator_auth."order_id",
    operator_auth."authorization_id",
    operator_auth."canonical_request_digest",
    operator_auth."authorization_digest",
    operator_auth."authorized_at",
    operator_auth."expires_at",
    operator_auth."consumed_at"
  INTO
    operator_order_id,
    operator_authorization_id,
    operator_request_digest,
    operator_digest,
    operator_authorized_at,
    operator_expires_at,
    operator_consumed_at
  FROM public."cancel_operator_authorization" AS operator_auth
  WHERE operator_auth."id" = NEW."cancel_operator_authorization_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'cancel dispatch claim requires an existing operator authorization';
  END IF;

  SELECT
    ledger."plan_id",
    ledger."plan_version",
    ledger."plan_order_id",
    ledger."logical_order_id",
    ledger."account_id",
    ledger."client_order_id",
    ledger."intent_sha256",
    account."external_ref_hmac",
    ledger."mode"::TEXT
  INTO
    linked_plan_id,
    linked_plan_version,
    linked_plan_order_id,
    linked_logical_order_id,
    linked_account_id,
    linked_client_order_id,
    linked_intent_sha,
    linked_account_hmac,
    linked_mode
  FROM public."order_ledger" AS ledger
  JOIN public."broker_account" AS account
    ON account."id" = ledger."account_id"
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE OF ledger;

  SELECT
    history."normalized_state"::TEXT,
    history."broker_order_id"
  INTO
    linked_state,
    linked_broker_order_id
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  IF operator_order_id IS DISTINCT FROM NEW."order_id"
    OR operator_authorization_id IS DISTINCT FROM NEW."authorization_id"
    OR operator_request_digest IS DISTINCT FROM NEW."authorized_request_digest"
    OR operator_digest IS DISTINCT FROM NEW."operator_authorization_digest"
    OR operator_consumed_at IS NOT NULL
    OR operator_expires_at <= NEW."claimed_at"
    OR linked_mode IS DISTINCT FROM 'LIVE'
    OR linked_plan_id IS DISTINCT FROM NEW."plan_id"
    OR linked_plan_version IS DISTINCT FROM NEW."plan_version"
    OR linked_plan_order_id IS DISTINCT FROM NEW."plan_order_id"
    OR linked_logical_order_id IS DISTINCT FROM NEW."logical_order_id"
    OR linked_client_order_id IS DISTINCT FROM NEW."client_order_id"
    OR linked_account_hmac IS DISTINCT FROM NEW."broker_account_reference_hmac"
    OR linked_state IS DISTINCT FROM NEW."ledger_state"::TEXT
    OR linked_state NOT IN ('PENDING', 'PARTIAL_FILLED')
    OR linked_broker_order_id IS DISTINCT FROM NEW."broker_order_id"
    OR NEW."authorization_issued_at" < operator_authorized_at
    OR NEW."authorization_issued_at" > NEW."claimed_at"
    OR NEW."authorization_expires_at" <= NEW."claimed_at"
    OR NEW."authorization_expires_at" > operator_expires_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'cancel dispatch claim must be the first exact audit of one unexpired cancelable LIVE order';
  END IF;

  canonical_payload := NEW."canonical_request"::JSONB;
  IF canonical_payload IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'version', 'ORDER_CANCEL_DISPATCH_CLAIM_V1',
    'cancelDispatchClaimId', NEW."id"::TEXT,
    'cancelOperatorAuthorizationId', NEW."cancel_operator_authorization_id"::TEXT,
    'authorizationId', NEW."authorization_id",
    'planId', NEW."plan_id"::TEXT,
    'planVersion', NEW."plan_version",
    'planOrderId', NEW."plan_order_id"::TEXT,
    'logicalOrderId', NEW."logical_order_id"::TEXT,
    'accountId', linked_account_id::TEXT,
    'clientOrderId', NEW."client_order_id"::TEXT,
    'canonicalIntentSha256', linked_intent_sha::TEXT,
    'authorizedRequestDigest', NEW."authorized_request_digest"::TEXT,
    'brokerAccountReferenceHmac', NEW."broker_account_reference_hmac"::TEXT,
    'brokerOrderId', NEW."broker_order_id",
    'ledgerState', NEW."ledger_state"::TEXT,
    'operatorAuthorizationDigest', NEW."operator_authorization_digest"::TEXT,
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
      MESSAGE = 'cancel dispatch canonical request does not match its immutable claim columns';
  END IF;

  UPDATE public."cancel_operator_authorization"
  SET "consumed_at" = pg_catalog.statement_timestamp()
  WHERE "id" = NEW."cancel_operator_authorization_id";

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_broker_order_action_cancel_dispatch() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  claim_order_id UUID;
  claim_authorization_id TEXT;
  claim_request_digest CHAR(64);
  claim_broker_order_id TEXT;
  claim_dispatch_started_at TIMESTAMPTZ;
BEGIN
  IF NEW."action_kind"::TEXT = 'CANCEL' THEN
    SELECT
      claim."order_id",
      claim."authorization_id",
      claim."authorized_request_digest",
      claim."broker_order_id",
      claim."dispatch_started_at"
    INTO
      claim_order_id,
      claim_authorization_id,
      claim_request_digest,
      claim_broker_order_id,
      claim_dispatch_started_at
    FROM public."order_cancel_dispatch_claim" AS claim
    WHERE claim."id" = NEW."cancel_dispatch_claim_id";

    IF NOT FOUND
      OR claim_order_id IS DISTINCT FROM NEW."order_id"
      OR claim_authorization_id IS DISTINCT FROM NEW."authorization_id"
      OR claim_request_digest IS DISTINCT FROM NEW."canonical_request_digest"
      OR claim_broker_order_id IS DISTINCT FROM NEW."original_broker_order_id"
      OR NEW."observed_at" < claim_dispatch_started_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'accepted CANCEL action must bind its exact one-time pre-dispatch claim';
    END IF;
  ELSIF NEW."cancel_dispatch_claim_id" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'only CANCEL actions may reference a cancel dispatch claim';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_broker_response_cancel_dispatch() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  claim_order_id UUID;
  claim_broker_order_id TEXT;
  claim_dispatch_started_at TIMESTAMPTZ;
BEGIN
  IF NEW."evidence_kind"::TEXT = 'CANCEL_ATTEMPT' THEN
    SELECT
      claim."order_id",
      claim."broker_order_id",
      claim."dispatch_started_at"
    INTO
      claim_order_id,
      claim_broker_order_id,
      claim_dispatch_started_at
    FROM public."order_cancel_dispatch_claim" AS claim
    WHERE claim."id" = NEW."cancel_dispatch_claim_id";

    IF NOT FOUND
      OR claim_order_id IS DISTINCT FROM NEW."order_id"
      OR claim_broker_order_id IS DISTINCT FROM NEW."broker_order_id"
      OR NEW."observed_at" < claim_dispatch_started_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'CANCEL attempt evidence must bind its exact one-time pre-dispatch claim';
    END IF;
  ELSIF NEW."cancel_dispatch_claim_id" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'only CANCEL attempt evidence may reference a cancel dispatch claim';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cancel_operator_authorization_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."cancel_operator_authorization"
FOR EACH ROW EXECUTE FUNCTION public.guard_cancel_operator_authorization();

CREATE TRIGGER order_cancel_dispatch_claim_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_cancel_dispatch_claim"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_cancel_dispatch_claim();

CREATE TRIGGER broker_order_action_cancel_dispatch_guard
BEFORE INSERT ON public."broker_order_action"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_order_action_cancel_dispatch();

CREATE TRIGGER broker_order_response_cancel_dispatch_guard
BEFORE INSERT ON public."broker_order_response_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_response_cancel_dispatch();

CREATE TRIGGER cancel_operator_authorization_truncate_guard
BEFORE TRUNCATE ON public."cancel_operator_authorization"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_cancel_dispatch_claim_truncate_guard
BEFORE TRUNCATE ON public."order_cancel_dispatch_claim"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

ALTER TABLE public."cancel_operator_authorization"
ENABLE ALWAYS TRIGGER cancel_operator_authorization_guard;

ALTER TABLE public."cancel_operator_authorization"
ENABLE ALWAYS TRIGGER cancel_operator_authorization_truncate_guard;

ALTER TABLE public."order_cancel_dispatch_claim"
ENABLE ALWAYS TRIGGER order_cancel_dispatch_claim_guard;

ALTER TABLE public."order_cancel_dispatch_claim"
ENABLE ALWAYS TRIGGER order_cancel_dispatch_claim_truncate_guard;

ALTER TABLE public."broker_order_action"
ENABLE ALWAYS TRIGGER broker_order_action_cancel_dispatch_guard;

ALTER TABLE public."broker_order_response_evidence"
ENABLE ALWAYS TRIGGER broker_order_response_cancel_dispatch_guard;

CREATE OR REPLACE VIEW public."order_ledger_current_state"
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
  history."occurred_at",
  action."cancel_dispatch_claim_id" AS "broker_action_cancel_dispatch_claim_id",
  evidence."cancel_dispatch_claim_id" AS "broker_response_cancel_dispatch_claim_id"
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
