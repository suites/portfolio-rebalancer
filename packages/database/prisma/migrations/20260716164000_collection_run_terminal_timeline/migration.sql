WITH terminal_evidence AS (
  SELECT
    run."id",
    GREATEST(
      run."started_at",
      COALESCE(run."completed_at", run."started_at"),
      COALESCE(MAX(attempt."completed_at"), '-infinity'::TIMESTAMPTZ),
      COALESCE(MAX(validation."validated_at"), '-infinity'::TIMESTAMPTZ)
    ) AS "corrected_completed_at"
  FROM "collection_run" AS run
  LEFT JOIN "broker_request_attempt" AS attempt
    ON attempt."collection_run_id" = run."id"
  LEFT JOIN "broker_response_validation" AS validation
    ON validation."request_attempt_id" = attempt."id"
  WHERE run."status" IN ('SUCCEEDED', 'FAILED')
  GROUP BY run."id", run."started_at", run."completed_at"
)
UPDATE "collection_run" AS run
SET "completed_at" = evidence."corrected_completed_at"
FROM terminal_evidence AS evidence
WHERE run."id" = evidence."id"
  AND run."completed_at" IS DISTINCT FROM evidence."corrected_completed_at";

ALTER TABLE "collection_run"
ADD CONSTRAINT "collection_run_terminal_completion_check" CHECK (
  (
    "status" = 'RUNNING'
    AND "completed_at" IS NULL
  )
  OR (
    "status" IN ('SUCCEEDED', 'FAILED')
    AND "completed_at" IS NOT NULL
  )
);

CREATE FUNCTION require_running_collection_run_for_attempt() RETURNS trigger AS $$
BEGIN
  IF NEW."collection_run_id" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM "collection_run"
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER broker_request_attempt_insert_while_running
BEFORE INSERT ON "broker_request_attempt"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_run_for_attempt();

CREATE OR REPLACE FUNCTION require_succeeded_broker_response_attempt() RETURNS trigger AS $$
DECLARE
  attempt_completed_at TIMESTAMPTZ(6);
  attempt_operation_id TEXT;
  attempt_collection_run_id UUID;
BEGIN
  SELECT "completed_at", "operation_id", "collection_run_id"
  INTO attempt_completed_at, attempt_operation_id, attempt_collection_run_id
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

  IF attempt_collection_run_id IS NOT NULL THEN
    PERFORM 1
    FROM "collection_run"
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
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_collection_run_terminal_timeline() RETURNS trigger AS $$
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
  FROM "broker_request_attempt"
  WHERE "collection_run_id" = NEW."id";

  SELECT MAX(validation."validated_at")
  INTO latest_validation_at
  FROM "broker_response_validation" AS validation
  JOIN "broker_request_attempt" AS attempt
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER collection_run_terminal_timeline_guard
BEFORE UPDATE OR DELETE ON "collection_run"
FOR EACH ROW EXECUTE FUNCTION guard_collection_run_terminal_timeline();
