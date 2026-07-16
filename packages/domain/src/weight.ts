import { BASIS_POINT_SCALE } from "./allocation";

export interface Weight {
  readonly basisPoints: bigint;
}

export function weightFromBasisPoints(basisPoints: bigint): Weight {
  if (basisPoints < 0n || basisPoints > BASIS_POINT_SCALE) {
    throw new Error("비중은 0bp 이상 10000bp 이하여야 합니다.");
  }
  return { basisPoints };
}

export function weightFromValue(valueMinor: bigint, totalValueMinor: bigint): Weight {
  if (valueMinor < 0n || totalValueMinor <= 0n || valueMinor > totalValueMinor) {
    throw new Error("평가액은 0 이상이고 전체 평가액 이하이며 전체 평가액은 0보다 커야 합니다.");
  }
  return weightFromBasisPoints((valueMinor * BASIS_POINT_SCALE) / totalValueMinor);
}
