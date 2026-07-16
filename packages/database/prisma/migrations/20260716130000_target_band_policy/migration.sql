ALTER TABLE "target_allocation"
ADD COLUMN "band_policy" JSONB;

UPDATE "target_allocation"
SET "band_policy" = jsonb_build_object(
  'mode', 'CUSTOM',
  'version', 'LEGACY_V1',
  'lowerBasisPoints', "lower_basis_points",
  'upperBasisPoints', "upper_basis_points"
);

ALTER TABLE "target_allocation"
ALTER COLUMN "band_policy" SET NOT NULL;
