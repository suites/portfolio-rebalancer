CREATE TABLE public."order_non_dispatch_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_authorization_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "logical_order_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor" TEXT NOT NULL,
  "safe_reason_code" TEXT NOT NULL DEFAULT 'AUTHORIZATION_NOT_DISPATCHED',
  "authorization_preparation_digest" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "authorized_request_digest" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "canonical_proof" TEXT NOT NULL DEFAULT '{}',
  "proof_sha256" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_non_dispatch_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_non_dispatch_evidence_content_check" CHECK (
    BTRIM("actor") <> ''
    AND "safe_reason_code" = 'AUTHORIZATION_NOT_DISPATCHED'
    AND "authorization_preparation_digest" ~ '^[0-9a-f]{64}$'
    AND "authorized_request_digest" ~ '^[0-9a-f]{64}$'
    AND BTRIM("canonical_proof") <> ''
    AND "proof_sha256" ~ '^[0-9a-f]{64}$'
    AND "proof_sha256" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_proof", 'UTF8')),
      'hex'
    )
    AND "created_at" = "recorded_at"
  )
);

CREATE UNIQUE INDEX "order_non_dispatch_evidence_submission_authorization_id_key"
ON public."order_non_dispatch_evidence"("submission_authorization_id");

CREATE UNIQUE INDEX "order_non_dispatch_evidence_order_id_key"
ON public."order_non_dispatch_evidence"("order_id");

CREATE UNIQUE INDEX "order_non_dispatch_evidence_logical_order_id_key"
ON public."order_non_dispatch_evidence"("logical_order_id");

CREATE INDEX "order_non_dispatch_evidence_recorded_at_idx"
ON public."order_non_dispatch_evidence"("recorded_at" DESC);

ALTER TABLE public."order_non_dispatch_evidence"
ADD CONSTRAINT "order_non_dispatch_evidence_submission_authorization_id_fkey"
FOREIGN KEY ("submission_authorization_id")
REFERENCES public."order_submission_authorization"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_non_dispatch_evidence"
ADD CONSTRAINT "order_non_dispatch_evidence_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD COLUMN "non_dispatch_evidence_id" UUID;

ALTER TABLE public."order_state_history"
DROP CONSTRAINT "order_state_history_optional_text_check";

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_optional_text_check" CHECK (
  "actor" IN ('EXECUTOR', 'RECONCILER', 'OPERATOR', 'RECOVERY')
  AND ("broker_status_raw" IS NULL OR BTRIM("broker_status_raw") <> '')
  AND ("broker_order_id" IS NULL OR BTRIM("broker_order_id") <> '')
  AND ("request_id" IS NULL OR BTRIM("request_id") <> '')
);

CREATE UNIQUE INDEX "order_state_history_non_dispatch_evidence_id_key"
ON public."order_state_history"("non_dispatch_evidence_id");

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_non_dispatch_evidence_id_fkey"
FOREIGN KEY ("non_dispatch_evidence_id")
REFERENCES public."order_non_dispatch_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.guard_order_non_dispatch_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  auth_order_id UUID;
  auth_logical_order_id UUID;
  auth_preparation_digest CHAR(64);
  auth_authorized_request_digest CHAR(64);
  auth_client_order_id CHAR(36);
  linked_mode TEXT;
  latest_state TEXT;
  latest_submission_authorization_id UUID;
  latest_broker_order_id TEXT;
  latest_filled_quantity BIGINT;
  latest_filled_gross BIGINT;
  latest_fee BIGINT;
  dispatch_claim_count BIGINT;
  submit_evidence_count BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'order non-dispatch evidence is append-only';
  END IF;

  SELECT
    auth."order_id",
    auth."logical_order_id",
    auth."canonical_preparation_digest",
    auth."authorized_request_digest",
    auth."client_order_id"
  INTO
    auth_order_id,
    auth_logical_order_id,
    auth_preparation_digest,
    auth_authorized_request_digest,
    auth_client_order_id
  FROM public."order_submission_authorization" AS auth
  WHERE auth."id" = NEW."submission_authorization_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'non-dispatch recovery requires an existing submission authorization';
  END IF;

  SELECT ledger."mode"::TEXT
  INTO linked_mode
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = auth_order_id
  FOR UPDATE;

  SELECT
    history."normalized_state"::TEXT,
    history."submission_authorization_id",
    history."broker_order_id",
    history."filled_quantity",
    history."filled_gross_notional_minor",
    history."fee_minor"
  INTO
    latest_state,
    latest_submission_authorization_id,
    latest_broker_order_id,
    latest_filled_quantity,
    latest_filled_gross,
    latest_fee
  FROM public."order_state_history" AS history
  WHERE history."order_id" = auth_order_id
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT COUNT(*)
  INTO dispatch_claim_count
  FROM public."order_dispatch_claim" AS claim
  WHERE claim."submission_authorization_id" = NEW."submission_authorization_id"
    OR claim."order_id" = auth_order_id;

  SELECT COUNT(*)
  INTO submit_evidence_count
  FROM public."broker_order_response_evidence" AS evidence
  WHERE evidence."order_id" = auth_order_id
    AND evidence."evidence_kind"::TEXT = 'SUBMIT';

  IF auth_order_id IS DISTINCT FROM NEW."order_id"
    OR linked_mode IS DISTINCT FROM 'LIVE'
    OR latest_state IS DISTINCT FROM 'SUBMITTING'
    OR latest_submission_authorization_id IS DISTINCT FROM NEW."submission_authorization_id"
    OR latest_broker_order_id IS NOT NULL
    OR latest_filled_quantity <> 0
    OR latest_filled_gross <> 0
    OR latest_fee <> 0
    OR dispatch_claim_count <> 0
    OR submit_evidence_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'non-dispatch recovery requires the exact current LIVE SUBMITTING authorization with no dispatch claim or broker submission evidence';
  END IF;

  NEW."logical_order_id" := auth_logical_order_id;
  NEW."safe_reason_code" := 'AUTHORIZATION_NOT_DISPATCHED';
  NEW."authorization_preparation_digest" := auth_preparation_digest;
  NEW."authorized_request_digest" := auth_authorized_request_digest;
  NEW."recorded_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."recorded_at";
  canonical_payload := pg_catalog.jsonb_build_object(
    'version', 'ORDER_NON_DISPATCH_EVIDENCE_V1',
    'evidenceId', NEW."id"::TEXT,
    'submissionAuthorizationId', NEW."submission_authorization_id"::TEXT,
    'orderId', NEW."order_id"::TEXT,
    'logicalOrderId', auth_logical_order_id::TEXT,
    'clientOrderId', auth_client_order_id::TEXT,
    'authorizationPreparationDigest', auth_preparation_digest::TEXT,
    'authorizedRequestDigest', auth_authorized_request_digest::TEXT,
    'actor', NEW."actor",
    'safeReasonCode', 'AUTHORIZATION_NOT_DISPATCHED',
    'recordedAt', pg_catalog.to_char(
      NEW."recorded_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
  NEW."canonical_proof" := canonical_payload::TEXT;
  NEW."proof_sha256" := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW."canonical_proof", 'UTF8')),
    'hex'
  );

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.initialize_order_non_dispatch_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  latest_sequence INTEGER;
BEGIN
  SELECT history."sequence"
  INTO latest_sequence
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  INSERT INTO public."order_state_history" (
    "order_id",
    "sequence",
    "normalized_state",
    "actor",
    "non_dispatch_evidence_id",
    "filled_quantity",
    "filled_gross_notional_minor",
    "fee_minor",
    "detail",
    "occurred_at"
  ) VALUES (
    NEW."order_id",
    latest_sequence + 1,
    'REJECTED',
    'RECOVERY',
    NEW."id",
    0,
    0,
    0,
    pg_catalog.jsonb_build_object(
      'reason', NEW."safe_reason_code",
      'nonDispatchEvidenceId', NEW."id"::TEXT,
      'submissionAuthorizationId', NEW."submission_authorization_id"::TEXT,
      'proofSha256', NEW."proof_sha256"::TEXT
    ),
    NEW."recorded_at"
  );

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_dispatch_after_non_dispatch() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."order_submission_authorization" AS submission_auth
  WHERE submission_auth."id" = NEW."submission_authorization_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'dispatch requires an existing submission authorization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."order_non_dispatch_evidence" AS evidence
    WHERE evidence."submission_authorization_id" = NEW."submission_authorization_id"
      OR evidence."order_id" = NEW."order_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a non-dispatch recovery proof permanently forbids later broker dispatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_submit_evidence_after_non_dispatch() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF NEW."evidence_kind"::TEXT = 'SUBMIT'
    AND EXISTS (
      SELECT 1
      FROM public."order_non_dispatch_evidence" AS evidence
      WHERE evidence."order_id" = NEW."order_id"
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a non-dispatch recovery proof permanently forbids later broker submission evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_order_state_history() RETURNS trigger
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
  non_dispatch_order_id UUID;
  non_dispatch_authorization_id UUID;
  non_dispatch_recorded_at TIMESTAMPTZ;
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
      OR NEW."non_dispatch_evidence_id" IS NOT NULL
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

  IF NEW."non_dispatch_evidence_id" IS NOT NULL THEN
    SELECT
      evidence."order_id",
      evidence."submission_authorization_id",
      evidence."recorded_at"
    INTO
      non_dispatch_order_id,
      non_dispatch_authorization_id,
      non_dispatch_recorded_at
    FROM public."order_non_dispatch_evidence" AS evidence
    WHERE evidence."id" = NEW."non_dispatch_evidence_id";

    IF NOT FOUND
      OR previous_state IS DISTINCT FROM 'SUBMITTING'
      OR NEW."normalized_state"::TEXT IS DISTINCT FROM 'REJECTED'
      OR NEW."actor" IS DISTINCT FROM 'RECOVERY'
      OR non_dispatch_order_id IS DISTINCT FROM NEW."order_id"
      OR non_dispatch_authorization_id IS DISTINCT FROM previous_submission_authorization_id
      OR non_dispatch_recorded_at IS DISTINCT FROM NEW."occurred_at"
      OR NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
      OR NEW."manual_approval_id" IS NOT NULL
      OR NEW."submission_authorization_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'non-dispatch recovery must atomically close the exact SUBMITTING authorization without broker evidence';
    END IF;
  ELSIF NEW."actor" = 'RECOVERY' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'RECOVERY actor is reserved for immutable non-dispatch evidence';
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
    AND NEW."broker_response_evidence_id" IS NULL
    AND NEW."non_dispatch_evidence_id" IS NULL THEN
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
      OR NEW."non_dispatch_evidence_id" IS NOT NULL
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

CREATE TRIGGER order_non_dispatch_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_non_dispatch_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_non_dispatch_evidence();

CREATE TRIGGER order_non_dispatch_evidence_initialize
AFTER INSERT ON public."order_non_dispatch_evidence"
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_non_dispatch_evidence();

CREATE TRIGGER order_dispatch_claim_00_non_dispatch_guard
BEFORE INSERT ON public."order_dispatch_claim"
FOR EACH ROW EXECUTE FUNCTION public.guard_dispatch_after_non_dispatch();

CREATE TRIGGER broker_order_response_00_non_dispatch_guard
BEFORE INSERT ON public."broker_order_response_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_submit_evidence_after_non_dispatch();

CREATE TRIGGER order_non_dispatch_evidence_truncate_guard
BEFORE TRUNCATE ON public."order_non_dispatch_evidence"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

ALTER TABLE public."order_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_non_dispatch_evidence_guard;

ALTER TABLE public."order_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_non_dispatch_evidence_initialize;

ALTER TABLE public."order_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_non_dispatch_evidence_truncate_guard;

ALTER TABLE public."order_dispatch_claim"
ENABLE ALWAYS TRIGGER order_dispatch_claim_00_non_dispatch_guard;

ALTER TABLE public."broker_order_response_evidence"
ENABLE ALWAYS TRIGGER broker_order_response_00_non_dispatch_guard;

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
  evidence."cancel_dispatch_claim_id" AS "broker_response_cancel_dispatch_claim_id",
  history."non_dispatch_evidence_id",
  non_dispatch."safe_reason_code" AS "non_dispatch_safe_reason_code",
  non_dispatch."proof_sha256" AS "non_dispatch_proof_sha256"
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
  ON evidence."id" = history."broker_response_evidence_id"
LEFT JOIN public."order_non_dispatch_evidence" AS non_dispatch
  ON non_dispatch."id" = history."non_dispatch_evidence_id";
