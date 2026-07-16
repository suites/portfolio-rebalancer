CREATE TABLE "buying_power_snapshot" (
  "id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" TEXT NOT NULL,
  "value_krw_minor" BIGINT NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "valuation_eligible" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "buying_power_snapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "buying_power_snapshot_value_check" CHECK ("value_krw_minor" >= 0)
);

CREATE UNIQUE INDEX "buying_power_snapshot_snapshot_id_currency_key"
ON "buying_power_snapshot"("snapshot_id", "currency");

ALTER TABLE "buying_power_snapshot"
ADD CONSTRAINT "buying_power_snapshot_snapshot_id_fkey"
FOREIGN KEY ("snapshot_id") REFERENCES "portfolio_snapshot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER buying_power_snapshot_immutable
BEFORE UPDATE OR DELETE ON "buying_power_snapshot"
FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
