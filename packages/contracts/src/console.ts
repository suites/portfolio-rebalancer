import { z } from "zod";

const basisPoints = z.number().int().min(0).max(10_000);
const assetKey = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[^:]+:[^:]+$/);

const AutoBandPolicySchema = z.object({
  mode: z.literal("AUTO"),
  version: z.literal("MIXED_V1").default("MIXED_V1"),
});

const CustomBandPolicyInputSchema = z.object({
  mode: z.literal("CUSTOM"),
  version: z.literal("CUSTOM_V1").default("CUSTOM_V1"),
  lowerBasisPoints: basisPoints,
  upperBasisPoints: basisPoints,
});

export const TargetBandPolicyInputSchema = z.discriminatedUnion("mode", [
  AutoBandPolicySchema,
  CustomBandPolicyInputSchema,
]);

export const TargetResolvedBandPolicySchema = z.discriminatedUnion("mode", [
  AutoBandPolicySchema,
  z.object({
    mode: z.literal("CUSTOM"),
    version: z.string().min(1),
    lowerBasisPoints: basisPoints,
    upperBasisPoints: basisPoints,
  }),
]);

export const TargetAllocationInputSchema = z.object({
  assetKey,
  targetBasisPoints: basisPoints,
  bandPolicy: TargetBandPolicyInputSchema.default({
    mode: "AUTO",
    version: "MIXED_V1",
  }),
});

export const TargetSettingsDraftInputSchema = z
  .object({ allocations: z.array(TargetAllocationInputSchema).min(1).max(100) })
  .superRefine(({ allocations }, context) => {
    const keys = allocations.map(({ assetKey: key }) => key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["allocations"],
        message: "자산은 한 번씩만 설정할 수 있습니다.",
      });
    }

    const total = allocations.reduce((sum, allocation) => sum + allocation.targetBasisPoints, 0);
    if (total !== 10_000) {
      context.addIssue({
        code: "custom",
        path: ["allocations"],
        message: `목표 비중 합계는 10000bp여야 합니다: ${total}bp`,
      });
    }

    allocations.forEach((allocation, index) => {
      if (
        allocation.bandPolicy.mode === "CUSTOM" &&
        (allocation.bandPolicy.lowerBasisPoints > allocation.targetBasisPoints ||
          allocation.targetBasisPoints > allocation.bandPolicy.upperBasisPoints)
      ) {
        context.addIssue({
          code: "custom",
          path: ["allocations", index],
          message: "허용 범위는 하한, 목표, 상한 순서여야 합니다.",
        });
      }
    });
  });

export const TargetSettingsAllocationSchema = z
  .object({
    assetKey,
    label: z.string().min(1),
    targetBasisPoints: basisPoints,
    lowerBasisPoints: basisPoints,
    upperBasisPoints: basisPoints,
    bandPolicy: TargetResolvedBandPolicySchema,
  })
  .superRefine((allocation, context) => {
    if (
      allocation.lowerBasisPoints > allocation.targetBasisPoints ||
      allocation.targetBasisPoints > allocation.upperBasisPoints
    ) {
      context.addIssue({ code: "custom", message: "저장된 목표 밴드 순서가 올바르지 않습니다." });
    }
    if (
      allocation.bandPolicy.mode === "CUSTOM" &&
      (allocation.bandPolicy.lowerBasisPoints !== allocation.lowerBasisPoints ||
        allocation.bandPolicy.upperBasisPoints !== allocation.upperBasisPoints)
    ) {
      context.addIssue({ code: "custom", message: "수동 밴드 정책과 저장된 범위가 다릅니다." });
    }
  });

export const TargetSettingsVersionSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "ACTIVE"]),
  createdAt: z.iso.datetime({ offset: true }),
  allocations: z.array(TargetSettingsAllocationSchema).min(1),
});

export const TargetSettingsAssetSchema = z.object({
  assetKey,
  label: z.string().min(1),
  description: z.string().min(1),
  currentBasisPointHundredths: z.number().int().min(0).max(1_000_000),
});

export const TargetSettingsSnapshotSchema = z.object({
  state: z.enum(["NO_SNAPSHOT", "NOT_CONFIGURED", "CONFIGURED", "UNAVAILABLE"]),
  accountLabel: z.string().min(1).nullable(),
  snapshotObservedAt: z.iso.datetime({ offset: true }).nullable(),
  snapshotTargetVersion: z.number().int().positive().nullable(),
  activeVersion: TargetSettingsVersionSchema.nullable(),
  draftVersion: TargetSettingsVersionSchema.nullable(),
  requiresCollection: z.boolean(),
  assets: z.array(TargetSettingsAssetSchema),
  liveOrdersEnabled: z.literal(false),
});

export const ConsoleCheckSchema = z.object({
  ruleCode: z.string().min(1),
  outcome: z.enum(["PASSED", "BLOCKED"]),
});

export const ConsoleRecordSchema = z.object({
  id: z.string().uuid(),
  type: z.literal("COLLECTION"),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]),
  startedAt: z.iso.datetime({ offset: true }),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
  validationStatus: z.enum(["VERIFIED", "BLOCKED"]).nullable(),
  errorCode: z.string().min(1).nullable(),
  checks: z.array(ConsoleCheckSchema),
});

export const ConsoleRecordsSnapshotSchema = z.object({
  state: z.enum(["READY", "UNAVAILABLE"]),
  records: z.array(ConsoleRecordSchema),
  orderLedgerState: z.literal("NOT_IMPLEMENTED"),
  liveOrdersEnabled: z.literal(false),
});

export type TargetSettingsDraftInputContract = z.infer<typeof TargetSettingsDraftInputSchema>;
export type TargetSettingsSnapshotContract = z.infer<typeof TargetSettingsSnapshotSchema>;
export type ConsoleRecordsSnapshotContract = z.infer<typeof ConsoleRecordsSnapshotSchema>;
