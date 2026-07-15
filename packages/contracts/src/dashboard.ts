import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);

export const DashboardAllocationSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    valueMinor: z.string().regex(/^\d+$/),
    currentBasisPointHundredths: z.number().int().min(0).max(1_000_000),
    targetBasisPoints: basisPoints,
    lowerBasisPoints: basisPoints,
    upperBasisPoints: basisPoints,
    bandStatus: z.enum(["IN_RANGE", "OUTSIDE_BAND"]),
  })
  .refine(({ lowerBasisPoints, targetBasisPoints, upperBasisPoints }) => {
    return lowerBasisPoints <= targetBasisPoints && targetBasisPoints <= upperBasisPoints;
  }, "허용 범위 안에 목표 비중이 있어야 합니다.");

export const DashboardSnapshotSchema = z.object({
  mode: z.enum(["PAPER", "SHADOW"]),
  dataSource: z.literal("SYNTHETIC"),
  brokerConnection: z.literal("NOT_CONNECTED"),
  accountLabel: z.string().min(1),
  observedAt: z.iso.datetime({ offset: true }),
  conclusion: z.enum(["NO_ACTION", "REBALANCE_REQUIRED", "BLOCKED", "UNKNOWN"]),
  totalValueMinor: z.string().regex(/^\d+$/),
  verifiedCashMinor: z.string().regex(/^\d+$/).nullable(),
  allocations: z.array(DashboardAllocationSchema).min(1),
});

export type DashboardSnapshotContract = z.infer<typeof DashboardSnapshotSchema>;
