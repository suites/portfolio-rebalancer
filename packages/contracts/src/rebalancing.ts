import { z } from "zod";

const nonNegativeIntegerString = z.string().regex(/^(?:0|[1-9]\d*)$/);
const signedIntegerString = z.string().regex(/^(?:0|[1-9]\d*|-[1-9]\d*)$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const basisPointsString = nonNegativeIntegerString.refine((value) => BigInt(value) <= 10_000n, {
  message: "비중은 10000bp를 넘을 수 없습니다.",
});

export const ShadowPlanReasonCodeSchema = z.enum([
  "NO_REBALANCE_NEEDED",
  "REBALANCE_NEEDS_NO_ORDER_CANDIDATE",
  "NO_EXECUTABLE_ORDER_AFTER_ROUNDING",
  "SELL_PHASE_READY",
  "BUY_PHASE_READY",
  "BUY_PHASE_DEFERRED",
  "BUY_NEEDS_REMAIN",
  "IDENTITY_MISSING",
  "IDENTITY_MISMATCH",
  "MANAGED_CASH_UNSET",
  "CASH_INPUT_INVALID",
  "CASH_ASSET_INVALID",
  "PORTFOLIO_TOTAL_INVALID",
  "ASSET_INPUT_INVALID",
  "ASSET_VALUE_MISMATCH",
  "WITHIN_ASSET_ALLOCATION_INVALID",
  "DUPLICATE_ASSET_CLASS",
  "DUPLICATE_INSTRUMENT",
  "INSTRUMENT_INPUT_INVALID",
  "INSTRUMENT_VALUE_MISMATCH",
  "PRICE_MISSING_OR_INVALID",
  "UNSUPPORTED_MARKET",
  "UNSUPPORTED_CURRENCY",
  "UNSUPPORTED_ORDER_PREREQUISITE",
  "SELLABLE_QUANTITY_MISSING",
  "SELLABLE_QUANTITY_INSUFFICIENT",
  "CALCULATION_INPUT_INVALID",
  "SNAPSHOT_NOT_VERIFIED",
  "TARGET_CONFIG_NOT_PINNED",
  "QUOTE_STALE",
  "MARKET_CALENDAR_STALE",
  "MARKET_SESSION_UNVERIFIED",
  "TRADE_RESTRICTION_UNVERIFIED",
  "COMMISSION_UNVERIFIED",
]);

export const DeferredBuyReasonCodeSchema = z.enum([
  "SELL_PHASE_MUST_RECONCILE",
  "INSUFFICIENT_SPENDABLE_CASH",
  "BUY_ZERO_QUANTITY",
  "BUY_BELOW_MINIMUM",
  "BUY_ROUNDING_REMAINDER",
]);

export const CreateRebalancePlanInputSchema = z.strictObject({
  mode: z.literal("SHADOW"),
});

export const RebalancePlanOrderSchema = z.strictObject({
  candidateId: z.string().min(1).max(320),
  phase: z.enum(["SELL", "BUY"]),
  assetClassId: z.string().min(1).max(80),
  instrumentKey: z.string().min(3).max(160),
  marketCountry: z.literal("KR"),
  currency: z.literal("KRW"),
  symbol: z.string().regex(/^[A-Z0-9]{6}$/),
  side: z.enum(["SELL", "BUY"]),
  orderType: z.literal("LIMIT"),
  timeInForce: z.literal("DAY"),
  quantity: nonNegativeIntegerString,
  limitPriceMinor: nonNegativeIntegerString,
  notionalMinor: nonNegativeIntegerString,
  unallocatedMinor: nonNegativeIntegerString,
});

export const RebalanceDeferredBuyNeedSchema = z.strictObject({
  assetClassId: z.string().min(1).max(80),
  instrumentKey: z.string().min(3).max(160),
  marketCountry: z.literal("KR"),
  currency: z.literal("KRW"),
  symbol: z.string().regex(/^[A-Z0-9]{6}$/),
  desiredNotionalMinor: nonNegativeIntegerString,
  fundedMinor: nonNegativeIntegerString,
  executableNotionalMinor: nonNegativeIntegerString,
  remainingNeedMinor: nonNegativeIntegerString,
  previewQuantity: nonNegativeIntegerString,
  previewNotionalMinor: nonNegativeIntegerString,
  reasonCodes: z.array(DeferredBuyReasonCodeSchema),
});

export const RebalanceProjectedAllocationSchema = z.strictObject({
  id: z.string().min(1).max(80),
  kind: z.enum(["SECURITIES", "CASH"]),
  valueMinor: nonNegativeIntegerString,
  targetBasisPoints: basisPointsString,
  lowerBasisPoints: basisPointsString,
  upperBasisPoints: basisPointsString,
  currentBasisPoints: nonNegativeIntegerString,
  driftBasisPoints: signedIntegerString,
  outsideBand: z.boolean(),
});

export const StoredRebalancePlanSchema = z.strictObject({
  runId: z.uuid(),
  planId: z.uuid(),
  mode: z.literal("SHADOW"),
  status: z.enum(["NO_ACTION", "PLANNED", "BLOCKED"]),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }),
  snapshotId: z.uuid(),
  snapshotDigest: sha256,
  configVersionId: z.uuid(),
  canonicalVersion: z.literal("SHADOW_PLAN_V1"),
  planHash: sha256,
  returnPolicy: z.enum(["BAND_EDGE", "TARGET"]),
  reasonCodes: z.array(ShadowPlanReasonCodeSchema).min(1),
  totalValueMinor: nonNegativeIntegerString.nullable(),
  executableOrders: z.array(RebalancePlanOrderSchema),
  deferredBuyNeeds: z.array(RebalanceDeferredBuyNeedSchema),
  projectedAllocations: z.array(RebalanceProjectedAllocationSchema),
});

export const RebalancePlanSnapshotSchema = z.strictObject({
  state: z.enum(["READY", "NO_PLAN", "UNAVAILABLE"]),
  latest: StoredRebalancePlanSchema.nullable(),
  liveOrdersEnabled: z.boolean(),
});

export type CreateRebalancePlanInputContract = z.infer<typeof CreateRebalancePlanInputSchema>;
export type StoredRebalancePlanContract = z.infer<typeof StoredRebalancePlanSchema>;
export type RebalancePlanSnapshotContract = z.infer<typeof RebalancePlanSnapshotSchema>;
