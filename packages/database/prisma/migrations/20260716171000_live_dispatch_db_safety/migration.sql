ALTER TABLE public."pre_submit_evidence"
ADD COLUMN "account_response_validation_id" UUID;

CREATE INDEX "pre_submit_evidence_account_response_validation_id_idx"
ON public."pre_submit_evidence"("account_response_validation_id");

ALTER TABLE public."pre_submit_evidence"
ADD CONSTRAINT "pre_submit_evidence_account_response_validation_id_fkey"
FOREIGN KEY ("account_response_validation_id")
REFERENCES public."broker_response_validation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TABLE public."order_pre_auth_non_dispatch_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "reservation_id" UUID NOT NULL,
  "logical_order_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor" TEXT NOT NULL,
  "safe_reason_code" TEXT NOT NULL DEFAULT 'PRE_AUTHORIZATION_NOT_COMPLETED',
  "reserved_gross_minor" BIGINT NOT NULL DEFAULT 1,
  "canonical_proof" TEXT NOT NULL DEFAULT '{}',
  "proof_sha256" CHAR(64) NOT NULL DEFAULT repeat('0', 64),
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_pre_auth_non_dispatch_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_pre_auth_non_dispatch_evidence_content_check" CHECK (
    BTRIM("actor") <> ''
    AND "safe_reason_code" = 'PRE_AUTHORIZATION_NOT_COMPLETED'
    AND "reserved_gross_minor" > 0
    AND BTRIM("canonical_proof") <> ''
    AND "proof_sha256" ~ '^[0-9a-f]{64}$'
    AND "proof_sha256" = pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to("canonical_proof", 'UTF8')),
      'hex'
    )
    AND "created_at" = "recorded_at"
  )
);

CREATE UNIQUE INDEX "order_pre_auth_non_dispatch_evidence_order_id_key"
ON public."order_pre_auth_non_dispatch_evidence"("order_id");

CREATE UNIQUE INDEX "order_pre_auth_non_dispatch_evidence_reservation_id_key"
ON public."order_pre_auth_non_dispatch_evidence"("reservation_id");

CREATE UNIQUE INDEX "order_pre_auth_non_dispatch_evidence_logical_order_id_key"
ON public."order_pre_auth_non_dispatch_evidence"("logical_order_id");

CREATE INDEX "order_pre_auth_non_dispatch_evidence_recorded_at_idx"
ON public."order_pre_auth_non_dispatch_evidence"("recorded_at" DESC);

ALTER TABLE public."order_pre_auth_non_dispatch_evidence"
ADD CONSTRAINT "order_pre_auth_non_dispatch_evidence_order_id_fkey"
FOREIGN KEY ("order_id")
REFERENCES public."order_ledger"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_pre_auth_non_dispatch_evidence"
ADD CONSTRAINT "order_pre_auth_non_dispatch_evidence_reservation_id_fkey"
FOREIGN KEY ("reservation_id")
REFERENCES public."daily_trade_reservation"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE public."order_state_history"
ADD COLUMN "pre_authorization_non_dispatch_evidence_id" UUID;

CREATE UNIQUE INDEX "order_state_history_pre_auth_non_dispatch_evidence_id_key"
ON public."order_state_history"("pre_authorization_non_dispatch_evidence_id");

ALTER TABLE public."order_state_history"
ADD CONSTRAINT "order_state_history_pre_auth_non_dispatch_evidence_id_fkey"
FOREIGN KEY ("pre_authorization_non_dispatch_evidence_id")
REFERENCES public."order_pre_auth_non_dispatch_evidence"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION public.guard_broker_account_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker account identity cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."broker" IS DISTINCT FROM OLD."broker"
    OR NEW."external_ref_hmac" IS DISTINCT FROM OLD."external_ref_hmac"
    OR NEW."first_seen_at" IS DISTINCT FROM OLD."first_seen_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker account stable identity and first-seen audit time are immutable';
  END IF;

  IF BTRIM(NEW."masked_number") = ''
    OR BTRIM(NEW."account_type_raw") = ''
    OR NEW."last_seen_at" < OLD."last_seen_at"
    OR NEW."last_seen_at" < NEW."first_seen_at" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker account refresh may only advance valid presentation metadata';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.lock_operational_config_activation_account() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  linked_account_id UUID;
BEGIN
  SELECT config."account_id"
  INTO linked_account_id
  FROM public."operational_config" AS config
  WHERE config."id" = NEW."config_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'operational config activation requires an existing account config';
  END IF;

  PERFORM 1
  FROM public."broker_account" AS account
  WHERE account."id" = linked_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'operational config activation account does not exist';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.lock_account_scoped_safety_event() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."broker_account" AS account
  WHERE account."id" = NEW."account_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'account-scoped safety event requires an existing locked broker account';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_pre_submit_account_binding() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  account_hmac CHAR(64);
  account_masked_number TEXT;
  account_type_raw TEXT;
  validation_operation TEXT;
  validation_outcome TEXT;
  validation_body JSONB;
  validation_validated_at TIMESTAMPTZ;
  attempt_operation TEXT;
  attempt_outcome TEXT;
  attempt_http_status INTEGER;
  attempt_completed_at TIMESTAMPTZ;
  attempt_correlation_id UUID;
  matching_account_count BIGINT;
BEGIN
  IF NEW."account_response_validation_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'new pre-submit evidence requires a passed getAccounts account-binding validation';
  END IF;

  SELECT account."external_ref_hmac", account."masked_number", account."account_type_raw"
  INTO account_hmac, account_masked_number, account_type_raw
  FROM public."broker_account" AS account
  WHERE account."id" = NEW."account_id";

  SELECT
    validation."operation_id",
    validation."outcome"::TEXT,
    validation."redacted_body",
    validation."validated_at",
    attempt."operation_id",
    attempt."outcome"::TEXT,
    attempt."http_status",
    attempt."completed_at",
    attempt."correlation_id"
  INTO
    validation_operation,
    validation_outcome,
    validation_body,
    validation_validated_at,
    attempt_operation,
    attempt_outcome,
    attempt_http_status,
    attempt_completed_at,
    attempt_correlation_id
  FROM public."broker_response_validation" AS validation
  JOIN public."broker_request_attempt" AS attempt
    ON attempt."id" = validation."request_attempt_id"
  WHERE validation."id" = NEW."account_response_validation_id";

  IF NOT FOUND
    OR validation_operation IS DISTINCT FROM 'getAccounts'
    OR attempt_operation IS DISTINCT FROM 'getAccounts'
    OR validation_outcome IS DISTINCT FROM 'PASSED'
    OR attempt_outcome IS DISTINCT FROM 'SUCCEEDED'
    OR attempt_http_status NOT BETWEEN 200 AND 299
    OR attempt_correlation_id IS DISTINCT FROM NEW."id"
    OR attempt_completed_at < NEW."evaluated_at" - INTERVAL '30 seconds'
    OR attempt_completed_at > NEW."evaluated_at" + INTERVAL '5 seconds'
    OR validation_validated_at < NEW."evaluated_at" - INTERVAL '30 seconds'
    OR validation_validated_at > NEW."evaluated_at" + INTERVAL '5 seconds'
    OR pg_catalog.jsonb_typeof(validation_body -> 'result') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-submit account binding requires one fresh passed getAccounts validation in the same workflow';
  END IF;

  SELECT COUNT(*)
  INTO matching_account_count
  FROM pg_catalog.jsonb_array_elements(validation_body -> 'result') AS item
  WHERE item ->> 'accountReferenceHmac' = account_hmac::TEXT
    AND item ->> 'accountNo' = account_masked_number
    AND item ->> 'accountType' = account_type_raw;

  IF matching_account_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'getAccounts validation must bind exactly one current broker account HMAC, mask and type';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_dispatch_claim_live_policy() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  auth_order_id UUID;
  auth_risk_id UUID;
  auth_account_hmac CHAR(64);
  order_account_id UUID;
  current_account_hmac CHAR(64);
  risk_account_id UUID;
  risk_promotion_event_id UUID;
  risk_config_version_id UUID;
  risk_config_canonical TEXT;
  risk_config_sha CHAR(64);
  current_config_version_id UUID;
  current_config_canonical TEXT;
  current_config_sha CHAR(64);
  current_config_payload JSONB;
  latest_promotion_id UUID;
  latest_promotion_state TEXT;
  latest_promotion_config_version_id UUID;
  latest_promotion_config_sha CHAR(64);
  latest_promotion_account_hmac CHAR(64);
  latest_promotion_single BIGINT;
  latest_promotion_daily BIGINT;
  latest_promotion_tiny BIGINT;
  latest_kill_state TEXT;
BEGIN
  SELECT
    auth."order_id",
    auth."execution_risk_evidence_id",
    auth."broker_account_reference_hmac"
  INTO auth_order_id, auth_risk_id, auth_account_hmac
  FROM public."order_submission_authorization" AS auth
  WHERE auth."id" = NEW."submission_authorization_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'dispatch live-policy audit requires an existing submission authorization';
  END IF;

  SELECT ledger."account_id", account."external_ref_hmac"
  INTO order_account_id, current_account_hmac
  FROM public."order_ledger" AS ledger
  JOIN public."broker_account" AS account
    ON account."id" = ledger."account_id"
  WHERE ledger."id" = auth_order_id
  FOR UPDATE OF account;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'dispatch live-policy audit requires an existing locked broker account';
  END IF;

  SELECT
    risk."account_id",
    risk."promotion_event_id",
    risk."operational_config_version_id",
    risk."operational_config_canonical",
    risk."operational_config_sha256"
  INTO
    risk_account_id,
    risk_promotion_event_id,
    risk_config_version_id,
    risk_config_canonical,
    risk_config_sha
  FROM public."execution_risk_evidence" AS risk
  WHERE risk."id" = auth_risk_id;

  SELECT
    current_config."operational_config_version_id",
    current_config."canonical_content",
    current_config."content_hash",
    current_config."payload"
  INTO
    current_config_version_id,
    current_config_canonical,
    current_config_sha,
    current_config_payload
  FROM public."operational_config_current" AS current_config
  WHERE current_config."account_id" = order_account_id;

  SELECT
    promotion."id",
    promotion."state"::TEXT,
    promotion."operational_config_version_id",
    promotion."operational_config_sha256",
    promotion."account_allowlist_hmac",
    promotion."max_single_order_gross_minor",
    promotion."max_daily_gross_minor",
    promotion."tiny_live_max_gross_minor"
  INTO
    latest_promotion_id,
    latest_promotion_state,
    latest_promotion_config_version_id,
    latest_promotion_config_sha,
    latest_promotion_account_hmac,
    latest_promotion_single,
    latest_promotion_daily,
    latest_promotion_tiny
  FROM public."live_promotion_event" AS promotion
  WHERE promotion."account_id" = order_account_id
  ORDER BY promotion."version" DESC
  LIMIT 1;

  SELECT kill_event."state"::TEXT
  INTO latest_kill_state
  FROM public."kill_switch_event" AS kill_event
  WHERE kill_event."account_id" = order_account_id
  ORDER BY kill_event."version" DESC
  LIMIT 1;

  IF auth_order_id IS DISTINCT FROM NEW."order_id"
    OR risk_account_id IS DISTINCT FROM order_account_id
    OR auth_account_hmac IS DISTINCT FROM current_account_hmac
    OR NEW."broker_account_reference_hmac" IS DISTINCT FROM current_account_hmac
    OR risk_config_version_id IS NULL
    OR current_config_version_id IS DISTINCT FROM risk_config_version_id
    OR current_config_sha IS DISTINCT FROM risk_config_sha
    OR current_config_canonical IS DISTINCT FROM risk_config_canonical
    OR current_config_payload IS DISTINCT FROM risk_config_canonical::JSONB
    OR latest_promotion_id IS DISTINCT FROM risk_promotion_event_id
    OR latest_promotion_state IS DISTINCT FROM 'GRANTED'
    OR latest_promotion_config_version_id IS DISTINCT FROM current_config_version_id
    OR latest_promotion_config_sha IS DISTINCT FROM current_config_sha
    OR latest_promotion_account_hmac IS DISTINCT FROM current_account_hmac
    OR latest_kill_state IS DISTINCT FROM 'DISENGAGED'
    OR current_config_payload ->> 'mode' IS DISTINCT FROM 'LIVE'
    OR (current_config_payload ->> 'killSwitch')::BOOLEAN IS DISTINCT FROM FALSE
    OR (current_config_payload #>> '{live,enabled}')::BOOLEAN IS DISTINCT FROM TRUE
    OR (current_config_payload #>> '{live,manualApprovalRequired}')::BOOLEAN IS DISTINCT FROM TRUE
    OR NOT (current_config_payload #> '{live,accountAllowlistHmacs}' ? current_account_hmac::TEXT)
    OR (current_config_payload #>> '{live,maxSingleOrderGrossMinor}')::BIGINT
      IS DISTINCT FROM latest_promotion_single
    OR (current_config_payload #>> '{live,maxDailyGrossMinor}')::BIGINT
      IS DISTINCT FROM latest_promotion_daily
    OR (current_config_payload #>> '{live,tinyLiveMaxGrossMinor}')::BIGINT
      IS DISTINCT FROM latest_promotion_tiny THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'dispatch claim requires the latest locked ACTIVE LIVE config, matching GRANTED promotion and DISENGAGED kill switch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_order_pre_auth_non_dispatch_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  canonical_payload JSONB;
  order_mode TEXT;
  order_logical_order_id UUID;
  order_plan_id UUID;
  order_plan_version INTEGER;
  order_plan_order_id UUID;
  order_account_id UUID;
  order_daily_limit_id UUID;
  order_reserved_gross BIGINT;
  order_client_order_id CHAR(36);
  latest_sequence INTEGER;
  latest_state TEXT;
  latest_broker_order_id TEXT;
  latest_filled_quantity BIGINT;
  latest_filled_gross BIGINT;
  latest_fee BIGINT;
  reservation_order_id UUID;
  reservation_daily_limit_id UUID;
  reservation_reserved BIGINT;
  reservation_filled BIGINT;
  reservation_released BIGINT;
  authorization_count BIGINT;
  dispatch_count BIGINT;
  broker_evidence_count BIGINT;
  broker_action_count BIGINT;
  consumed_approval_count BIGINT;
  post_authorization_proof_count BIGINT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-authorization non-dispatch evidence is append-only';
  END IF;

  SELECT
    ledger."mode"::TEXT,
    ledger."logical_order_id",
    ledger."plan_id",
    ledger."plan_version",
    ledger."plan_order_id",
    ledger."account_id",
    ledger."daily_trade_limit_id",
    ledger."reserved_gross_minor",
    ledger."client_order_id"
  INTO
    order_mode,
    order_logical_order_id,
    order_plan_id,
    order_plan_version,
    order_plan_order_id,
    order_account_id,
    order_daily_limit_id,
    order_reserved_gross,
    order_client_order_id
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'pre-authorization recovery requires an existing locked order';
  END IF;

  SELECT
    history."sequence",
    history."normalized_state"::TEXT,
    history."broker_order_id",
    history."filled_quantity",
    history."filled_gross_notional_minor",
    history."fee_minor"
  INTO
    latest_sequence,
    latest_state,
    latest_broker_order_id,
    latest_filled_quantity,
    latest_filled_gross,
    latest_fee
  FROM public."order_state_history" AS history
  WHERE history."order_id" = NEW."order_id"
  ORDER BY history."sequence" DESC
  LIMIT 1;

  SELECT
    reservation."order_id",
    reservation."daily_trade_limit_id",
    reservation."reserved_gross_minor",
    reservation."filled_gross_minor",
    reservation."released_gross_minor"
  INTO
    reservation_order_id,
    reservation_daily_limit_id,
    reservation_reserved,
    reservation_filled,
    reservation_released
  FROM public."daily_trade_reservation" AS reservation
  WHERE reservation."id" = NEW."reservation_id"
  FOR UPDATE;

  SELECT COUNT(*) INTO authorization_count
  FROM public."order_submission_authorization" AS auth
  WHERE auth."order_id" = NEW."order_id"
    OR auth."logical_order_id" = order_logical_order_id
    OR auth."reservation_id" = NEW."reservation_id";

  SELECT COUNT(*) INTO dispatch_count
  FROM public."order_dispatch_claim" AS claim
  WHERE claim."order_id" = NEW."order_id"
    OR claim."logical_order_id" = order_logical_order_id;

  SELECT COUNT(*) INTO broker_evidence_count
  FROM public."broker_order_response_evidence" AS evidence
  WHERE evidence."order_id" = NEW."order_id";

  SELECT COUNT(*) INTO broker_action_count
  FROM public."broker_order_action" AS action
  WHERE action."order_id" = NEW."order_id";

  SELECT COUNT(*) INTO consumed_approval_count
  FROM public."manual_order_approval" AS approval
  WHERE approval."consumed_by_order_id" = NEW."order_id";

  SELECT COUNT(*) INTO post_authorization_proof_count
  FROM public."order_non_dispatch_evidence" AS evidence
  WHERE evidence."order_id" = NEW."order_id";

  IF order_mode IS DISTINCT FROM 'LIVE'
    OR latest_sequence IS DISTINCT FROM 0
    OR latest_state IS DISTINCT FROM 'PLANNED'
    OR latest_broker_order_id IS NOT NULL
    OR latest_filled_quantity <> 0
    OR latest_filled_gross <> 0
    OR latest_fee <> 0
    OR reservation_order_id IS DISTINCT FROM NEW."order_id"
    OR reservation_daily_limit_id IS DISTINCT FROM order_daily_limit_id
    OR reservation_reserved IS DISTINCT FROM order_reserved_gross
    OR reservation_filled <> 0
    OR reservation_released <> 0
    OR authorization_count <> 0
    OR dispatch_count <> 0
    OR broker_evidence_count <> 0
    OR broker_action_count <> 0
    OR consumed_approval_count <> 0
    OR post_authorization_proof_count <> 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'pre-authorization recovery requires the exact current LIVE PLANNED order and fully reserved amount with no authorization, dispatch or broker evidence';
  END IF;

  NEW."logical_order_id" := order_logical_order_id;
  NEW."safe_reason_code" := 'PRE_AUTHORIZATION_NOT_COMPLETED';
  NEW."reserved_gross_minor" := reservation_reserved;
  NEW."recorded_at" := pg_catalog.statement_timestamp();
  NEW."created_at" := NEW."recorded_at";
  canonical_payload := pg_catalog.jsonb_build_object(
    'version', 'ORDER_PRE_AUTHORIZATION_NON_DISPATCH_EVIDENCE_V1',
    'evidenceId', NEW."id"::TEXT,
    'orderId', NEW."order_id"::TEXT,
    'logicalOrderId', order_logical_order_id::TEXT,
    'planId', order_plan_id::TEXT,
    'planVersion', order_plan_version,
    'planOrderId', order_plan_order_id::TEXT,
    'accountId', order_account_id::TEXT,
    'clientOrderId', order_client_order_id::TEXT,
    'reservationId', NEW."reservation_id"::TEXT,
    'reservedGrossMinor', reservation_reserved::TEXT,
    'actor', NEW."actor",
    'safeReasonCode', 'PRE_AUTHORIZATION_NOT_COMPLETED',
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

CREATE FUNCTION public.initialize_order_pre_auth_non_dispatch_evidence() RETURNS trigger
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
    "pre_authorization_non_dispatch_evidence_id",
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
      'preAuthorizationNonDispatchEvidenceId', NEW."id"::TEXT,
      'reservationId', NEW."reservation_id"::TEXT,
      'proofSha256', NEW."proof_sha256"::TEXT
    ),
    NEW."recorded_at"
  );

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_authorization_after_pre_authorization_recovery() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public."order_pre_auth_non_dispatch_evidence" AS evidence
    WHERE evidence."order_id" = NEW."order_id"
      OR evidence."logical_order_id" = NEW."logical_order_id"
      OR evidence."reservation_id" = NEW."reservation_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a pre-authorization recovery proof permanently forbids later submission authorization';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_broker_evidence_after_pre_authorization_recovery() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."order_ledger" AS ledger
  WHERE ledger."id" = NEW."order_id"
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public."order_pre_auth_non_dispatch_evidence" AS evidence
    WHERE evidence."order_id" = NEW."order_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'a pre-authorization recovery proof permanently forbids later broker evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_broker_order_response_evidence() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  known_original_broker_order_id TEXT;
  expected_state public."OrderLedgerState";
  claim_order_id UUID;
  claim_dispatch_started_at TIMESTAMPTZ;
  order_mode TEXT;
  prior_submit_evidence_count BIGINT;
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
    IF NEW."dispatch_claim_id" IS NOT NULL THEN
      SELECT claim."order_id", claim."dispatch_started_at"
      INTO claim_order_id, claim_dispatch_started_at
      FROM public."order_dispatch_claim" AS claim
      WHERE claim."id" = NEW."dispatch_claim_id";

      SELECT COUNT(*)
      INTO prior_submit_evidence_count
      FROM public."broker_order_response_evidence" AS evidence
      WHERE evidence."order_id" = NEW."order_id"
        AND evidence."evidence_kind" = 'SUBMIT';

      IF claim_order_id IS NULL
        OR claim_order_id IS DISTINCT FROM NEW."order_id"
        OR NEW."observed_at" < claim_dispatch_started_at
        OR prior_submit_evidence_count <> 0
        OR NEW."write_outcome" IS DISTINCT FROM 'INTEGRITY_BLOCKED'
        OR NEW."validated_normalized_state"::TEXT IS DISTINCT FROM 'UNKNOWN_BLOCKED'
        OR NEW."safe_error_code" IS NULL
        OR NEW."broker_status_raw" IS DISTINCT FROM 'INTEGRITY_BLOCKED'
        OR NEW."broker_order_id" IS NOT NULL
        OR NEW."http_status" IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'dispatch-crash reconciliation may only seal a no-ID UNKNOWN_BLOCKED against the exact B claim';
      END IF;
    ELSIF (
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
  pre_authorization_non_dispatch_order_id UUID;
  pre_authorization_non_dispatch_recorded_at TIMESTAMPTZ;
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
      OR NEW."pre_authorization_non_dispatch_evidence_id" IS NOT NULL
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
    (previous_state = 'PLANNED' AND NEW."normalized_state"::TEXT IN ('SUBMITTING', 'REJECTED'))
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

  IF NEW."pre_authorization_non_dispatch_evidence_id" IS NOT NULL THEN
    SELECT evidence."order_id", evidence."recorded_at"
    INTO pre_authorization_non_dispatch_order_id, pre_authorization_non_dispatch_recorded_at
    FROM public."order_pre_auth_non_dispatch_evidence" AS evidence
    WHERE evidence."id" = NEW."pre_authorization_non_dispatch_evidence_id";

    IF NOT FOUND
      OR previous_state IS DISTINCT FROM 'PLANNED'
      OR previous_submission_authorization_id IS NOT NULL
      OR NEW."normalized_state"::TEXT IS DISTINCT FROM 'REJECTED'
      OR NEW."actor" IS DISTINCT FROM 'RECOVERY'
      OR pre_authorization_non_dispatch_order_id IS DISTINCT FROM NEW."order_id"
      OR pre_authorization_non_dispatch_recorded_at IS DISTINCT FROM NEW."occurred_at"
      OR NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
      OR NEW."manual_approval_id" IS NOT NULL
      OR NEW."submission_authorization_id" IS NOT NULL
      OR NEW."non_dispatch_evidence_id" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'pre-authorization recovery must atomically close the exact PLANNED LIVE order without authorization or broker evidence';
    END IF;
  ELSIF NEW."non_dispatch_evidence_id" IS NOT NULL THEN
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

      IF dispatch_order_id IS DISTINCT FROM NEW."order_id"
        OR dispatch_authorization_id IS DISTINCT FROM previous_submission_authorization_id
        OR NOT (
          evidence_kind = 'SUBMIT'
          OR (
            evidence_kind = 'RECONCILE'
            AND evidence_validated_state = 'UNKNOWN_BLOCKED'
            AND evidence_broker_status_raw = 'INTEGRITY_BLOCKED'
            AND evidence_broker_order_id IS NULL
          )
        ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'first LIVE broker outcome must be SUBMIT evidence or a no-ID UNKNOWN_BLOCKED bound to the exact one-time dispatch claim';
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
    AND NEW."non_dispatch_evidence_id" IS NULL
    AND NEW."pre_authorization_non_dispatch_evidence_id" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'every LIVE broker state requires append-only validated response or non-dispatch evidence';
  END IF;

  IF order_mode = 'PAPER'
    AND (
      NEW."broker_status_raw" IS NOT NULL
      OR NEW."broker_order_id" IS NOT NULL
      OR NEW."broker_action_id" IS NOT NULL
      OR NEW."broker_response_evidence_id" IS NOT NULL
      OR NEW."non_dispatch_evidence_id" IS NOT NULL
      OR NEW."pre_authorization_non_dispatch_evidence_id" IS NOT NULL
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

CREATE TRIGGER broker_account_identity_guard
BEFORE UPDATE OR DELETE ON public."broker_account"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_account_identity();

CREATE TRIGGER broker_account_truncate_guard
BEFORE TRUNCATE ON public."broker_account"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

CREATE TRIGGER operational_config_activation_00_account_lock
BEFORE INSERT ON public."operational_config_activation"
FOR EACH ROW EXECUTE FUNCTION public.lock_operational_config_activation_account();

CREATE TRIGGER live_promotion_event_00_account_lock
BEFORE INSERT ON public."live_promotion_event"
FOR EACH ROW EXECUTE FUNCTION public.lock_account_scoped_safety_event();

CREATE TRIGGER kill_switch_event_00_account_lock
BEFORE INSERT ON public."kill_switch_event"
FOR EACH ROW EXECUTE FUNCTION public.lock_account_scoped_safety_event();

CREATE TRIGGER pre_submit_evidence_00_account_binding_guard
BEFORE INSERT ON public."pre_submit_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_pre_submit_account_binding();

CREATE TRIGGER order_dispatch_claim_01_live_policy_guard
BEFORE INSERT ON public."order_dispatch_claim"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_dispatch_claim_live_policy();

CREATE TRIGGER order_pre_auth_non_dispatch_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON public."order_pre_auth_non_dispatch_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_order_pre_auth_non_dispatch_evidence();

CREATE TRIGGER order_pre_auth_non_dispatch_evidence_initialize
AFTER INSERT ON public."order_pre_auth_non_dispatch_evidence"
FOR EACH ROW EXECUTE FUNCTION public.initialize_order_pre_auth_non_dispatch_evidence();

CREATE TRIGGER order_pre_auth_non_dispatch_evidence_truncate_guard
BEFORE TRUNCATE ON public."order_pre_auth_non_dispatch_evidence"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_order_ledger_truncate();

CREATE TRIGGER order_submission_authorization_00_pre_auth_recovery_guard
BEFORE INSERT ON public."order_submission_authorization"
FOR EACH ROW EXECUTE FUNCTION public.guard_authorization_after_pre_authorization_recovery();

CREATE TRIGGER broker_order_response_00_pre_auth_recovery_guard
BEFORE INSERT ON public."broker_order_response_evidence"
FOR EACH ROW EXECUTE FUNCTION public.guard_broker_evidence_after_pre_authorization_recovery();

ALTER TABLE public."broker_account"
ENABLE ALWAYS TRIGGER broker_account_identity_guard;

ALTER TABLE public."broker_account"
ENABLE ALWAYS TRIGGER broker_account_truncate_guard;

ALTER TABLE public."operational_config_activation"
ENABLE ALWAYS TRIGGER operational_config_activation_00_account_lock;

ALTER TABLE public."live_promotion_event"
ENABLE ALWAYS TRIGGER live_promotion_event_00_account_lock;

ALTER TABLE public."kill_switch_event"
ENABLE ALWAYS TRIGGER kill_switch_event_00_account_lock;

ALTER TABLE public."pre_submit_evidence"
ENABLE ALWAYS TRIGGER pre_submit_evidence_00_account_binding_guard;

ALTER TABLE public."order_dispatch_claim"
ENABLE ALWAYS TRIGGER order_dispatch_claim_01_live_policy_guard;

ALTER TABLE public."order_pre_auth_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_pre_auth_non_dispatch_evidence_guard;

ALTER TABLE public."order_pre_auth_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_pre_auth_non_dispatch_evidence_initialize;

ALTER TABLE public."order_pre_auth_non_dispatch_evidence"
ENABLE ALWAYS TRIGGER order_pre_auth_non_dispatch_evidence_truncate_guard;

ALTER TABLE public."order_submission_authorization"
ENABLE ALWAYS TRIGGER order_submission_authorization_00_pre_auth_recovery_guard;

ALTER TABLE public."broker_order_response_evidence"
ENABLE ALWAYS TRIGGER broker_order_response_00_pre_auth_recovery_guard;

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
  non_dispatch."proof_sha256" AS "non_dispatch_proof_sha256",
  history."pre_authorization_non_dispatch_evidence_id",
  pre_authorization_non_dispatch."safe_reason_code"
    AS "pre_authorization_non_dispatch_safe_reason_code",
  pre_authorization_non_dispatch."proof_sha256"
    AS "pre_authorization_non_dispatch_proof_sha256"
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
  ON non_dispatch."id" = history."non_dispatch_evidence_id"
LEFT JOIN public."order_pre_auth_non_dispatch_evidence"
  AS pre_authorization_non_dispatch
  ON pre_authorization_non_dispatch."id"
    = history."pre_authorization_non_dispatch_evidence_id";
