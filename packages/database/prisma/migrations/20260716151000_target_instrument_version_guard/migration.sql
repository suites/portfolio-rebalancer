BEGIN;

ALTER TABLE "target_instrument"
ADD COLUMN "config_version_id" UUID;

UPDATE "target_instrument" AS "instrument"
SET "config_version_id" = "allocation"."config_version_id"
FROM "target_allocation" AS "allocation"
WHERE "allocation"."id" = "instrument"."allocation_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "target_instrument"
    WHERE "config_version_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'target_instrument config_version_id backfill failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "target_instrument"
    GROUP BY "config_version_id", "market", "symbol"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate instrument assignments exist within a target config version';
  END IF;
END
$$;

ALTER TABLE "target_instrument"
ALTER COLUMN "config_version_id" SET NOT NULL;

ALTER TABLE "target_allocation"
ADD CONSTRAINT "target_allocation_id_config_version_id_key"
UNIQUE ("id", "config_version_id");

ALTER TABLE "target_instrument"
DROP CONSTRAINT "target_instrument_allocation_id_fkey";

ALTER TABLE "target_instrument"
ADD CONSTRAINT "target_instrument_allocation_id_config_version_id_fkey"
FOREIGN KEY ("allocation_id", "config_version_id")
REFERENCES "target_allocation" ("id", "config_version_id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE UNIQUE INDEX "target_instrument_config_version_id_market_symbol_key"
ON "target_instrument" ("config_version_id", "market", "symbol");

COMMIT;
