import { BASIS_POINT_SCALE, calculateAllocationSnapshot } from "./allocation";

export type RebalanceReturnPolicy = "BAND_EDGE" | "TARGET";
export type RebalanceReason = "IN_RANGE" | "BELOW_LOWER" | "ABOVE_UPPER";

export interface RebalanceAssetInput {
  readonly id: string;
  readonly valueMinor: bigint;
  readonly targetBasisPoints: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
}

export interface RebalanceAssetDecision extends RebalanceAssetInput {
  readonly reason: RebalanceReason;
  readonly desiredValueMinor: bigint;
  readonly deltaMinor: bigint;
}

export interface RebalanceTargetResult {
  readonly policy: RebalanceReturnPolicy;
  readonly totalValueMinor: bigint;
  readonly decisions: readonly RebalanceAssetDecision[];
}

export interface CashPriorityCandidate {
  readonly id: string;
  readonly requestedMinor: bigint;
}

export interface CashAllocation {
  readonly id: string;
  readonly requestedMinor: bigint;
  readonly allocatedMinor: bigint;
  readonly remainingNeedMinor: bigint;
}

export interface SpendableCashAllocation {
  readonly spendableCashMinor: bigint;
  readonly allocatedMinor: bigint;
  readonly remainingCashMinor: bigint;
  readonly allocations: readonly CashAllocation[];
}

export interface KrOrderRoundingInput {
  readonly id: string;
  readonly side: "BUY" | "SELL";
  readonly desiredNotionalMinor: bigint;
  readonly priceMinor: bigint;
  readonly minimumOrderMinor: bigint;
  readonly availableQuantity?: bigint;
}

export type RoundedKrOrder =
  | {
      readonly id: string;
      readonly side: "BUY" | "SELL";
      readonly status: "ORDERABLE";
      readonly quantity: bigint;
      readonly notionalMinor: bigint;
      readonly unallocatedMinor: bigint;
    }
  | {
      readonly id: string;
      readonly side: "BUY" | "SELL";
      readonly status: "BELOW_MINIMUM" | "ZERO_QUANTITY";
      readonly quantity: 0n;
      readonly notionalMinor: 0n;
      readonly unallocatedMinor: bigint;
    };

export interface ProjectedAllocationInput extends RebalanceAssetInput {
  readonly deltaMinor: bigint;
}

export interface ProjectedAllocation {
  readonly id: string;
  readonly valueMinor: bigint;
  readonly targetBasisPoints: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
  readonly currentBasisPoints: bigint;
  readonly driftBasisPoints: bigint;
  readonly outsideBand: boolean;
}

export interface ProjectedAllocationResult {
  readonly totalValueMinor: bigint;
  readonly allocations: readonly ProjectedAllocation[];
}

/**
 * Calculates desired asset values without making any broker or clock call.
 *
 * BAND_EDGE moves only assets outside their allowed range to the nearest edge.
 * TARGET uses largest-remainder allocation so desired values add up to the
 * exact portfolio total. Cash availability and execution phases are applied
 * separately; expected sell proceeds are never assumed here.
 */
export function calculateRebalanceTargets(
  inputs: readonly RebalanceAssetInput[],
  policy: RebalanceReturnPolicy,
): RebalanceTargetResult {
  validateRebalanceAssets(inputs);
  const snapshot = calculateAllocationSnapshot(inputs);
  const targetValues =
    policy === "TARGET"
      ? allocateExactTargetValues(inputs, snapshot.totalValueMinor)
      : new Map<string, bigint>();

  return {
    policy,
    totalValueMinor: snapshot.totalValueMinor,
    decisions: inputs.map((input) => {
      const reason = classifyBand(input, snapshot.totalValueMinor);
      const desiredValueMinor =
        policy === "TARGET"
          ? getRequiredMapValue(targetValues, input.id)
          : desiredBandEdgeValue(input, reason, snapshot.totalValueMinor);
      return {
        ...input,
        reason,
        desiredValueMinor,
        deltaMinor: desiredValueMinor - input.valueMinor,
      };
    }),
  };
}

/**
 * Applies newly available cash only to existing buy needs. Larger shortages
 * are filled first; ties use the stable asset id. The caller remains
 * responsible for retaining target cash, reservations and the fee buffer
 * before passing spendableCashMinor.
 */
export function allocateSpendableCash(
  candidates: readonly CashPriorityCandidate[],
  spendableCashMinor: bigint,
): SpendableCashAllocation {
  if (spendableCashMinor < 0n) {
    throw new Error("사용 가능 현금은 음수일 수 없습니다.");
  }
  validateUniqueIds(
    candidates.map(({ id }) => id),
    "현금 배분 후보",
  );
  if (candidates.some(({ requestedMinor }) => requestedMinor < 0n)) {
    throw new Error("매수 필요 금액은 음수일 수 없습니다.");
  }

  let remainingCashMinor = spendableCashMinor;
  const sorted = [...candidates].sort(
    (left, right) =>
      compareBigIntDescending(left.requestedMinor, right.requestedMinor) ||
      compareText(left.id, right.id),
  );
  const byId = new Map<string, CashAllocation>();
  for (const candidate of sorted) {
    const allocatedMinor =
      candidate.requestedMinor < remainingCashMinor ? candidate.requestedMinor : remainingCashMinor;
    remainingCashMinor -= allocatedMinor;
    byId.set(candidate.id, {
      id: candidate.id,
      requestedMinor: candidate.requestedMinor,
      allocatedMinor,
      remainingNeedMinor: candidate.requestedMinor - allocatedMinor,
    });
  }

  return {
    spendableCashMinor,
    allocatedMinor: spendableCashMinor - remainingCashMinor,
    remainingCashMinor,
    allocations: candidates.map(({ id }) => getRequiredMapValue(byId, id)),
  };
}

/**
 * First-live-market rounding policy: Korean orders use positive integer shares.
 * Quantity is always rounded down so a buy cannot overspend and a sell cannot
 * dispose of more than the calculated candidate. Post-rounding allocation must
 * be checked separately.
 */
export function roundKrOrder(input: KrOrderRoundingInput): RoundedKrOrder {
  validateNonEmptyId(input.id, "주문 후보");
  if (input.desiredNotionalMinor < 0n || input.priceMinor <= 0n || input.minimumOrderMinor < 0n) {
    throw new Error("주문 금액과 최소 주문금액은 음수가 아니고 가격은 0보다 커야 합니다.");
  }
  if (input.availableQuantity !== undefined && input.availableQuantity < 0n) {
    throw new Error("매도 가능 수량은 음수일 수 없습니다.");
  }

  const quantity = input.desiredNotionalMinor / input.priceMinor;
  if (quantity === 0n) {
    return {
      id: input.id,
      side: input.side,
      status: "ZERO_QUANTITY",
      quantity: 0n,
      notionalMinor: 0n,
      unallocatedMinor: input.desiredNotionalMinor,
    };
  }
  if (
    input.side === "SELL" &&
    input.availableQuantity !== undefined &&
    quantity > input.availableQuantity
  ) {
    throw new Error(`${input.id}의 계산 수량이 매도 가능 수량을 초과합니다.`);
  }

  const notionalMinor = quantity * input.priceMinor;
  if (notionalMinor < input.minimumOrderMinor) {
    return {
      id: input.id,
      side: input.side,
      status: "BELOW_MINIMUM",
      quantity: 0n,
      notionalMinor: 0n,
      unallocatedMinor: input.desiredNotionalMinor,
    };
  }
  return {
    id: input.id,
    side: input.side,
    status: "ORDERABLE",
    quantity,
    notionalMinor,
    unallocatedMinor: input.desiredNotionalMinor - notionalMinor,
  };
}

export function projectAllocationAfterRoundedTrades(
  inputs: readonly ProjectedAllocationInput[],
): ProjectedAllocationResult {
  const projectedInputs = inputs.map(({ deltaMinor, ...input }) => {
    const valueMinor = input.valueMinor + deltaMinor;
    if (valueMinor < 0n) {
      throw new Error(`${input.id}의 예상 평가액이 음수가 됩니다.`);
    }
    return { ...input, valueMinor };
  });
  validateRebalanceAssets(projectedInputs);
  const snapshot = calculateAllocationSnapshot(projectedInputs);
  return {
    totalValueMinor: snapshot.totalValueMinor,
    allocations: snapshot.allocations.map((allocation) => {
      const source = projectedInputs.find(({ id }) => id === allocation.id);
      if (!source) throw new Error(`예상 비중 입력을 찾을 수 없습니다: ${allocation.id}`);
      return {
        id: allocation.id,
        valueMinor: allocation.valueMinor,
        targetBasisPoints: allocation.targetBasisPoints,
        lowerBasisPoints: source.lowerBasisPoints,
        upperBasisPoints: source.upperBasisPoints,
        currentBasisPoints: allocation.currentBasisPoints,
        driftBasisPoints: allocation.driftBasisPoints,
        outsideBand: classifyBand(source, snapshot.totalValueMinor) !== "IN_RANGE",
      };
    }),
  };
}

function validateRebalanceAssets(inputs: readonly RebalanceAssetInput[]): void {
  if (inputs.length === 0) throw new Error("리밸런싱할 자산이 없습니다.");
  validateUniqueIds(
    inputs.map(({ id }) => id),
    "리밸런싱 자산",
  );
  for (const input of inputs) {
    if (
      input.valueMinor < 0n ||
      input.lowerBasisPoints < 0n ||
      input.lowerBasisPoints > input.targetBasisPoints ||
      input.targetBasisPoints > input.upperBasisPoints ||
      input.upperBasisPoints > BASIS_POINT_SCALE
    ) {
      throw new Error(`${input.id}의 평가액, 목표 비중 또는 허용 범위가 올바르지 않습니다.`);
    }
  }
}

function classifyBand(input: RebalanceAssetInput, totalValueMinor: bigint): RebalanceReason {
  const scaledValue = input.valueMinor * BASIS_POINT_SCALE;
  if (scaledValue < input.lowerBasisPoints * totalValueMinor) return "BELOW_LOWER";
  if (scaledValue > input.upperBasisPoints * totalValueMinor) return "ABOVE_UPPER";
  return "IN_RANGE";
}

function desiredBandEdgeValue(
  input: RebalanceAssetInput,
  reason: RebalanceReason,
  totalValueMinor: bigint,
): bigint {
  if (reason === "BELOW_LOWER") {
    return ceilDivide(input.lowerBasisPoints * totalValueMinor, BASIS_POINT_SCALE);
  }
  if (reason === "ABOVE_UPPER") {
    return (input.upperBasisPoints * totalValueMinor) / BASIS_POINT_SCALE;
  }
  return input.valueMinor;
}

function allocateExactTargetValues(
  inputs: readonly RebalanceAssetInput[],
  totalValueMinor: bigint,
): ReadonlyMap<string, bigint> {
  const provisional = inputs.map((input) => {
    const scaled = totalValueMinor * input.targetBasisPoints;
    return {
      id: input.id,
      valueMinor: scaled / BASIS_POINT_SCALE,
      remainder: scaled % BASIS_POINT_SCALE,
    };
  });
  const assigned = provisional.reduce((sum, item) => sum + item.valueMinor, 0n);
  const remaining = Number(totalValueMinor - assigned);
  const bonusIds = new Set(
    [...provisional]
      .sort(
        (left, right) =>
          compareBigIntDescending(left.remainder, right.remainder) ||
          compareText(left.id, right.id),
      )
      .slice(0, remaining)
      .map(({ id }) => id),
  );
  return new Map(
    provisional.map(({ id, valueMinor }) => [id, valueMinor + (bonusIds.has(id) ? 1n : 0n)]),
  );
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function validateUniqueIds(ids: readonly string[], subject: string): void {
  ids.forEach((id) => validateNonEmptyId(id, subject));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${subject} ID는 서로 달라야 합니다.`);
  }
}

function validateNonEmptyId(id: string, subject: string): void {
  if (id.trim().length === 0) throw new Error(`${subject} ID는 비어 있을 수 없습니다.`);
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getRequiredMapValue<Key, Value>(map: ReadonlyMap<Key, Value>, key: Key): Value {
  const value = map.get(key);
  if (value === undefined) throw new Error(`필수 계산 결과를 찾을 수 없습니다: ${String(key)}`);
  return value;
}
