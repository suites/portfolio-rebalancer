CREATE TYPE "BrokerResponseValidationOutcome" AS ENUM (
  'PASSED',
  'SCHEMA_ERROR'
);

CREATE TABLE "broker_response_validation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_attempt_id" UUID NOT NULL,
  "operation_id" TEXT NOT NULL,
  "outcome" "BrokerResponseValidationOutcome" NOT NULL,
  "redacted_body" JSONB NOT NULL,
  "body_sha256" CHAR(64) NOT NULL,
  "safe_error_code" TEXT,
  "validated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "broker_response_validation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broker_response_validation_operation_id_check" CHECK (
    BTRIM("operation_id") <> ''
  ),
  CONSTRAINT "broker_response_validation_outcome_check" CHECK (
    (
      "outcome" = 'PASSED'
      AND "safe_error_code" IS NULL
    )
    OR (
      "outcome" = 'SCHEMA_ERROR'
      AND "safe_error_code" IS NOT NULL
      AND BTRIM("safe_error_code") <> ''
    )
  ),
  CONSTRAINT "broker_response_validation_body_sha256_check" CHECK (
    "body_sha256" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "broker_response_validation_request_attempt_id_key"
ON "broker_response_validation"("request_attempt_id");

ALTER TABLE "broker_response_validation"
ADD CONSTRAINT "broker_response_validation_request_attempt_id_fkey"
FOREIGN KEY ("request_attempt_id")
REFERENCES "broker_request_attempt"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION require_succeeded_broker_response_attempt() RETURNS trigger AS $$
DECLARE
  attempt_completed_at TIMESTAMPTZ(6);
  attempt_operation_id TEXT;
BEGIN
  SELECT "completed_at", "operation_id"
  INTO attempt_completed_at, attempt_operation_id
  FROM "broker_request_attempt"
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER broker_response_validation_succeeded_attempt
BEFORE INSERT ON "broker_response_validation"
FOR EACH ROW EXECUTE FUNCTION require_succeeded_broker_response_attempt();

CREATE TRIGGER broker_response_validation_immutable
BEFORE UPDATE OR DELETE ON "broker_response_validation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "price_snapshot"
    WHERE "request_attempt_id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'price_snapshot contains rows without request attempt provenance';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "market_calendar_snapshot"
    WHERE "request_attempt_id" IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23502',
      MESSAGE = 'market_calendar_snapshot contains rows without request attempt provenance';
  END IF;
END;
$$;

ALTER TABLE "price_snapshot"
ALTER COLUMN "request_attempt_id" SET NOT NULL;

ALTER TABLE "market_calendar_snapshot"
ALTER COLUMN "request_attempt_id" SET NOT NULL;

CREATE FUNCTION require_market_snapshot_provenance() RETURNS trigger AS $$
DECLARE
  snapshot_collection_run_id UUID;
  attempt_collection_run_id UUID;
  attempt_operation_id TEXT;
  attempt_outcome "BrokerRequestOutcome";
  response_validation_outcome "BrokerResponseValidationOutcome";
  expected_operation_id TEXT;
BEGIN
  SELECT
    snapshot."collection_run_id",
    attempt."collection_run_id",
    attempt."operation_id",
    attempt."outcome",
    validation."outcome"
  INTO
    snapshot_collection_run_id,
    attempt_collection_run_id,
    attempt_operation_id,
    attempt_outcome,
    response_validation_outcome
  FROM "portfolio_snapshot" AS snapshot
  JOIN "broker_request_attempt" AS attempt
    ON attempt."id" = NEW."request_attempt_id"
  LEFT JOIN "broker_response_validation" AS validation
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_snapshot_provenance_guard
BEFORE INSERT ON "price_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_market_snapshot_provenance();

CREATE TRIGGER market_calendar_snapshot_provenance_guard
BEFORE INSERT ON "market_calendar_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_market_snapshot_provenance();
