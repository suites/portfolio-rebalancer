ALTER TABLE "target_config_version"
ADD COLUMN "cash_policy" JSONB;

UPDATE "target_config_version"
SET "cash_policy" = jsonb_build_object(
  'mode', 'UNSET',
  'version', 'LEGACY_V1'
);

ALTER TABLE "target_config_version"
ALTER COLUMN "cash_policy" SET NOT NULL;

ALTER TABLE "portfolio_snapshot"
ADD COLUMN "securities_value_minor" BIGINT;

ALTER TABLE "portfolio_snapshot"
DISABLE TRIGGER "portfolio_snapshot_immutable";

UPDATE "portfolio_snapshot"
SET "securities_value_minor" =
  "total_value_minor" - COALESCE("managed_cash_minor", 0);

ALTER TABLE "portfolio_snapshot"
ENABLE TRIGGER "portfolio_snapshot_immutable";

ALTER TABLE "portfolio_snapshot"
ALTER COLUMN "securities_value_minor" SET NOT NULL;

ALTER TABLE "portfolio_snapshot"
ADD CONSTRAINT "portfolio_snapshot_securities_value_check"
CHECK ("securities_value_minor" >= 0);

ALTER TABLE "portfolio_snapshot"
ADD CONSTRAINT "portfolio_snapshot_value_components_check"
CHECK (
  "total_value_minor" =
  "securities_value_minor" + COALESCE("managed_cash_minor", 0)
);
