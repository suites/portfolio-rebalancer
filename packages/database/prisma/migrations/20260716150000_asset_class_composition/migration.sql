ALTER TABLE "target_allocation"
ADD COLUMN "composition_policy" JSONB;

UPDATE "target_allocation"
SET "composition_policy" =
  CASE
    WHEN "asset_key" = 'CASH' THEN
      jsonb_build_object(
        'mode', 'NONE',
        'version', 'CASH_V1'
      )
    ELSE
      jsonb_build_object(
        'mode', 'LEGACY_SINGLE',
        'version', 'LEGACY_V1'
      )
  END;

ALTER TABLE "target_allocation"
ALTER COLUMN "composition_policy" SET NOT NULL;
