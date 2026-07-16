CREATE TABLE "price_snapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "snapshot_id" UUID NOT NULL,
  "request_attempt_id" UUID,
  "market_country" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "last_price" TEXT NOT NULL,
  "provider_observed_at" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "price_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "price_snapshot_identity_check" CHECK (
    "market_country" IN ('KR', 'US')
    AND BTRIM("symbol") <> ''
  ),
  CONSTRAINT "price_snapshot_market_currency_check" CHECK (
    ("market_country" = 'KR' AND "currency" = 'KRW')
    OR ("market_country" = 'US' AND "currency" = 'USD')
  ),
  CONSTRAINT "price_snapshot_price_check" CHECK (
    "last_price" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
    AND "last_price"::NUMERIC > 0
  ),
  CONSTRAINT "price_snapshot_time_check" CHECK (
    "provider_observed_at" IS NULL
    OR "provider_observed_at" <= "received_at" + INTERVAL '60 seconds'
  )
);

CREATE TABLE "market_calendar_snapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "snapshot_id" UUID NOT NULL,
  "request_attempt_id" UUID,
  "market_country" TEXT NOT NULL,
  "requested_date" DATE NOT NULL,
  "calendar" JSONB NOT NULL,
  "calendar_sha256" CHAR(64) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "market_calendar_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_calendar_snapshot_market_check" CHECK (
    "market_country" IN ('KR', 'US')
  ),
  CONSTRAINT "market_calendar_snapshot_json_check" CHECK (
    (
      JSONB_TYPEOF("calendar") = 'object'
      AND JSONB_TYPEOF("calendar"->'today') = 'object'
      AND JSONB_TYPEOF("calendar"->'previousBusinessDay') = 'object'
      AND JSONB_TYPEOF("calendar"->'nextBusinessDay') = 'object'
      AND JSONB_TYPEOF("calendar"->'today'->'sessions') = 'array'
      AND JSONB_TYPEOF("calendar"->'previousBusinessDay'->'sessions') = 'array'
      AND JSONB_TYPEOF("calendar"->'nextBusinessDay'->'sessions') = 'array'
      AND "calendar"->>'marketCountry' = "market_country"
      AND "calendar"->'today'->>'date' = "requested_date"::TEXT
      AND "calendar"->'previousBusinessDay'->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND "calendar"->'nextBusinessDay'->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ) IS TRUE
  ),
  CONSTRAINT "market_calendar_snapshot_sha_check" CHECK (
    "calendar_sha256" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "price_snapshot_snapshot_market_symbol_key"
ON "price_snapshot"("snapshot_id", "market_country", "symbol");

CREATE INDEX "price_snapshot_request_attempt_id_idx"
ON "price_snapshot"("request_attempt_id");

CREATE UNIQUE INDEX "market_calendar_snapshot_snapshot_market_key"
ON "market_calendar_snapshot"("snapshot_id", "market_country");

CREATE INDEX "market_calendar_snapshot_request_attempt_id_idx"
ON "market_calendar_snapshot"("request_attempt_id");

ALTER TABLE "price_snapshot"
ADD CONSTRAINT "price_snapshot_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES "portfolio_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "price_snapshot"
ADD CONSTRAINT "price_snapshot_request_attempt_id_fkey"
FOREIGN KEY ("request_attempt_id")
REFERENCES "broker_request_attempt"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "market_calendar_snapshot"
ADD CONSTRAINT "market_calendar_snapshot_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id")
REFERENCES "portfolio_snapshot"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "market_calendar_snapshot"
ADD CONSTRAINT "market_calendar_snapshot_request_attempt_id_fkey"
FOREIGN KEY ("request_attempt_id")
REFERENCES "broker_request_attempt"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TRIGGER price_snapshot_immutable
BEFORE UPDATE OR DELETE ON "price_snapshot"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE TRIGGER market_calendar_snapshot_immutable
BEFORE UPDATE OR DELETE ON "market_calendar_snapshot"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

CREATE FUNCTION require_running_collection_run() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "collection_run"
    WHERE "id" = NEW."collection_run_id"
      AND "status" = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'collection evidence can only be inserted while the collection run is RUNNING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION require_running_collection_snapshot() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "portfolio_snapshot" AS snapshot
    JOIN "collection_run" AS run
      ON run."id" = snapshot."collection_run_id"
    WHERE snapshot."id" = NEW."snapshot_id"
      AND run."status" = 'RUNNING'
  ) THEN
    RAISE EXCEPTION 'snapshot evidence can only be inserted while the collection run is RUNNING';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER raw_broker_response_insert_while_running
BEFORE INSERT ON "raw_broker_response"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_run();

CREATE TRIGGER portfolio_snapshot_insert_while_running
BEFORE INSERT ON "portfolio_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_run();

CREATE TRIGGER holding_snapshot_insert_while_running
BEFORE INSERT ON "holding_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot();

CREATE TRIGGER buying_power_snapshot_insert_while_running
BEFORE INSERT ON "buying_power_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot();

CREATE TRIGGER price_snapshot_insert_while_running
BEFORE INSERT ON "price_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot();

CREATE TRIGGER market_calendar_snapshot_insert_while_running
BEFORE INSERT ON "market_calendar_snapshot"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot();

CREATE TRIGGER snapshot_check_insert_while_running
BEFORE INSERT ON "snapshot_check"
FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot();
