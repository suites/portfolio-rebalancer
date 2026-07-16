import { BASIS_POINT_SCALE } from "./allocation";

export const PRESERVE_CURRENT_WITHIN_ASSET_POLICY_VERSION = "PRESERVE_CURRENT_V1" as const;

export interface WithinAssetValueInput {
  readonly instrumentKey: string;
  readonly valueMinor: bigint;
}

export interface ResolvedWithinAssetInstrument {
  readonly instrumentKey: string;
  readonly withinAssetPoints: bigint;
}

export interface ResolvedWithinAssetAllocation {
  readonly policyVersion: typeof PRESERVE_CURRENT_WITHIN_ASSET_POLICY_VERSION;
  readonly instruments: readonly ResolvedWithinAssetInstrument[];
}

export function resolvePreserveCurrentWithinAssetPoints(
  inputs: readonly WithinAssetValueInput[],
): ResolvedWithinAssetAllocation {
  if (inputs.length === 0) {
    throw new Error("자산군에 구성 종목이 없습니다.");
  }
  const sorted = [...inputs].sort((left, right) =>
    compareText(left.instrumentKey, right.instrumentKey),
  );
  if (sorted.some(({ instrumentKey }) => instrumentKey.trim().length === 0)) {
    throw new Error("종목 키는 비어 있을 수 없습니다.");
  }
  if (new Set(sorted.map(({ instrumentKey }) => instrumentKey)).size !== sorted.length) {
    throw new Error("종목 키는 서로 달라야 합니다.");
  }
  if (sorted.some(({ valueMinor }) => valueMinor < 0n)) {
    throw new Error("종목 평가액은 음수일 수 없습니다.");
  }

  const totalValueMinor = sorted.reduce((sum, item) => sum + item.valueMinor, 0n);
  if (totalValueMinor <= 0n) {
    throw new Error("현재 평가액 합계가 0인 자산군에는 현재 비중 유지 정책을 적용할 수 없습니다.");
  }

  const provisional = sorted.map((item) => {
    const scaledValue = item.valueMinor * BASIS_POINT_SCALE;
    return {
      instrumentKey: item.instrumentKey,
      withinAssetPoints: scaledValue / totalValueMinor,
      remainder: scaledValue % totalValueMinor,
    };
  });
  const assigned = provisional.reduce((sum, item) => sum + item.withinAssetPoints, 0n);
  const remaining = Number(BASIS_POINT_SCALE - assigned);
  const bonusIds = new Set(
    [...provisional]
      .sort(
        (left, right) =>
          compareBigIntDescending(left.remainder, right.remainder) ||
          compareText(left.instrumentKey, right.instrumentKey),
      )
      .slice(0, remaining)
      .map(({ instrumentKey }) => instrumentKey),
  );

  return {
    policyVersion: PRESERVE_CURRENT_WITHIN_ASSET_POLICY_VERSION,
    instruments: provisional.map(({ instrumentKey, withinAssetPoints }) => ({
      instrumentKey,
      withinAssetPoints: withinAssetPoints + (bonusIds.has(instrumentKey) ? 1n : 0n),
    })),
  };
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
