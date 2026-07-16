import { z } from "zod";

const nonNegativeIntegerString = z.string().regex(/^(?:0|[1-9]\d*)$/);
const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const ExecutionOrderModeSchema = z.enum(["PAPER", "LIVE"]);
export const OrderLedgerStateSchema = z.enum([
  "PLANNED",
  "SUBMITTING",
  "PENDING",
  "PARTIAL_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "UNKNOWN",
  "UNKNOWN_BLOCKED",
]);

export const ExecuteRebalancePlanInputSchema = z
  .strictObject({
    planId: z.uuid(),
    mode: ExecutionOrderModeSchema,
    approvalIds: z.array(z.uuid()).max(100).default([]),
  })
  .superRefine((input, context) => {
    if (input.mode === "PAPER" && input.approvalIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["approvalIds"],
        message: "Paper 실행에는 Live 수동 승인을 사용할 수 없습니다.",
      });
    }
    if (input.mode === "LIVE" && input.approvalIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["approvalIds"],
        message: "Live 실행에는 주문별 수동 승인이 필요합니다.",
      });
    }
    if (new Set(input.approvalIds).size !== input.approvalIds.length) {
      context.addIssue({
        code: "custom",
        path: ["approvalIds"],
        message: "같은 수동 승인을 중복해서 제출할 수 없습니다.",
      });
    }
  });

export const CreateLivePlanApprovalInputSchema = z.strictObject({
  planId: z.uuid(),
  planHash: sha256,
  confirmation: z.literal("LIVE 주문 계획과 금액을 확인했습니다"),
});

export const LiveOrderApprovalSchema = z.strictObject({
  approvalId: z.uuid(),
  planOrderId: z.uuid(),
  planHash: sha256,
  expiresAt: z.iso.datetime({ offset: true }),
});

export const LivePlanApprovalReceiptSchema = z.strictObject({
  planId: z.uuid(),
  planHash: sha256,
  approvals: z.array(LiveOrderApprovalSchema).min(1),
});

export const OrderTimelineEntrySchema = z.strictObject({
  sequence: z.number().int().nonnegative(),
  state: OrderLedgerStateSchema,
  brokerStatusRaw: z.string().min(1).nullable(),
  brokerOrderId: z.string().min(1).nullable(),
  brokerActionOrderId: z.string().min(1).nullable(),
  filledQuantity: nonNegativeIntegerString,
  filledGrossMinor: nonNegativeIntegerString,
  feeMinor: nonNegativeIntegerString,
  occurredAt: z.iso.datetime({ offset: true }),
  message: z.string().min(1),
});

export const StoredOrderReceiptSchema = z.strictObject({
  orderId: z.uuid(),
  logicalOrderId: z.uuid(),
  planId: z.uuid(),
  planOrderId: z.uuid(),
  mode: ExecutionOrderModeSchema,
  symbol: z.string().regex(/^[A-Z0-9]{6}$/),
  instrumentKey: z.string().min(3),
  side: z.enum(["BUY", "SELL"]),
  quantity: positiveIntegerString,
  limitPriceMinor: positiveIntegerString,
  plannedGrossMinor: positiveIntegerString,
  reservedGrossMinor: positiveIntegerString,
  clientOrderId: z
    .string()
    .length(36)
    .regex(/^[A-Za-z0-9_-]+$/),
  currentState: OrderLedgerStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  timeline: z.array(OrderTimelineEntrySchema).min(1),
});

export const OrdersSnapshotSchema = z.strictObject({
  state: z.enum(["READY", "EMPTY", "UNAVAILABLE"]),
  killSwitch: z.enum(["ENGAGED", "DISENGAGED", "UNKNOWN"]),
  orders: z.array(StoredOrderReceiptSchema),
  liveOrdersEnabled: z.boolean(),
});

export const ExecuteRebalancePlanReceiptSchema = z.strictObject({
  planId: z.uuid(),
  mode: ExecutionOrderModeSchema,
  outcome: z.enum(["COMPLETED", "PENDING", "BLOCKED", "REFRESH_REQUIRED"]),
  orderIds: z.array(z.uuid()),
  message: z.string().min(1),
});

export const KillSwitchCommandSchema = z
  .strictObject({
    state: z.enum(["ENGAGED", "DISENGAGED"]),
    reason: z.string().trim().min(8).max(500),
    confirmation: z.enum(["킬 스위치 작동", "킬 스위치 해제"]),
  })
  .superRefine((input, context) => {
    const expected = input.state === "ENGAGED" ? "킬 스위치 작동" : "킬 스위치 해제";
    if (input.confirmation !== expected) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: `${expected} 문구를 정확히 선택해야 합니다.`,
      });
    }
  });

export const RecoverUnknownOrderInputSchema = z.strictObject({
  orderId: z.uuid(),
  resolvedState: z.enum(["PENDING", "PARTIAL_FILLED", "FILLED", "CANCELED", "REJECTED"]),
  brokerEvidenceReference: z.string().trim().min(1).max(500),
  brokerOrderId: z.string().trim().min(1).max(500),
  filledQuantity: nonNegativeIntegerString,
  filledGrossMinor: nonNegativeIntegerString,
  feeMinor: nonNegativeIntegerString,
});

export type ExecuteRebalancePlanInputContract = z.infer<typeof ExecuteRebalancePlanInputSchema>;
export type CreateLivePlanApprovalInputContract = z.infer<typeof CreateLivePlanApprovalInputSchema>;
export type LivePlanApprovalReceiptContract = z.infer<typeof LivePlanApprovalReceiptSchema>;
export type OrdersSnapshotContract = z.infer<typeof OrdersSnapshotSchema>;
export type ExecuteRebalancePlanReceiptContract = z.infer<typeof ExecuteRebalancePlanReceiptSchema>;
export type KillSwitchCommandContract = z.infer<typeof KillSwitchCommandSchema>;
export type RecoverUnknownOrderInputContract = z.infer<typeof RecoverUnknownOrderInputSchema>;
