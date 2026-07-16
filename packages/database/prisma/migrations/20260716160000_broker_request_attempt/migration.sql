CREATE TYPE "BrokerRequestOutcome" AS ENUM (
  'SUCCEEDED',
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'SCHEMA_ERROR'
);

CREATE TABLE "broker_request_attempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workflow_type" TEXT NOT NULL,
  "correlation_id" UUID NOT NULL,
  "collection_run_id" UUID,
  "operation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL,
  "rate_limit_group" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6) NOT NULL,
  "outcome" "BrokerRequestOutcome" NOT NULL,
  "http_status" INTEGER,
  "request_id" TEXT,
  "rate_limit_limit" INTEGER,
  "rate_limit_remaining" INTEGER,
  "rate_limit_reset_seconds" INTEGER,
  "retry_after_seconds" INTEGER,
  "safe_error_code" TEXT,
  "redacted_request_summary" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "broker_request_attempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broker_request_attempt_identity_check" CHECK (
    BTRIM("workflow_type") <> ''
    AND BTRIM("operation_id") <> ''
    AND BTRIM("rate_limit_group") <> ''
    AND ("request_id" IS NULL OR BTRIM("request_id") <> '')
    AND ("safe_error_code" IS NULL OR BTRIM("safe_error_code") <> '')
  ),
  CONSTRAINT "broker_request_attempt_sequence_check" CHECK (
    "ordinal" >= 0 AND "attempt" >= 1
  ),
  CONSTRAINT "broker_request_attempt_time_check" CHECK (
    "completed_at" >= "started_at"
  ),
  CONSTRAINT "broker_request_attempt_http_status_check" CHECK (
    "http_status" IS NULL OR ("http_status" BETWEEN 100 AND 599)
  ),
  CONSTRAINT "broker_request_attempt_rate_metadata_check" CHECK (
    ("rate_limit_limit" IS NULL OR "rate_limit_limit" >= 0)
    AND ("rate_limit_remaining" IS NULL OR "rate_limit_remaining" >= 0)
    AND ("rate_limit_reset_seconds" IS NULL OR "rate_limit_reset_seconds" >= 0)
    AND ("retry_after_seconds" IS NULL OR "retry_after_seconds" >= 0)
    AND (
      "rate_limit_limit" IS NULL
      OR "rate_limit_remaining" IS NULL
      OR "rate_limit_remaining" <= "rate_limit_limit"
    )
  ),
  CONSTRAINT "broker_request_attempt_outcome_check" CHECK (
    (
      "outcome" = 'SUCCEEDED'
      AND "http_status" BETWEEN 200 AND 299
      AND "safe_error_code" IS NULL
    )
    OR (
      "outcome" = 'HTTP_ERROR'
      AND "http_status" IS NOT NULL
      AND NOT ("http_status" BETWEEN 200 AND 299)
      AND "safe_error_code" IS NOT NULL
    )
    OR (
      "outcome" IN ('TIMEOUT', 'NETWORK_ERROR')
      AND "http_status" IS NULL
      AND "safe_error_code" IS NOT NULL
    )
    OR (
      "outcome" = 'SCHEMA_ERROR'
      AND "http_status" BETWEEN 200 AND 299
      AND "safe_error_code" IS NOT NULL
    )
  ),
  CONSTRAINT "broker_request_attempt_request_summary_check" CHECK (
    JSONB_TYPEOF("redacted_request_summary") = 'object'
  )
);

CREATE UNIQUE INDEX "broker_request_attempt_identity_key"
ON "broker_request_attempt"(
  "workflow_type",
  "correlation_id",
  "operation_id",
  "ordinal",
  "attempt"
);

CREATE INDEX "broker_request_attempt_correlation_id_started_at_idx"
ON "broker_request_attempt"("correlation_id", "started_at" DESC);

CREATE INDEX "broker_request_attempt_collection_run_id_started_at_idx"
ON "broker_request_attempt"("collection_run_id", "started_at");

CREATE INDEX "broker_request_attempt_request_id_idx"
ON "broker_request_attempt"("request_id");

ALTER TABLE "broker_request_attempt"
ADD CONSTRAINT "broker_request_attempt_collection_run_id_fkey"
FOREIGN KEY ("collection_run_id")
REFERENCES "collection_run"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TRIGGER broker_request_attempt_immutable
BEFORE UPDATE OR DELETE ON "broker_request_attempt"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
