import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);
const minorUnitString = z.string().regex(/^\d+$/);

export const DashboardBlockReasonSchema = z.object({
  code: z.enum([
    "NO_SNAPSHOT",
    "CREDENTIALS_MISSING",
    "ACCOUNT_NOT_FOUND",
    "ACCOUNT_SELECTION_REQUIRED",
    "EMPTY_ACCOUNT",
    "EMPTY_HOLDINGS",
    "TARGET_CONFIG_MISSING",
    "TARGET_CONFIG_STALE",
    "MANAGED_CASH_MISSING",
    "UNMANAGED_ASSET",
    "SNAPSHOT_EVIDENCE_UNVERIFIED",
    "BROKER_FETCH_FAILED",
    "DATA_INVALID",
    "DB_UNAVAILABLE",
    "ENGINE_UNAVAILABLE",
    "EGRESS_NOT_CONFIRMED",
    "COLLECTION_IN_PROGRESS",
    "COLLECTION_LEASE_LOST",
  ]),
  problem: z.string().min(1),
  protectiveAction: z.string().min(1),
  nextAction: z.string().min(1),
});

export const DashboardAllocationSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    valueMinor: minorUnitString,
    currentBasisPointHundredths: z.number().int().min(0).max(1_000_000),
    targetBasisPoints: basisPoints.nullable(),
    lowerBasisPoints: basisPoints.nullable(),
    upperBasisPoints: basisPoints.nullable(),
    bandStatus: z.enum(["IN_RANGE", "OUTSIDE_BAND", "TARGET_NOT_CONFIGURED"]),
    instruments: z
      .array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string().min(1),
          valueMinor: minorUnitString,
          currentWithinAssetBasisPointHundredths: z.number().int().min(0).max(1_000_000),
          targetWithinAssetPoints: basisPoints,
        }),
      )
      .max(100)
      .default([]),
  })
  .superRefine((allocation, context) => {
    const targets = [
      allocation.lowerBasisPoints,
      allocation.targetBasisPoints,
      allocation.upperBasisPoints,
    ];
    const allNull = targets.every((value) => value === null);
    const allNumbers = targets.every((value) => value !== null);
    if (!allNull && !allNumbers) {
      context.addIssue({ code: "custom", message: "목표와 허용 범위는 함께 설정해야 합니다." });
      return;
    }
    if (allNull && allocation.bandStatus !== "TARGET_NOT_CONFIGURED") {
      context.addIssue({ code: "custom", message: "목표가 없으면 미설정 상태여야 합니다." });
      return;
    }
    if (allNumbers) {
      const lower = allocation.lowerBasisPoints as number;
      const target = allocation.targetBasisPoints as number;
      const upper = allocation.upperBasisPoints as number;
      if (lower > target || target > upper || allocation.bandStatus === "TARGET_NOT_CONFIGURED") {
        context.addIssue({ code: "custom", message: "허용 범위와 목표 비중이 올바르지 않습니다." });
      }
    }
  });

export const DashboardBuyingPowerSchema = z.object({
  currency: z.enum(["KRW", "USD"]),
  amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  valueKrwMinor: z.string().regex(/^\d+$/),
  observedAt: z.iso.datetime({ offset: true }),
  valuationEligible: z.literal(false),
});

export const DashboardUnmanagedHoldingSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  valueMinor: minorUnitString,
});

export const DashboardSnapshotSchema = z
  .object({
    state: z.enum(["READY", "EMPTY", "BLOCKED"]),
    mode: z.literal("SHADOW"),
    dataSource: z.literal("TOSS"),
    brokerConnection: z.enum(["CONNECTED", "NOT_CONFIGURED", "FAILED"]),
    accountLabel: z.string().min(1).nullable(),
    observedAt: z.iso.datetime({ offset: true }).nullable(),
    conclusion: z.enum(["NO_ACTION", "REBALANCE_REQUIRED", "BLOCKED"]),
    securitiesValueMinor: minorUnitString.nullable(),
    totalValueMinor: minorUnitString.nullable(),
    managedCashMinor: minorUnitString.nullable(),
    managedCashSource: z.enum(["UNSET", "EXCLUDED", "USER_FIXED"]),
    buyingPower: z.array(DashboardBuyingPowerSchema).max(2).default([]),
    allocations: z.array(DashboardAllocationSchema),
    unmanagedHoldings: z.array(DashboardUnmanagedHoldingSchema).default([]),
    blockReason: DashboardBlockReasonSchema.nullable(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.managedCashSource === "UNSET" && snapshot.managedCashMinor !== null) {
      context.addIssue({
        code: "custom",
        path: ["managedCashMinor"],
        message: "관리 현금 기준이 없으면 금액도 없어야 합니다.",
      });
    }
    if (snapshot.managedCashSource === "EXCLUDED" && snapshot.managedCashMinor !== "0") {
      context.addIssue({
        code: "custom",
        path: ["managedCashMinor"],
        message: "현금 제외 정책의 관리 현금은 0원이어야 합니다.",
      });
    }
    if (snapshot.managedCashSource === "USER_FIXED" && snapshot.managedCashMinor === null) {
      context.addIssue({
        code: "custom",
        path: ["managedCashMinor"],
        message: "사용자 고정 관리 현금에는 금액이 필요합니다.",
      });
    }
    if (
      snapshot.securitiesValueMinor !== null &&
      snapshot.totalValueMinor !== null &&
      snapshot.totalValueMinor !==
        (
          BigInt(snapshot.securitiesValueMinor) + BigInt(snapshot.managedCashMinor ?? "0")
        ).toString()
    ) {
      context.addIssue({
        code: "custom",
        path: ["totalValueMinor"],
        message: "총 관리 자산은 주식 평가액과 관리 현금의 합이어야 합니다.",
      });
    }
  });

export type DashboardBlockReasonContract = z.infer<typeof DashboardBlockReasonSchema>;
export type DashboardSnapshotContract = z.infer<typeof DashboardSnapshotSchema>;
