CREATE OR REPLACE FUNCTION public.reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % cannot be changed', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_running_collection_run() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."collection_run"
  WHERE "id" = NEW."collection_run_id"
    AND "status" = 'RUNNING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'collection evidence can only be inserted while the collection run is RUNNING';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_running_collection_snapshot() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  PERFORM 1
  FROM public."portfolio_snapshot" AS snapshot
  JOIN public."collection_run" AS run
    ON run."id" = snapshot."collection_run_id"
  WHERE snapshot."id" = NEW."snapshot_id"
    AND run."status" = 'RUNNING'
  FOR UPDATE OF run;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snapshot evidence can only be inserted while the collection run is RUNNING';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_succeeded_broker_response_attempt() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  attempt_completed_at TIMESTAMPTZ(6);
  attempt_operation_id TEXT;
  attempt_collection_run_id UUID;
BEGIN
  SELECT "completed_at", "operation_id", "collection_run_id"
  INTO attempt_completed_at, attempt_operation_id, attempt_collection_run_id
  FROM public."broker_request_attempt"
  WHERE "id" = NEW."request_attempt_id"
    AND "outcome" = 'SUCCEEDED'
    AND "http_status" BETWEEN 200 AND 299;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker response validation requires a succeeded HTTP request attempt';
  END IF;

  IF NEW."operation_id" <> attempt_operation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker response validation operation must match the request attempt';
  END IF;

  IF NEW."validated_at" < attempt_completed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker response validation cannot predate the request attempt completion';
  END IF;

  IF attempt_collection_run_id IS NOT NULL THEN
    PERFORM 1
    FROM public."collection_run"
    WHERE "id" = attempt_collection_run_id
      AND "status" = 'RUNNING'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'collection response validation can only be appended while the collection run is running';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_running_collection_run_for_attempt() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF NEW."collection_run_id" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public."collection_run"
  WHERE "id" = NEW."collection_run_id"
    AND "status" = 'RUNNING'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'broker request attempt can only be appended while the collection run is running';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_collection_run_terminal_timeline() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  latest_attempt_completed_at TIMESTAMPTZ(6);
  latest_validation_at TIMESTAMPTZ(6);
  latest_evidence_at TIMESTAMPTZ(6);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('SUCCEEDED', 'FAILED') THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'terminal collection run is immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'terminal collection run is immutable';
  END IF;

  IF
    NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."started_at" IS DISTINCT FROM OLD."started_at"
    OR NEW."app_version" IS DISTINCT FROM OLD."app_version"
    OR NEW."adapter_version" IS DISTINCT FROM OLD."adapter_version"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'collection run identity and start evidence are immutable';
  END IF;

  IF NEW."status" = 'RUNNING' THEN
    RETURN NEW;
  END IF;

  SELECT MAX("completed_at")
  INTO latest_attempt_completed_at
  FROM public."broker_request_attempt"
  WHERE "collection_run_id" = NEW."id";

  SELECT MAX(validation."validated_at")
  INTO latest_validation_at
  FROM public."broker_response_validation" AS validation
  JOIN public."broker_request_attempt" AS attempt
    ON attempt."id" = validation."request_attempt_id"
  WHERE attempt."collection_run_id" = NEW."id";

  latest_evidence_at := GREATEST(
    COALESCE(latest_attempt_completed_at, '-infinity'::TIMESTAMPTZ),
    COALESCE(latest_validation_at, '-infinity'::TIMESTAMPTZ)
  );

  IF NEW."completed_at" IS NULL OR NEW."completed_at" < latest_evidence_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'collection completion cannot predate broker request or response validation evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_market_snapshot_provenance() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
DECLARE
  snapshot_collection_run_id UUID;
  attempt_collection_run_id UUID;
  attempt_operation_id TEXT;
  attempt_outcome public."BrokerRequestOutcome";
  attempt_completed_at TIMESTAMPTZ(6);
  response_validation_outcome public."BrokerResponseValidationOutcome";
  response_validation_body JSONB;
  expected_operation_id TEXT;
  matching_price_item JSONB;
  matching_price_item_count BIGINT;
  raw_price_timestamp TEXT;
  raw_calendar_result JSONB;
BEGIN
  SELECT
    snapshot."collection_run_id",
    attempt."collection_run_id",
    attempt."operation_id",
    attempt."outcome",
    attempt."completed_at",
    validation."outcome",
    validation."redacted_body"
  INTO
    snapshot_collection_run_id,
    attempt_collection_run_id,
    attempt_operation_id,
    attempt_outcome,
    attempt_completed_at,
    response_validation_outcome,
    response_validation_body
  FROM public."portfolio_snapshot" AS snapshot
  JOIN public."broker_request_attempt" AS attempt
    ON attempt."id" = NEW."request_attempt_id"
  LEFT JOIN public."broker_response_validation" AS validation
    ON validation."request_attempt_id" = attempt."id"
  WHERE snapshot."id" = NEW."snapshot_id";

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot provenance requires an existing snapshot and request attempt';
  END IF;

  IF attempt_collection_run_id IS DISTINCT FROM snapshot_collection_run_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot request attempt must belong to the same collection run';
  END IF;

  IF attempt_outcome <> 'SUCCEEDED' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot provenance requires a succeeded request attempt';
  END IF;

  IF response_validation_outcome IS DISTINCT FROM 'PASSED' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot provenance requires passed broker response validation';
  END IF;

  IF NEW."received_at" IS DISTINCT FROM attempt_completed_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot received_at must equal the request attempt completion time';
  END IF;

  IF TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot provenance trigger must be attached to the public schema';
  END IF;

  IF TG_TABLE_NAME = 'price_snapshot' THEN
    expected_operation_id := 'getPrices';
  ELSIF TG_TABLE_NAME = 'market_calendar_snapshot' THEN
    CASE NEW."market_country"
      WHEN 'KR' THEN expected_operation_id := 'getKrMarketCalendar';
      WHEN 'US' THEN expected_operation_id := 'getUsMarketCalendar';
      ELSE
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'market calendar snapshot has an unsupported market country';
    END CASE;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot provenance trigger attached to an unsupported table';
  END IF;

  IF attempt_operation_id <> expected_operation_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'market snapshot request operation does not match the evidence type and market';
  END IF;

  IF TG_TABLE_NAME = 'price_snapshot' THEN
    IF pg_catalog.jsonb_typeof(response_validation_body -> 'result') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'price snapshot provenance requires a validated result array';
    END IF;

    SELECT COUNT(*)
    INTO matching_price_item_count
    FROM pg_catalog.jsonb_array_elements(response_validation_body -> 'result') AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) = 'object'
      AND item.value ->> 'symbol' = NEW."symbol";

    IF matching_price_item_count <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'price snapshot symbol must match exactly one validated response item';
    END IF;

    SELECT item.value
    INTO matching_price_item
    FROM pg_catalog.jsonb_array_elements(response_validation_body -> 'result') AS item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) = 'object'
      AND item.value ->> 'symbol' = NEW."symbol"
    LIMIT 1;

    IF matching_price_item ->> 'currency' IS DISTINCT FROM NEW."currency"
      OR matching_price_item ->> 'lastPrice' IS DISTINCT FROM NEW."last_price" THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'price snapshot currency and last_price must match the validated response item';
    END IF;

    raw_price_timestamp := matching_price_item ->> 'timestamp';
    IF raw_price_timestamp IS NULL THEN
      IF NEW."provider_observed_at" IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'price snapshot timestamp must match the validated response item';
      END IF;
    ELSIF NEW."provider_observed_at" IS DISTINCT FROM raw_price_timestamp::TIMESTAMPTZ THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'price snapshot timestamp must match the validated response item';
    END IF;
  ELSE
    IF pg_catalog.jsonb_typeof(response_validation_body -> 'result') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'market calendar snapshot provenance requires a validated result object';
    END IF;

    raw_calendar_result := response_validation_body -> 'result';
    IF raw_calendar_result -> 'today' ->> 'date'
        IS DISTINCT FROM NEW."calendar" -> 'today' ->> 'date'
      OR raw_calendar_result -> 'previousBusinessDay' ->> 'date'
        IS DISTINCT FROM NEW."calendar" -> 'previousBusinessDay' ->> 'date'
      OR raw_calendar_result -> 'nextBusinessDay' ->> 'date'
        IS DISTINCT FROM NEW."calendar" -> 'nextBusinessDay' ->> 'date' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'market calendar dates must match the validated response result';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS raw_broker_response_immutable_truncate ON public."raw_broker_response";
CREATE TRIGGER raw_broker_response_immutable_truncate
BEFORE TRUNCATE ON public."raw_broker_response"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS portfolio_snapshot_immutable_truncate ON public."portfolio_snapshot";
CREATE TRIGGER portfolio_snapshot_immutable_truncate
BEFORE TRUNCATE ON public."portfolio_snapshot"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS holding_snapshot_immutable_truncate ON public."holding_snapshot";
CREATE TRIGGER holding_snapshot_immutable_truncate
BEFORE TRUNCATE ON public."holding_snapshot"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS snapshot_check_immutable_truncate ON public."snapshot_check";
CREATE TRIGGER snapshot_check_immutable_truncate
BEFORE TRUNCATE ON public."snapshot_check"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS buying_power_snapshot_immutable_truncate ON public."buying_power_snapshot";
CREATE TRIGGER buying_power_snapshot_immutable_truncate
BEFORE TRUNCATE ON public."buying_power_snapshot"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS price_snapshot_immutable_truncate ON public."price_snapshot";
CREATE TRIGGER price_snapshot_immutable_truncate
BEFORE TRUNCATE ON public."price_snapshot"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS market_calendar_snapshot_immutable_truncate ON public."market_calendar_snapshot";
CREATE TRIGGER market_calendar_snapshot_immutable_truncate
BEFORE TRUNCATE ON public."market_calendar_snapshot"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS broker_request_attempt_immutable_truncate ON public."broker_request_attempt";
CREATE TRIGGER broker_request_attempt_immutable_truncate
BEFORE TRUNCATE ON public."broker_request_attempt"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS broker_response_validation_immutable_truncate ON public."broker_response_validation";
CREATE TRIGGER broker_response_validation_immutable_truncate
BEFORE TRUNCATE ON public."broker_response_validation"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS instrument_validation_immutable_truncate ON public."instrument_validation";
CREATE TRIGGER instrument_validation_immutable_truncate
BEFORE TRUNCATE ON public."instrument_validation"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

DROP TRIGGER IF EXISTS collection_run_terminal_timeline_truncate ON public."collection_run";
CREATE TRIGGER collection_run_terminal_timeline_truncate
BEFORE TRUNCATE ON public."collection_run"
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_immutable_change();

ALTER TABLE public."raw_broker_response" ENABLE ALWAYS TRIGGER "raw_broker_response_immutable";
ALTER TABLE public."raw_broker_response" ENABLE ALWAYS TRIGGER "raw_broker_response_insert_while_running";
ALTER TABLE public."raw_broker_response" ENABLE ALWAYS TRIGGER "raw_broker_response_immutable_truncate";

ALTER TABLE public."portfolio_snapshot" ENABLE ALWAYS TRIGGER "portfolio_snapshot_immutable";
ALTER TABLE public."portfolio_snapshot" ENABLE ALWAYS TRIGGER "portfolio_snapshot_insert_while_running";
ALTER TABLE public."portfolio_snapshot" ENABLE ALWAYS TRIGGER "portfolio_snapshot_immutable_truncate";

ALTER TABLE public."holding_snapshot" ENABLE ALWAYS TRIGGER "holding_snapshot_immutable";
ALTER TABLE public."holding_snapshot" ENABLE ALWAYS TRIGGER "holding_snapshot_insert_while_running";
ALTER TABLE public."holding_snapshot" ENABLE ALWAYS TRIGGER "holding_snapshot_immutable_truncate";

ALTER TABLE public."snapshot_check" ENABLE ALWAYS TRIGGER "snapshot_check_immutable";
ALTER TABLE public."snapshot_check" ENABLE ALWAYS TRIGGER "snapshot_check_insert_while_running";
ALTER TABLE public."snapshot_check" ENABLE ALWAYS TRIGGER "snapshot_check_immutable_truncate";

ALTER TABLE public."buying_power_snapshot" ENABLE ALWAYS TRIGGER "buying_power_snapshot_immutable";
ALTER TABLE public."buying_power_snapshot" ENABLE ALWAYS TRIGGER "buying_power_snapshot_insert_while_running";
ALTER TABLE public."buying_power_snapshot" ENABLE ALWAYS TRIGGER "buying_power_snapshot_immutable_truncate";

ALTER TABLE public."price_snapshot" ENABLE ALWAYS TRIGGER "price_snapshot_immutable";
ALTER TABLE public."price_snapshot" ENABLE ALWAYS TRIGGER "price_snapshot_insert_while_running";
ALTER TABLE public."price_snapshot" ENABLE ALWAYS TRIGGER "price_snapshot_provenance_guard";
ALTER TABLE public."price_snapshot" ENABLE ALWAYS TRIGGER "price_snapshot_immutable_truncate";

ALTER TABLE public."market_calendar_snapshot" ENABLE ALWAYS TRIGGER "market_calendar_snapshot_immutable";
ALTER TABLE public."market_calendar_snapshot" ENABLE ALWAYS TRIGGER "market_calendar_snapshot_insert_while_running";
ALTER TABLE public."market_calendar_snapshot" ENABLE ALWAYS TRIGGER "market_calendar_snapshot_provenance_guard";
ALTER TABLE public."market_calendar_snapshot" ENABLE ALWAYS TRIGGER "market_calendar_snapshot_immutable_truncate";

ALTER TABLE public."broker_request_attempt" ENABLE ALWAYS TRIGGER "broker_request_attempt_immutable";
ALTER TABLE public."broker_request_attempt" ENABLE ALWAYS TRIGGER "broker_request_attempt_insert_while_running";
ALTER TABLE public."broker_request_attempt" ENABLE ALWAYS TRIGGER "broker_request_attempt_immutable_truncate";

ALTER TABLE public."broker_response_validation" ENABLE ALWAYS TRIGGER "broker_response_validation_succeeded_attempt";
ALTER TABLE public."broker_response_validation" ENABLE ALWAYS TRIGGER "broker_response_validation_immutable";
ALTER TABLE public."broker_response_validation" ENABLE ALWAYS TRIGGER "broker_response_validation_immutable_truncate";

ALTER TABLE public."instrument_validation" ENABLE ALWAYS TRIGGER "instrument_validation_immutable";
ALTER TABLE public."instrument_validation" ENABLE ALWAYS TRIGGER "instrument_validation_immutable_truncate";

ALTER TABLE public."collection_run" ENABLE ALWAYS TRIGGER "collection_run_terminal_timeline_guard";
ALTER TABLE public."collection_run" ENABLE ALWAYS TRIGGER "collection_run_terminal_timeline_truncate";
