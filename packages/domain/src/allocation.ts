export const BASIS_POINT_SCALE = 10_000n;

export interface AllocationInput {
  readonly id: string;
  readonly valueMinor: bigint;
  readonly targetBasisPoints: bigint;
}

export interface AllocationResult extends AllocationInput {
  readonly currentBasisPoints: bigint;
  readonly driftBasisPoints: bigint;
}

export interface AllocationSnapshot {
  readonly totalValueMinor: bigint;
  readonly allocations: readonly AllocationResult[];
}

export interface AllocationBandInput {
  readonly valueMinor: bigint;
  readonly totalValueMinor: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
}

export function calculateAllocationSnapshot(
  inputs: readonly AllocationInput[],
): AllocationSnapshot {
  if (inputs.length === 0) {
    throw new Error("평가할 자산이 없습니다.");
  }
  const ids = inputs.map(({ id }) => id);
  if (ids.some((id) => id.trim().length === 0) || new Set(ids).size !== ids.length) {
    throw new Error("자산 ID는 비어 있지 않고 서로 달라야 합니다.");
  }
  if (
    inputs.some(({ valueMinor, targetBasisPoints }) => valueMinor < 0n || targetBasisPoints < 0n)
  ) {
    throw new Error("자산 평가액과 목표 비중은 음수일 수 없습니다.");
  }

  const targetTotal = inputs.reduce((sum, item) => sum + item.targetBasisPoints, 0n);
  if (targetTotal !== BASIS_POINT_SCALE) {
    throw new Error(`목표 비중 합계가 10000bp가 아닙니다: ${targetTotal}bp`);
  }

  const totalValueMinor = inputs.reduce((sum, item) => sum + item.valueMinor, 0n);
  if (totalValueMinor <= 0n) {
    throw new Error("포트폴리오 평가액은 0보다 커야 합니다.");
  }

  return {
    totalValueMinor,
    allocations: inputs.map((item) => {
      const currentBasisPoints = (item.valueMinor * BASIS_POINT_SCALE) / totalValueMinor;
      return {
        ...item,
        currentBasisPoints,
        driftBasisPoints: currentBasisPoints - item.targetBasisPoints,
      };
    }),
  };
}

export function isOutsideAllocationBand({
  valueMinor,
  totalValueMinor,
  lowerBasisPoints,
  upperBasisPoints,
}: AllocationBandInput): boolean {
  if (valueMinor < 0n || totalValueMinor <= 0n) {
    throw new Error("자산 평가액은 음수가 아니고 전체 평가액은 0보다 커야 합니다.");
  }
  if (
    lowerBasisPoints < 0n ||
    lowerBasisPoints > upperBasisPoints ||
    upperBasisPoints > BASIS_POINT_SCALE
  ) {
    throw new Error("허용 비중 범위는 0bp 이상 10000bp 이하이며 하한이 상한보다 클 수 없습니다.");
  }

  const exactScaledValue = valueMinor * BASIS_POINT_SCALE;
  return (
    exactScaledValue < lowerBasisPoints * totalValueMinor ||
    exactScaledValue > upperBasisPoints * totalValueMinor
  );
}
