import { BASIS_POINT_SCALE } from "./allocation";

export const AUTO_BAND_POLICY_VERSION = "MIXED_V1" as const;
const MAX_ALLOWED_DRIFT_BASIS_POINTS = 500n;

export interface ResolvedAllocationBand {
  readonly policyVersion: typeof AUTO_BAND_POLICY_VERSION;
  readonly allowedDriftBasisPoints: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
}

export function resolveAutoAllocationBand(targetBasisPoints: bigint): ResolvedAllocationBand {
  if (targetBasisPoints < 0n || targetBasisPoints > BASIS_POINT_SCALE) {
    throw new Error("목표 비중은 0bp 이상 10000bp 이하여야 합니다.");
  }

  const relativeDrift = (targetBasisPoints + 3n) / 4n;
  const allowedDriftBasisPoints =
    relativeDrift < MAX_ALLOWED_DRIFT_BASIS_POINTS ? relativeDrift : MAX_ALLOWED_DRIFT_BASIS_POINTS;

  return {
    policyVersion: AUTO_BAND_POLICY_VERSION,
    allowedDriftBasisPoints,
    lowerBasisPoints:
      targetBasisPoints > allowedDriftBasisPoints
        ? targetBasisPoints - allowedDriftBasisPoints
        : 0n,
    upperBasisPoints:
      targetBasisPoints + allowedDriftBasisPoints < BASIS_POINT_SCALE
        ? targetBasisPoints + allowedDriftBasisPoints
        : BASIS_POINT_SCALE,
  };
}
