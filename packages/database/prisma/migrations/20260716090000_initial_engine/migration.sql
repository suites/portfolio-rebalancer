CREATE TYPE "TargetConfigStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "CollectionRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "SnapshotValidationStatus" AS ENUM ('VERIFIED', 'BLOCKED');
CREATE TYPE "CheckOutcome" AS ENUM ('PASSED', 'BLOCKED');

CREATE TABLE "broker_account" (
  "id" UUID NOT NULL,
  "broker" TEXT NOT NULL,
  "external_ref_hmac" CHAR(64) NOT NULL,
  "masked_number" TEXT NOT NULL,
  "account_type_raw" TEXT NOT NULL,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "broker_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "target_config" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "target_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "target_config_version" (
  "id" UUID NOT NULL,
  "config_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TargetConfigStatus" NOT NULL DEFAULT 'DRAFT',
  "content_hash" CHAR(64) NOT NULL,
  "app_version" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "target_config_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "target_allocation" (
  "id" UUID NOT NULL,
  "config_version_id" UUID NOT NULL,
  "asset_key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "target_basis_points" INTEGER NOT NULL,
  "lower_basis_points" INTEGER NOT NULL,
  "upper_basis_points" INTEGER NOT NULL,
  CONSTRAINT "target_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "target_allocation_basis_points_check" CHECK (
    0 <= "lower_basis_points"
    AND "lower_basis_points" <= "target_basis_points"
    AND "target_basis_points" <= "upper_basis_points"
    AND "upper_basis_points" <= 10000
  )
);

CREATE TABLE "target_instrument" (
  "id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "market" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "within_asset_points" INTEGER NOT NULL,
  CONSTRAINT "target_instrument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "target_instrument_points_check" CHECK (0 <= "within_asset_points" AND "within_asset_points" <= 10000)
);

CREATE TABLE "collection_run" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "status" "CollectionRunStatus" NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "app_version" TEXT NOT NULL,
  "adapter_version" TEXT NOT NULL,
  "error_code" TEXT,
  CONSTRAINT "collection_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "collection_run_time_check" CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at")
);

CREATE TABLE "raw_broker_response" (
  "id" UUID NOT NULL,
  "collection_run_id" UUID NOT NULL,
  "operation_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "request_id" TEXT,
  "http_status" INTEGER NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "redacted_body" JSONB NOT NULL,
  "body_sha256" CHAR(64) NOT NULL,
  "redaction_version" TEXT NOT NULL,
  CONSTRAINT "raw_broker_response_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_snapshot" (
  "id" UUID NOT NULL,
  "collection_run_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "target_config_version_id" UUID,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "persisted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validation_status" "SnapshotValidationStatus" NOT NULL,
  "base_currency" TEXT NOT NULL,
  "managed_cash_minor" BIGINT,
  "total_value_minor" BIGINT NOT NULL,
  "usd_krw_rate" TEXT,
  "digest" CHAR(64) NOT NULL,
  CONSTRAINT "portfolio_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portfolio_snapshot_total_check" CHECK ("total_value_minor" >= 0),
  CONSTRAINT "portfolio_snapshot_cash_check" CHECK ("managed_cash_minor" IS NULL OR "managed_cash_minor" >= 0)
);

CREATE TABLE "holding_snapshot" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "market" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "quantity" TEXT NOT NULL,
  "last_price" TEXT NOT NULL,
  "average_purchase_price" TEXT NOT NULL,
  "market_value" TEXT NOT NULL,
  "market_value_krw_minor" BIGINT NOT NULL,
  "raw_payload" JSONB NOT NULL,
  CONSTRAINT "holding_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "holding_snapshot_value_check" CHECK ("market_value_krw_minor" >= 0)
);

CREATE TABLE "snapshot_check" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "rule_code" TEXT NOT NULL,
  "subject_key" TEXT NOT NULL DEFAULT 'PORTFOLIO',
  "outcome" "CheckOutcome" NOT NULL,
  "detail" JSONB NOT NULL,
  "checked_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "snapshot_check_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runtime_lease" (
  "key" TEXT NOT NULL,
  "owner" UUID NOT NULL,
  "acquired_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "fencing_token" BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT "runtime_lease_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "runtime_lease_time_check" CHECK ("expires_at" > "acquired_at")
);

CREATE UNIQUE INDEX "broker_account_broker_external_ref_hmac_key" ON "broker_account"("broker", "external_ref_hmac");
CREATE UNIQUE INDEX "target_config_account_id_key" ON "target_config"("account_id");
CREATE UNIQUE INDEX "target_config_version_config_id_version_key" ON "target_config_version"("config_id", "version");
CREATE UNIQUE INDEX "target_config_version_config_id_content_hash_key" ON "target_config_version"("config_id", "content_hash");
CREATE UNIQUE INDEX "target_config_one_active_per_account" ON "target_config_version"("config_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "target_allocation_config_version_id_asset_key_key" ON "target_allocation"("config_version_id", "asset_key");
CREATE UNIQUE INDEX "target_instrument_allocation_id_market_symbol_key" ON "target_instrument"("allocation_id", "market", "symbol");
CREATE INDEX "collection_run_account_id_started_at_idx" ON "collection_run"("account_id", "started_at" DESC);
CREATE UNIQUE INDEX "raw_broker_response_collection_run_operation_ordinal_key" ON "raw_broker_response"("collection_run_id", "operation_id", "ordinal");
CREATE INDEX "raw_broker_response_request_id_idx" ON "raw_broker_response"("request_id");
CREATE UNIQUE INDEX "portfolio_snapshot_collection_run_id_key" ON "portfolio_snapshot"("collection_run_id");
CREATE INDEX "portfolio_snapshot_account_id_observed_at_idx" ON "portfolio_snapshot"("account_id", "observed_at" DESC);
CREATE UNIQUE INDEX "holding_snapshot_snapshot_id_market_symbol_key" ON "holding_snapshot"("snapshot_id", "market", "symbol");
CREATE UNIQUE INDEX "snapshot_check_snapshot_rule_subject_key" ON "snapshot_check"("snapshot_id", "rule_code", "subject_key");
CREATE INDEX "runtime_lease_expires_at_idx" ON "runtime_lease"("expires_at");

ALTER TABLE "target_config" ADD CONSTRAINT "target_config_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "broker_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "target_config_version" ADD CONSTRAINT "target_config_version_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "target_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "target_allocation" ADD CONSTRAINT "target_allocation_config_version_id_fkey" FOREIGN KEY ("config_version_id") REFERENCES "target_config_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "target_instrument" ADD CONSTRAINT "target_instrument_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "target_allocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collection_run" ADD CONSTRAINT "collection_run_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "broker_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "raw_broker_response" ADD CONSTRAINT "raw_broker_response_collection_run_id_fkey" FOREIGN KEY ("collection_run_id") REFERENCES "collection_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_collection_run_id_fkey" FOREIGN KEY ("collection_run_id") REFERENCES "collection_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "broker_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "portfolio_snapshot" ADD CONSTRAINT "portfolio_snapshot_target_config_version_id_fkey" FOREIGN KEY ("target_config_version_id") REFERENCES "target_config_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holding_snapshot" ADD CONSTRAINT "holding_snapshot_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "snapshot_check" ADD CONSTRAINT "snapshot_check_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION reject_immutable_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % cannot be changed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER raw_broker_response_immutable BEFORE UPDATE OR DELETE ON "raw_broker_response" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER portfolio_snapshot_immutable BEFORE UPDATE OR DELETE ON "portfolio_snapshot" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER holding_snapshot_immutable BEFORE UPDATE OR DELETE ON "holding_snapshot" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER snapshot_check_immutable BEFORE UPDATE OR DELETE ON "snapshot_check" FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
