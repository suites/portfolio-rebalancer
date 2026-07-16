import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);

export const DashboardBlockReasonSchema = z.object({
  code: z.enum([
    "NO_SNAPSHOT",
    "CREDENTIALS_MISSING",
    "ACCOUNT_NOT_FOUND",
    "ACCOUNT_SELECTION_REQUIRED",
    "EMPTY_ACCOUNT",
    "EMPTY_HOLDINGS",
    "TARGET_CONFIG_MISSING",
    "UNMANAGED_ASSET",
    "BROKER_FETCH_FAILED",
    "DATA_INVALID",
    "DB_UNAVAILABLE",
    "ENGINE_UNAVAILABLE",
    "EGRESS_NOT_CONFIRMED",
    "COLLECTION_IN_PROGRESS",
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
    valueMinor: z.string().regex(/^\d+$/),
    currentBasisPointHundredths: z.number().int().min(0).max(1_000_000),
    targetBasisPoints: basisPoints.nullable(),
    lowerBasisPoints: basisPoints.nullable(),
    upperBasisPoints: basisPoints.nullable(),
    bandStatus: z.enum(["IN_RANGE", "OUTSIDE_BAND", "TARGET_NOT_CONFIGURED"]),
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

export const DashboardSnapshotSchema = z.object({
  state: z.enum(["READY", "EMPTY", "BLOCKED"]),
  mode: z.literal("SHADOW"),
  dataSource: z.literal("TOSS"),
  brokerConnection: z.enum(["CONNECTED", "NOT_CONFIGURED", "FAILED"]),
  accountLabel: z.string().min(1).nullable(),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
  conclusion: z.enum(["NO_ACTION", "REBALANCE_REQUIRED", "BLOCKED"]),
  totalValueMinor: z.string().regex(/^\d+$/).nullable(),
  verifiedCashMinor: z.string().regex(/^\d+$/).nullable(),
  allocations: z.array(DashboardAllocationSchema),
  blockReason: DashboardBlockReasonSchema.nullable(),
  liveOrdersEnabled: z.literal(false),
});

export type DashboardBlockReasonContract = z.infer<typeof DashboardBlockReasonSchema>;
export type DashboardSnapshotContract = z.infer<typeof DashboardSnapshotSchema>;
