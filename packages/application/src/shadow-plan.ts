import { createHash } from "node:crypto";

import {
  BASIS_POINT_SCALE,
  allocateSpendableCash,
  calculateRebalanceTargets,
  projectAllocationAfterRoundedTrades,
  roundKrOrder,
  type ProjectedAllocation,
  type RebalanceReason,
  type RebalanceReturnPolicy,
  type RoundedKrOrder,
} from "@portfolio-rebalancer/domain";

export const SHADOW_PLAN_CANONICAL_VERSION = "SHADOW_PLAN_V1" as const;

export type ShadowPlanStatus = "NO_ACTION" | "PLANNED" | "BLOCKED";

export type ShadowPlanReasonCode =
  | "NO_REBALANCE_NEEDED"
  | "REBALANCE_NEEDS_NO_ORDER_CANDIDATE"
  | "NO_EXECUTABLE_ORDER_AFTER_ROUNDING"
  | "SELL_PHASE_READY"
  | "BUY_PHASE_READY"
  | "BUY_PHASE_DEFERRED"
  | "BUY_NEEDS_REMAIN"
  | "IDENTITY_MISSING"
  | "IDENTITY_MISMATCH"
  | "MANAGED_CASH_UNSET"
  | "CASH_INPUT_INVALID"
  | "CASH_ASSET_INVALID"
  | "PORTFOLIO_TOTAL_INVALID"
  | "ASSET_INPUT_INVALID"
  | "ASSET_VALUE_MISMATCH"
  | "WITHIN_ASSET_ALLOCATION_INVALID"
  | "DUPLICATE_ASSET_CLASS"
  | "DUPLICATE_INSTRUMENT"
  | "INSTRUMENT_INPUT_INVALID"
  | "INSTRUMENT_VALUE_MISMATCH"
  | "PRICE_MISSING_OR_INVALID"
  | "UNSUPPORTED_MARKET"
  | "UNSUPPORTED_CURRENCY"
  | "UNSUPPORTED_ORDER_PREREQUISITE"
  | "SELLABLE_QUANTITY_MISSING"
  | "SELLABLE_QUANTITY_INSUFFICIENT"
  | "CALCULATION_INPUT_INVALID";

export type DeferredBuyReasonCode =
  | "SELL_PHASE_MUST_RECONCILE"
  | "INSUFFICIENT_SPENDABLE_CASH"
  | "BUY_ZERO_QUANTITY"
  | "BUY_BELOW_MINIMUM"
  | "BUY_ROUNDING_REMAINDER";

export interface ShadowPlanIdentityInput {
  readonly pinnedSnapshotId: string | null;
  readonly currentSnapshotId: string | null;
  readonly pinnedSnapshotDigest: string | null;
  readonly currentSnapshotDigest: string | null;
  readonly pinnedConfigVersionId: string | null;
  readonly currentConfigVersionId: string | null;
}

export interface ShadowOrderPrerequisitesInput {
  readonly orderType: string;
  readonly timeInForce: string;
  readonly wholeSharesOnly: boolean;
}

export interface ShadowPlanInstrumentInput {
  readonly marketCountry: string;
  readonly currency: string;
  readonly symbol: string;
  readonly currentValueMinor: bigint;
  readonly targetWithinAssetPoints: bigint;
  readonly currentQuantity: bigint;
  readonly priceMinor: bigint | null;
  readonly availableSellQuantity?: bigint | null;
}

export interface ShadowPlanAssetClassInput {
  readonly id: string;
  readonly kind: "SECURITIES" | "CASH";
  readonly currentValueMinor: bigint;
  readonly targetBasisPoints: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
  readonly instruments: readonly ShadowPlanInstrumentInput[];
}

export interface CreateShadowPlanInput {
  readonly identity: ShadowPlanIdentityInput;
  readonly assetClasses: readonly ShadowPlanAssetClassInput[];
  readonly managedCashMinor: bigint | null;
  readonly spendableCashMinor: bigint | null;
  readonly returnPolicy: RebalanceReturnPolicy;
  readonly minimumOrderMinor: bigint;
  readonly orderPrerequisites: ShadowOrderPrerequisitesInput;
}

export interface ShadowInstrumentDecision {
  readonly instrumentKey: string;
  readonly assetClassId: string;
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: string;
  readonly currentValueMinor: bigint;
  readonly desiredValueMinor: bigint;
  readonly deltaMinor: bigint;
  readonly targetWithinAssetPoints: bigint;
  readonly currentQuantity: bigint;
  readonly priceMinor: bigint;
  readonly availableSellQuantity: bigint | null;
}

export interface ShadowAssetDecision {
  readonly id: string;
  readonly kind: "SECURITIES" | "CASH";
  readonly currentValueMinor: bigint;
  readonly targetBasisPoints: bigint;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
  readonly reason: RebalanceReason;
  readonly desiredValueMinor: bigint;
  readonly deltaMinor: bigint;
  readonly instruments: readonly ShadowInstrumentDecision[];
}

export interface ShadowExecutableOrder {
  readonly candidateId: string;
  readonly phase: "SELL" | "BUY";
  readonly assetClassId: string;
  readonly instrumentKey: string;
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: string;
  readonly side: "SELL" | "BUY";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly notionalMinor: bigint;
  readonly unallocatedMinor: bigint;
}

export interface ShadowDeferredBuyNeed {
  readonly assetClassId: string;
  readonly instrumentKey: string;
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: string;
  readonly desiredNotionalMinor: bigint;
  readonly fundedMinor: bigint;
  readonly executableNotionalMinor: bigint;
  readonly remainingNeedMinor: bigint;
  readonly previewQuantity: bigint;
  readonly previewNotionalMinor: bigint;
  readonly reasonCodes: readonly DeferredBuyReasonCode[];
}

export interface ShadowProjectedAllocation extends ProjectedAllocation {
  readonly kind: "SECURITIES" | "CASH";
}

export interface ShadowPlanResult {
  readonly canonicalVersion: typeof SHADOW_PLAN_CANONICAL_VERSION;
  readonly status: ShadowPlanStatus;
  readonly reasonCodes: readonly ShadowPlanReasonCode[];
  readonly returnPolicy: RebalanceReturnPolicy;
  readonly snapshotId: string | null;
  readonly snapshotDigest: string | null;
  readonly configVersionId: string | null;
  readonly totalValueMinor: bigint | null;
  readonly assetDecisions: readonly ShadowAssetDecision[];
  readonly executableOrders: readonly ShadowExecutableOrder[];
  readonly deferredBuyNeeds: readonly ShadowDeferredBuyNeed[];
  readonly projectedAllocations: readonly ShadowProjectedAllocation[];
  readonly canonicalContent: string;
  readonly planHash: string;
}

interface NormalizedInput {
  readonly assetClasses: readonly ShadowPlanAssetClassInput[];
  readonly cashAssetClassId: string;
  readonly spendableCashMinor: bigint;
  readonly returnPolicy: RebalanceReturnPolicy;
  readonly minimumOrderMinor: bigint;
}

interface BuyFunding {
  readonly fundedMinor: bigint;
  readonly rounded: RoundedKrOrder;
}

/**
 * Builds a deterministic, broker-free shadow plan from one pinned snapshot.
 *
 * The function never assumes sale proceeds. If any sell need exists, only
 * phase-A sell orders are executable and every buy remains a preview until a
 * later collection and reconciliation creates a new plan.
 */
export function createShadowRebalancePlan(input: CreateShadowPlanInput): ShadowPlanResult {
  const blocked = validateAndNormalizeInput(input);
  if ("reasonCode" in blocked) {
    return createResult(input, {
      status: "BLOCKED",
      reasonCodes: [blocked.reasonCode],
      totalValueMinor: null,
      assetDecisions: [],
      executableOrders: [],
      deferredBuyNeeds: [],
      projectedAllocations: [],
    });
  }
  const normalized = blocked;

  try {
    const rebalance = calculateRebalanceTargets(
      normalized.assetClasses.map((asset) => ({
        id: asset.id,
        valueMinor: asset.currentValueMinor,
        targetBasisPoints: asset.targetBasisPoints,
        lowerBasisPoints: asset.lowerBasisPoints,
        upperBasisPoints: asset.upperBasisPoints,
      })),
      normalized.returnPolicy,
    );
    const assetDecisions = rebalance.decisions.map((decision) => {
      const asset = getRequired(
        normalized.assetClasses.find(({ id }) => id === decision.id),
        decision.id,
      );
      const instruments =
        asset.kind === "CASH"
          ? []
          : allocateDesiredInstrumentValues(asset, decision.desiredValueMinor);
      return {
        id: decision.id,
        kind: asset.kind,
        currentValueMinor: decision.valueMinor,
        targetBasisPoints: decision.targetBasisPoints,
        lowerBasisPoints: decision.lowerBasisPoints,
        upperBasisPoints: decision.upperBasisPoints,
        reason: decision.reason,
        desiredValueMinor: decision.desiredValueMinor,
        deltaMinor: decision.deltaMinor,
        instruments,
      } satisfies ShadowAssetDecision;
    });
    const instrumentDecisions = assetDecisions.flatMap(({ instruments }) => instruments);
    const priceIssue = instrumentDecisions.find(({ priceMinor }) => priceMinor <= 0n);
    if (priceIssue) {
      return blockedResult(input, "PRICE_MISSING_OR_INVALID");
    }

    const sellNeeds = instrumentDecisions.filter(({ deltaMinor }) => deltaMinor < 0n);
    const buyNeeds = instrumentDecisions.filter(({ deltaMinor }) => deltaMinor > 0n);
    const executableOrders: ShadowExecutableOrder[] = [];
    const deferredBuyNeeds: ShadowDeferredBuyNeed[] = [];

    if (sellNeeds.length > 0) {
      for (const need of sellNeeds) {
        if (need.availableSellQuantity === null) {
          return blockedResult(input, "SELLABLE_QUANTITY_MISSING");
        }
        const desiredNotionalMinor = -need.deltaMinor;
        let rounded: RoundedKrOrder;
        try {
          rounded = roundKrOrder({
            id: need.instrumentKey,
            side: "SELL",
            desiredNotionalMinor,
            priceMinor: need.priceMinor,
            minimumOrderMinor: normalized.minimumOrderMinor,
            availableQuantity: need.availableSellQuantity,
          });
        } catch {
          return blockedResult(input, "SELLABLE_QUANTITY_INSUFFICIENT");
        }
        if (rounded.status === "ORDERABLE") {
          executableOrders.push(toExecutableOrder(need, rounded));
        }
      }
      for (const need of buyNeeds) {
        deferredBuyNeeds.push(
          createDeferredBuyNeed(
            need,
            0n,
            roundKrOrder({
              id: need.instrumentKey,
              side: "BUY",
              desiredNotionalMinor: need.deltaMinor,
              priceMinor: need.priceMinor,
              minimumOrderMinor: normalized.minimumOrderMinor,
            }),
            ["SELL_PHASE_MUST_RECONCILE"],
            false,
          ),
        );
      }
    } else if (buyNeeds.length > 0) {
      const assetCash = allocateSpendableCash(
        assetDecisions
          .filter(({ kind }) => kind === "SECURITIES")
          .map((asset) => ({
            id: asset.id,
            requestedMinor: asset.instruments.reduce(
              (sum, instrument) => sum + maxBigInt(0n, instrument.deltaMinor),
              0n,
            ),
          }))
          .filter(({ requestedMinor }) => requestedMinor > 0n),
        normalized.spendableCashMinor,
      );
      const assetFunding = new Map(
        assetCash.allocations.map(({ id, allocatedMinor }) => [id, allocatedMinor]),
      );
      const fundingByInstrument = new Map<string, BuyFunding>();
      for (const asset of assetDecisions.filter(({ kind }) => kind === "SECURITIES")) {
        const assetBuyNeeds = asset.instruments.filter(({ deltaMinor }) => deltaMinor > 0n);
        if (assetBuyNeeds.length === 0) continue;
        const instrumentCash = allocateSpendableCash(
          assetBuyNeeds.map((need) => ({
            id: need.instrumentKey,
            requestedMinor: need.deltaMinor,
          })),
          assetFunding.get(asset.id) ?? 0n,
        );
        for (const allocation of instrumentCash.allocations) {
          const need = getRequired(
            assetBuyNeeds.find(({ instrumentKey }) => instrumentKey === allocation.id),
            allocation.id,
          );
          const rounded = roundKrOrder({
            id: need.instrumentKey,
            side: "BUY",
            desiredNotionalMinor: allocation.allocatedMinor,
            priceMinor: need.priceMinor,
            minimumOrderMinor: normalized.minimumOrderMinor,
          });
          fundingByInstrument.set(need.instrumentKey, {
            fundedMinor: allocation.allocatedMinor,
            rounded,
          });
          if (rounded.status === "ORDERABLE") {
            executableOrders.push(toExecutableOrder(need, rounded));
          }
        }
      }
      for (const need of buyNeeds) {
        const funding = getRequired(
          fundingByInstrument.get(need.instrumentKey),
          need.instrumentKey,
        );
        const executableNotionalMinor =
          funding.rounded.status === "ORDERABLE" ? funding.rounded.notionalMinor : 0n;
        if (executableNotionalMinor < need.deltaMinor) {
          const reasons = deferredBuyReasons(need.deltaMinor, funding);
          deferredBuyNeeds.push(
            createDeferredBuyNeed(need, funding.fundedMinor, funding.rounded, reasons, true),
          );
        }
      }
    }

    executableOrders.sort(compareOrders);
    deferredBuyNeeds.sort(compareDeferredBuyNeeds);
    const projectedAllocations = projectAfterOrders(
      assetDecisions,
      executableOrders,
      normalized.cashAssetClassId,
    );
    const status: ShadowPlanStatus = executableOrders.length > 0 ? "PLANNED" : "NO_ACTION";
    const reasonCodes = planReasonCodes({
      status,
      hasAssetNeeds: assetDecisions.some(({ deltaMinor }) => deltaMinor !== 0n),
      hasSellNeeds: sellNeeds.length > 0,
      hasBuyNeeds: buyNeeds.length > 0,
      hasDeferredBuyNeeds: deferredBuyNeeds.length > 0,
    });
    return createResult(input, {
      status,
      reasonCodes,
      totalValueMinor: rebalance.totalValueMinor,
      assetDecisions,
      executableOrders,
      deferredBuyNeeds,
      projectedAllocations,
    });
  } catch {
    return blockedResult(input, "CALCULATION_INPUT_INVALID");
  }
}

function validateAndNormalizeInput(
  input: CreateShadowPlanInput,
): NormalizedInput | { readonly reasonCode: ShadowPlanReasonCode } {
  const identityValues = [
    input.identity.pinnedSnapshotId,
    input.identity.currentSnapshotId,
    input.identity.pinnedSnapshotDigest,
    input.identity.currentSnapshotDigest,
    input.identity.pinnedConfigVersionId,
    input.identity.currentConfigVersionId,
  ];
  if (identityValues.some((value) => value === null || value.trim().length === 0)) {
    return { reasonCode: "IDENTITY_MISSING" };
  }
  if (
    input.identity.pinnedSnapshotId !== input.identity.currentSnapshotId ||
    input.identity.pinnedSnapshotDigest !== input.identity.currentSnapshotDigest ||
    input.identity.pinnedConfigVersionId !== input.identity.currentConfigVersionId
  ) {
    return { reasonCode: "IDENTITY_MISMATCH" };
  }
  if (input.managedCashMinor === null || input.spendableCashMinor === null) {
    return { reasonCode: "MANAGED_CASH_UNSET" };
  }
  if (
    input.managedCashMinor < 0n ||
    input.spendableCashMinor < 0n ||
    input.spendableCashMinor > input.managedCashMinor
  ) {
    return { reasonCode: "CASH_INPUT_INVALID" };
  }
  if (
    input.orderPrerequisites.orderType !== "LIMIT" ||
    input.orderPrerequisites.timeInForce !== "DAY" ||
    !input.orderPrerequisites.wholeSharesOnly
  ) {
    return { reasonCode: "UNSUPPORTED_ORDER_PREREQUISITE" };
  }
  if (
    input.minimumOrderMinor < 0n ||
    (input.returnPolicy !== "BAND_EDGE" && input.returnPolicy !== "TARGET") ||
    input.assetClasses.length === 0
  ) {
    return { reasonCode: "ASSET_INPUT_INVALID" };
  }

  const sortedAssets = [...input.assetClasses].sort((left, right) =>
    compareText(left.id, right.id),
  );
  if (
    sortedAssets.some(
      ({ id }) => id.trim().length === 0 || id !== id.trim() || !/^[A-Za-z0-9_-]+$/.test(id),
    )
  ) {
    return { reasonCode: "ASSET_INPUT_INVALID" };
  }
  if (new Set(sortedAssets.map(({ id }) => id)).size !== sortedAssets.length) {
    return { reasonCode: "DUPLICATE_ASSET_CLASS" };
  }
  const cashAssets = sortedAssets.filter(({ kind }) => kind === "CASH");
  if (
    cashAssets.length !== 1 ||
    cashAssets[0]?.instruments.length !== 0 ||
    cashAssets[0]?.currentValueMinor !== input.managedCashMinor
  ) {
    return { reasonCode: "CASH_ASSET_INVALID" };
  }

  const instrumentKeys = new Set<string>();
  const normalizedAssets: ShadowPlanAssetClassInput[] = [];
  for (const asset of sortedAssets) {
    if (
      asset.currentValueMinor < 0n ||
      asset.targetBasisPoints < 0n ||
      asset.lowerBasisPoints < 0n ||
      asset.lowerBasisPoints > asset.targetBasisPoints ||
      asset.targetBasisPoints > asset.upperBasisPoints ||
      asset.upperBasisPoints > BASIS_POINT_SCALE ||
      (asset.kind !== "SECURITIES" && asset.kind !== "CASH")
    ) {
      return { reasonCode: "ASSET_INPUT_INVALID" };
    }
    if (asset.kind === "CASH") {
      normalizedAssets.push({ ...asset, instruments: [] });
      continue;
    }
    if (asset.instruments.length === 0) {
      return { reasonCode: "WITHIN_ASSET_ALLOCATION_INVALID" };
    }
    const instruments = [...asset.instruments].sort((left, right) =>
      compareText(instrumentKey(left), instrumentKey(right)),
    );
    let assetValueMinor = 0n;
    let withinAssetPoints = 0n;
    for (const instrument of instruments) {
      const key = instrumentKey(instrument);
      if (instrumentKeys.has(key)) return { reasonCode: "DUPLICATE_INSTRUMENT" };
      instrumentKeys.add(key);
      if (instrument.marketCountry !== "KR") return { reasonCode: "UNSUPPORTED_MARKET" };
      if (instrument.currency !== "KRW") return { reasonCode: "UNSUPPORTED_CURRENCY" };
      if (
        !/^[A-Z0-9]{6}$/.test(instrument.symbol) ||
        instrument.currentValueMinor < 0n ||
        instrument.targetWithinAssetPoints < 0n ||
        instrument.currentQuantity < 0n ||
        (instrument.availableSellQuantity !== undefined &&
          instrument.availableSellQuantity !== null &&
          (instrument.availableSellQuantity < 0n ||
            instrument.availableSellQuantity > instrument.currentQuantity))
      ) {
        return { reasonCode: "INSTRUMENT_INPUT_INVALID" };
      }
      if (instrument.priceMinor === null || instrument.priceMinor <= 0n) {
        return { reasonCode: "PRICE_MISSING_OR_INVALID" };
      }
      if (instrument.currentValueMinor !== instrument.currentQuantity * instrument.priceMinor) {
        return { reasonCode: "INSTRUMENT_VALUE_MISMATCH" };
      }
      assetValueMinor += instrument.currentValueMinor;
      withinAssetPoints += instrument.targetWithinAssetPoints;
    }
    if (withinAssetPoints !== BASIS_POINT_SCALE) {
      return { reasonCode: "WITHIN_ASSET_ALLOCATION_INVALID" };
    }
    if (assetValueMinor !== asset.currentValueMinor) {
      return { reasonCode: "ASSET_VALUE_MISMATCH" };
    }
    normalizedAssets.push({ ...asset, instruments });
  }
  const totalValueMinor = normalizedAssets.reduce(
    (sum, asset) => sum + asset.currentValueMinor,
    0n,
  );
  if (totalValueMinor <= 0n) return { reasonCode: "PORTFOLIO_TOTAL_INVALID" };
  const targetTotal = normalizedAssets.reduce((sum, asset) => sum + asset.targetBasisPoints, 0n);
  if (targetTotal !== BASIS_POINT_SCALE) return { reasonCode: "ASSET_INPUT_INVALID" };

  return {
    assetClasses: normalizedAssets,
    cashAssetClassId: cashAssets[0]?.id,
    spendableCashMinor: input.spendableCashMinor,
    returnPolicy: input.returnPolicy,
    minimumOrderMinor: input.minimumOrderMinor,
  };
}

function allocateDesiredInstrumentValues(
  asset: ShadowPlanAssetClassInput,
  desiredAssetValueMinor: bigint,
): readonly ShadowInstrumentDecision[] {
  const provisional = asset.instruments.map((instrument) => {
    const scaled = desiredAssetValueMinor * instrument.targetWithinAssetPoints;
    return {
      instrument,
      desiredValueMinor: scaled / BASIS_POINT_SCALE,
      remainder: scaled % BASIS_POINT_SCALE,
    };
  });
  const assigned = provisional.reduce((sum, item) => sum + item.desiredValueMinor, 0n);
  const remaining = Number(desiredAssetValueMinor - assigned);
  const bonusKeys = new Set(
    [...provisional]
      .sort(
        (left, right) =>
          compareBigIntDescending(left.remainder, right.remainder) ||
          compareText(instrumentKey(left.instrument), instrumentKey(right.instrument)),
      )
      .slice(0, remaining)
      .map(({ instrument }) => instrumentKey(instrument)),
  );
  return provisional.map(({ instrument, desiredValueMinor }) => {
    const key = instrumentKey(instrument);
    const exactDesiredValueMinor = desiredValueMinor + (bonusKeys.has(key) ? 1n : 0n);
    return {
      instrumentKey: key,
      assetClassId: asset.id,
      marketCountry: "KR",
      currency: "KRW",
      symbol: instrument.symbol,
      currentValueMinor: instrument.currentValueMinor,
      desiredValueMinor: exactDesiredValueMinor,
      deltaMinor: exactDesiredValueMinor - instrument.currentValueMinor,
      targetWithinAssetPoints: instrument.targetWithinAssetPoints,
      currentQuantity: instrument.currentQuantity,
      priceMinor: instrument.priceMinor as bigint,
      availableSellQuantity: instrument.availableSellQuantity ?? null,
    };
  });
}

function toExecutableOrder(
  need: ShadowInstrumentDecision,
  rounded: Extract<RoundedKrOrder, { readonly status: "ORDERABLE" }>,
): ShadowExecutableOrder {
  return {
    candidateId: `${need.assetClassId}:${need.instrumentKey}:${rounded.side}`,
    phase: rounded.side,
    assetClassId: need.assetClassId,
    instrumentKey: need.instrumentKey,
    marketCountry: "KR",
    currency: "KRW",
    symbol: need.symbol,
    side: rounded.side,
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: rounded.quantity,
    limitPriceMinor: need.priceMinor,
    notionalMinor: rounded.notionalMinor,
    unallocatedMinor: rounded.unallocatedMinor,
  };
}

function createDeferredBuyNeed(
  need: ShadowInstrumentDecision,
  fundedMinor: bigint,
  rounded: RoundedKrOrder,
  reasonCodes: readonly DeferredBuyReasonCode[],
  executionAllowed: boolean,
): ShadowDeferredBuyNeed {
  const executableNotionalMinor =
    executionAllowed && rounded.status === "ORDERABLE" ? rounded.notionalMinor : 0n;
  const preview = roundKrOrder({
    id: need.instrumentKey,
    side: "BUY",
    desiredNotionalMinor: need.deltaMinor,
    priceMinor: need.priceMinor,
    minimumOrderMinor: 0n,
  });
  return {
    assetClassId: need.assetClassId,
    instrumentKey: need.instrumentKey,
    marketCountry: "KR",
    currency: "KRW",
    symbol: need.symbol,
    desiredNotionalMinor: need.deltaMinor,
    fundedMinor,
    executableNotionalMinor,
    remainingNeedMinor: need.deltaMinor - executableNotionalMinor,
    previewQuantity: preview.status === "ORDERABLE" ? preview.quantity : 0n,
    previewNotionalMinor: preview.status === "ORDERABLE" ? preview.notionalMinor : 0n,
    reasonCodes,
  };
}

function deferredBuyReasons(
  desiredNotionalMinor: bigint,
  funding: BuyFunding,
): readonly DeferredBuyReasonCode[] {
  const reasons: DeferredBuyReasonCode[] = [];
  if (funding.fundedMinor < desiredNotionalMinor) reasons.push("INSUFFICIENT_SPENDABLE_CASH");
  if (funding.rounded.status === "ZERO_QUANTITY") reasons.push("BUY_ZERO_QUANTITY");
  if (funding.rounded.status === "BELOW_MINIMUM") reasons.push("BUY_BELOW_MINIMUM");
  if (
    funding.rounded.status === "ORDERABLE" &&
    funding.rounded.notionalMinor < funding.fundedMinor
  ) {
    reasons.push("BUY_ROUNDING_REMAINDER");
  }
  return reasons;
}

function projectAfterOrders(
  assetDecisions: readonly ShadowAssetDecision[],
  orders: readonly ShadowExecutableOrder[],
  cashAssetClassId: string,
): readonly ShadowProjectedAllocation[] {
  const deltaByAsset = new Map<string, bigint>();
  let cashDeltaMinor = 0n;
  for (const order of orders) {
    const signedNotional = order.side === "BUY" ? order.notionalMinor : -order.notionalMinor;
    deltaByAsset.set(
      order.assetClassId,
      (deltaByAsset.get(order.assetClassId) ?? 0n) + signedNotional,
    );
    cashDeltaMinor -= signedNotional;
  }
  deltaByAsset.set(cashAssetClassId, cashDeltaMinor);
  const projected = projectAllocationAfterRoundedTrades(
    assetDecisions.map((asset) => ({
      id: asset.id,
      valueMinor: asset.currentValueMinor,
      targetBasisPoints: asset.targetBasisPoints,
      lowerBasisPoints: asset.lowerBasisPoints,
      upperBasisPoints: asset.upperBasisPoints,
      deltaMinor: deltaByAsset.get(asset.id) ?? 0n,
    })),
  );
  return projected.allocations.map((allocation) => ({
    ...allocation,
    kind: getRequired(
      assetDecisions.find(({ id }) => id === allocation.id),
      allocation.id,
    ).kind,
  }));
}

function planReasonCodes(input: {
  readonly status: ShadowPlanStatus;
  readonly hasAssetNeeds: boolean;
  readonly hasSellNeeds: boolean;
  readonly hasBuyNeeds: boolean;
  readonly hasDeferredBuyNeeds: boolean;
}): readonly ShadowPlanReasonCode[] {
  if (input.status === "NO_ACTION") {
    if (!input.hasAssetNeeds && !input.hasSellNeeds && !input.hasBuyNeeds) {
      return ["NO_REBALANCE_NEEDED"];
    }
    if (!input.hasSellNeeds && !input.hasBuyNeeds) {
      return ["REBALANCE_NEEDS_NO_ORDER_CANDIDATE"];
    }
    const reasons: ShadowPlanReasonCode[] = ["NO_EXECUTABLE_ORDER_AFTER_ROUNDING"];
    if (input.hasSellNeeds && input.hasBuyNeeds) reasons.push("BUY_PHASE_DEFERRED");
    return reasons;
  }
  if (input.hasSellNeeds) {
    return input.hasBuyNeeds ? ["SELL_PHASE_READY", "BUY_PHASE_DEFERRED"] : ["SELL_PHASE_READY"];
  }
  return input.hasDeferredBuyNeeds ? ["BUY_PHASE_READY", "BUY_NEEDS_REMAIN"] : ["BUY_PHASE_READY"];
}

function blockedResult(
  input: CreateShadowPlanInput,
  reasonCode: ShadowPlanReasonCode,
): ShadowPlanResult {
  return createResult(input, {
    status: "BLOCKED",
    reasonCodes: [reasonCode],
    totalValueMinor: null,
    assetDecisions: [],
    executableOrders: [],
    deferredBuyNeeds: [],
    projectedAllocations: [],
  });
}

function createResult(
  input: CreateShadowPlanInput,
  result: Omit<
    ShadowPlanResult,
    | "canonicalVersion"
    | "returnPolicy"
    | "snapshotId"
    | "snapshotDigest"
    | "configVersionId"
    | "canonicalContent"
    | "planHash"
  >,
): ShadowPlanResult {
  const identity = {
    snapshotId: nonEmptyOrNull(input.identity.pinnedSnapshotId),
    snapshotDigest: nonEmptyOrNull(input.identity.pinnedSnapshotDigest),
    configVersionId: nonEmptyOrNull(input.identity.pinnedConfigVersionId),
  };
  const canonicalContent = canonicalize({
    version: SHADOW_PLAN_CANONICAL_VERSION,
    status: result.status,
    reasonCodes: result.reasonCodes,
    returnPolicy: input.returnPolicy,
    identity,
    managedCashMinor: bigintString(input.managedCashMinor),
    spendableCashMinor: bigintString(input.spendableCashMinor),
    minimumOrderMinor: input.minimumOrderMinor.toString(),
    orderPrerequisites: {
      orderType: input.orderPrerequisites.orderType,
      timeInForce: input.orderPrerequisites.timeInForce,
      wholeSharesOnly: input.orderPrerequisites.wholeSharesOnly,
    },
    totalValueMinor: bigintString(result.totalValueMinor),
    assetDecisions: result.assetDecisions.map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      currentValueMinor: asset.currentValueMinor.toString(),
      targetBasisPoints: asset.targetBasisPoints.toString(),
      lowerBasisPoints: asset.lowerBasisPoints.toString(),
      upperBasisPoints: asset.upperBasisPoints.toString(),
      reason: asset.reason,
      desiredValueMinor: asset.desiredValueMinor.toString(),
      deltaMinor: asset.deltaMinor.toString(),
      instruments: asset.instruments.map((instrument) => ({
        instrumentKey: instrument.instrumentKey,
        marketCountry: instrument.marketCountry,
        currency: instrument.currency,
        symbol: instrument.symbol,
        currentValueMinor: instrument.currentValueMinor.toString(),
        desiredValueMinor: instrument.desiredValueMinor.toString(),
        deltaMinor: instrument.deltaMinor.toString(),
        targetWithinAssetPoints: instrument.targetWithinAssetPoints.toString(),
        currentQuantity: instrument.currentQuantity.toString(),
        priceMinor: instrument.priceMinor.toString(),
        availableSellQuantity: bigintString(instrument.availableSellQuantity),
      })),
    })),
    executableOrders: result.executableOrders.map((order) => ({
      candidateId: order.candidateId,
      phase: order.phase,
      assetClassId: order.assetClassId,
      instrumentKey: order.instrumentKey,
      side: order.side,
      quantity: order.quantity.toString(),
      limitPriceMinor: order.limitPriceMinor.toString(),
      notionalMinor: order.notionalMinor.toString(),
      unallocatedMinor: order.unallocatedMinor.toString(),
    })),
    deferredBuyNeeds: result.deferredBuyNeeds.map((need) => ({
      assetClassId: need.assetClassId,
      instrumentKey: need.instrumentKey,
      desiredNotionalMinor: need.desiredNotionalMinor.toString(),
      fundedMinor: need.fundedMinor.toString(),
      executableNotionalMinor: need.executableNotionalMinor.toString(),
      remainingNeedMinor: need.remainingNeedMinor.toString(),
      previewQuantity: need.previewQuantity.toString(),
      previewNotionalMinor: need.previewNotionalMinor.toString(),
      reasonCodes: need.reasonCodes,
    })),
    projectedAllocations: result.projectedAllocations.map((allocation) => ({
      id: allocation.id,
      kind: allocation.kind,
      valueMinor: allocation.valueMinor.toString(),
      targetBasisPoints: allocation.targetBasisPoints.toString(),
      lowerBasisPoints: allocation.lowerBasisPoints.toString(),
      upperBasisPoints: allocation.upperBasisPoints.toString(),
      currentBasisPoints: allocation.currentBasisPoints.toString(),
      driftBasisPoints: allocation.driftBasisPoints.toString(),
      outsideBand: allocation.outsideBand,
    })),
  });
  return {
    canonicalVersion: SHADOW_PLAN_CANONICAL_VERSION,
    status: result.status,
    reasonCodes: result.reasonCodes,
    returnPolicy: input.returnPolicy,
    snapshotId: identity.snapshotId,
    snapshotDigest: identity.snapshotDigest,
    configVersionId: identity.configVersionId,
    totalValueMinor: result.totalValueMinor,
    assetDecisions: result.assetDecisions,
    executableOrders: result.executableOrders,
    deferredBuyNeeds: result.deferredBuyNeeds,
    projectedAllocations: result.projectedAllocations,
    canonicalContent,
    planHash: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}

function canonicalize(value: unknown): string {
  return JSON.stringify(value);
}

function compareOrders(left: ShadowExecutableOrder, right: ShadowExecutableOrder): number {
  return compareText(left.candidateId, right.candidateId);
}

function compareDeferredBuyNeeds(
  left: ShadowDeferredBuyNeed,
  right: ShadowDeferredBuyNeed,
): number {
  return compareText(
    `${left.assetClassId}:${left.instrumentKey}`,
    `${right.assetClassId}:${right.instrumentKey}`,
  );
}

function instrumentKey(
  instrument: Pick<ShadowPlanInstrumentInput, "marketCountry" | "symbol">,
): string {
  return `${instrument.marketCountry}:${instrument.symbol}`;
}

function compareBigIntDescending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getRequired<Value>(value: Value | undefined, key: string): Value {
  if (value === undefined) throw new Error(`필수 shadow 계획 값을 찾을 수 없습니다: ${key}`);
  return value;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function nonEmptyOrNull(value: string | null): string | null {
  return value !== null && value.trim().length > 0 ? value : null;
}

function bigintString(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}
