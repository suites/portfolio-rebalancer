CREATE TABLE "instrument_catalog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "broker" TEXT NOT NULL,
  "market_country" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "listing_market" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "english_name" TEXT,
  "isin_code" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "security_type" TEXT NOT NULL,
  "listing_status" TEXT NOT NULL,
  "last_validation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "instrument_catalog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instrument_catalog_broker_check"
    CHECK ("broker" = 'toss'),
  CONSTRAINT "instrument_catalog_market_country_check"
    CHECK ("market_country" IN ('KR', 'US')),
  CONSTRAINT "instrument_catalog_currency_check"
    CHECK ("currency" IN ('KRW', 'USD'))
);

CREATE UNIQUE INDEX "instrument_catalog_broker_market_country_symbol_key"
ON "instrument_catalog" ("broker", "market_country", "symbol");

CREATE UNIQUE INDEX "instrument_catalog_last_validation_id_key"
ON "instrument_catalog" ("last_validation_id");

CREATE INDEX "instrument_catalog_name_idx"
ON "instrument_catalog" ("name");

CREATE INDEX "instrument_catalog_english_name_idx"
ON "instrument_catalog" ("english_name");

CREATE TABLE "instrument_validation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "catalog_id" UUID NOT NULL,
  "requested_market_country" TEXT NOT NULL,
  "requested_symbol" TEXT NOT NULL,
  "provider_api_version" TEXT NOT NULL,
  "market_country" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "listing_market" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "english_name" TEXT,
  "isin_code" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "security_type" TEXT NOT NULL,
  "is_common_share" BOOLEAN NOT NULL,
  "listing_status" TEXT NOT NULL,
  "list_date" TEXT,
  "delist_date" TEXT,
  "shares_outstanding" TEXT NOT NULL,
  "leverage_factor" TEXT,
  "liquidation_trading" BOOLEAN,
  "nxt_supported" BOOLEAN,
  "krx_trading_suspended" BOOLEAN,
  "nxt_trading_suspended" BOOLEAN,
  "target_eligibility" TEXT NOT NULL,
  "target_reason_codes" JSONB NOT NULL,
  "trade_blocked_now" BOOLEAN NOT NULL,
  "trade_reason_codes" JSONB NOT NULL,
  "requires_order_revalidation" BOOLEAN NOT NULL,
  "stock_payload" JSONB NOT NULL,
  "warnings_payload" JSONB NOT NULL,
  "stock_payload_sha256" CHAR(64) NOT NULL,
  "warnings_payload_sha256" CHAR(64) NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "instrument_validation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instrument_validation_requested_market_country_check"
    CHECK ("requested_market_country" IN ('KR', 'US')),
  CONSTRAINT "instrument_validation_market_country_check"
    CHECK ("market_country" IN ('KR', 'US')),
  CONSTRAINT "instrument_validation_currency_check"
    CHECK ("currency" IN ('KRW', 'USD')),
  CONSTRAINT "instrument_validation_target_eligibility_check"
    CHECK ("target_eligibility" IN ('ELIGIBLE', 'BLOCKED')),
  CONSTRAINT "instrument_validation_catalog_id_fkey"
    FOREIGN KEY ("catalog_id") REFERENCES "instrument_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "instrument_validation_market_country_symbol_observed_at_idx"
ON "instrument_validation" ("market_country", "symbol", "observed_at" DESC);

ALTER TABLE "instrument_catalog"
ADD CONSTRAINT "instrument_catalog_last_validation_id_fkey"
FOREIGN KEY ("last_validation_id") REFERENCES "instrument_validation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "target_instrument"
ADD COLUMN "validation_id" UUID,
ADD COLUMN "name" TEXT,
ADD COLUMN "english_name" TEXT;

UPDATE "target_instrument"
SET "name" = "symbol"
WHERE "name" IS NULL;

ALTER TABLE "target_instrument"
ALTER COLUMN "name" SET NOT NULL;

CREATE INDEX "target_instrument_validation_id_idx"
ON "target_instrument" ("validation_id");

ALTER TABLE "target_instrument"
ADD CONSTRAINT "target_instrument_validation_id_fkey"
FOREIGN KEY ("validation_id") REFERENCES "instrument_validation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER instrument_validation_immutable
BEFORE UPDATE OR DELETE ON "instrument_validation"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
