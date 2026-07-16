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

  IF attempt_collection_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "collection_run"
    WHERE "id" = attempt_collection_run_id
      AND "status" = 'RUNNING'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'collection response validation can only be appended while the collection run is running';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "portfolio_snapshot"
ENABLE TRIGGER "portfolio_snapshot_immutable";

ALTER TABLE "snapshot_check"
ENABLE TRIGGER "snapshot_check_insert_while_running";

DROP TABLE IF EXISTS "legacy_unverified_market_snapshot";

CREATE TABLE "legacy_unverified_market_snapshot" (
  "snapshot_id" UUID PRIMARY KEY
);

INSERT INTO "legacy_unverified_market_snapshot" ("snapshot_id")
SELECT snapshot."id"
FROM "portfolio_snapshot" AS snapshot
WHERE
  NOT EXISTS (
    SELECT 1
    FROM "broker_request_attempt" AS attempt
    JOIN "broker_response_validation" AS validation
      ON validation."request_attempt_id" = attempt."id"
    WHERE attempt."collection_run_id" = snapshot."collection_run_id"
      AND attempt."operation_id" = 'getHoldings'
      AND attempt."outcome" = 'SUCCEEDED'
      AND attempt."http_status" BETWEEN 200 AND 299
      AND validation."operation_id" = attempt."operation_id"
      AND validation."outcome" = 'PASSED'
  )
  OR EXISTS (
    SELECT 1
    FROM "price_snapshot" AS price
    LEFT JOIN "broker_request_attempt" AS attempt
      ON attempt."id" = price."request_attempt_id"
    LEFT JOIN "broker_response_validation" AS validation
      ON validation."request_attempt_id" = attempt."id"
    WHERE price."snapshot_id" = snapshot."id"
      AND (
        attempt."collection_run_id" IS DISTINCT FROM snapshot."collection_run_id"
        OR attempt."operation_id" IS DISTINCT FROM 'getPrices'
        OR attempt."outcome" IS DISTINCT FROM 'SUCCEEDED'
        OR attempt."http_status" NOT BETWEEN 200 AND 299
        OR validation."operation_id" IS DISTINCT FROM attempt."operation_id"
        OR validation."outcome" IS DISTINCT FROM 'PASSED'
      )
  )
  OR EXISTS (
    SELECT 1
    FROM "market_calendar_snapshot" AS calendar
    LEFT JOIN "broker_request_attempt" AS attempt
      ON attempt."id" = calendar."request_attempt_id"
    LEFT JOIN "broker_response_validation" AS validation
      ON validation."request_attempt_id" = attempt."id"
    WHERE calendar."snapshot_id" = snapshot."id"
      AND (
        attempt."collection_run_id" IS DISTINCT FROM snapshot."collection_run_id"
        OR attempt."operation_id" IS DISTINCT FROM CASE calendar."market_country"
          WHEN 'KR' THEN 'getKrMarketCalendar'
          WHEN 'US' THEN 'getUsMarketCalendar'
          ELSE NULL
        END
        OR attempt."outcome" IS DISTINCT FROM 'SUCCEEDED'
        OR attempt."http_status" NOT BETWEEN 200 AND 299
        OR validation."operation_id" IS DISTINCT FROM attempt."operation_id"
        OR validation."outcome" IS DISTINCT FROM 'PASSED'
      )
  );

ALTER TABLE "portfolio_snapshot"
DISABLE TRIGGER "portfolio_snapshot_immutable";

UPDATE "portfolio_snapshot" AS snapshot
SET "validation_status" = 'BLOCKED'
FROM "legacy_unverified_market_snapshot" AS legacy
WHERE snapshot."id" = legacy."snapshot_id"
  AND snapshot."validation_status" <> 'BLOCKED';

ALTER TABLE "portfolio_snapshot"
ENABLE TRIGGER "portfolio_snapshot_immutable";

ALTER TABLE "snapshot_check"
DISABLE TRIGGER "snapshot_check_insert_while_running";

INSERT INTO "snapshot_check" (
  "id",
  "snapshot_id",
  "rule_code",
  "subject_key",
  "outcome",
  "detail",
  "checked_at"
)
SELECT
  gen_random_uuid(),
  legacy."snapshot_id",
  'BROKER_RESPONSE_PROVENANCE',
  'PORTFOLIO',
  'BLOCKED',
  '{"message":"응답 검증 도입 전에 저장된 스냅샷이거나 요청 provenance를 검증할 수 없어 계획과 주문에서 격리했습니다."}'::JSONB,
  CURRENT_TIMESTAMP
FROM "legacy_unverified_market_snapshot" AS legacy
ON CONFLICT ("snapshot_id", "rule_code", "subject_key") DO NOTHING;

ALTER TABLE "snapshot_check"
ENABLE TRIGGER "snapshot_check_insert_while_running";

DROP TABLE "legacy_unverified_market_snapshot";
