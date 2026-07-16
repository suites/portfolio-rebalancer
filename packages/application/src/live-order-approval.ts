import { createHash } from "node:crypto";

export const LIVE_ORDER_CONFIRMATION_VERSION = "LIVE_ORDER_CONFIRMATION_V1" as const;
export const LIVE_ORDER_APPROVAL_MAX_LIFETIME_MS = 10 * 60 * 1_000;

export interface ManualLiveOrderApprovalIntent {
  readonly accountId: string;
  readonly planOrderId: string;
  readonly planHash: string;
  readonly actor: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface ManualLiveOrderApprovalRecord {
  readonly confirmationVersion: typeof LIVE_ORDER_CONFIRMATION_VERSION;
  readonly canonicalContent: string;
  readonly approvalHash: string;
}

/**
 * Produces the immutable payload stored by the order ledger. The approval is
 * intentionally scoped to one plan order instead of an entire plan so it
 * cannot authorize a different symbol, side, quantity, or phase.
 */
export function createManualLiveOrderApproval(
  intent: ManualLiveOrderApprovalIntent,
): ManualLiveOrderApprovalRecord {
  validateIntent(intent);
  const canonicalContent = JSON.stringify({
    version: LIVE_ORDER_CONFIRMATION_VERSION,
    accountId: intent.accountId,
    planOrderId: intent.planOrderId,
    planHash: intent.planHash,
    actor: intent.actor,
    createdAt: intent.createdAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
  });
  return {
    confirmationVersion: LIVE_ORDER_CONFIRMATION_VERSION,
    canonicalContent,
    approvalHash: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}

function validateIntent(intent: ManualLiveOrderApprovalIntent): void {
  const createdAtMs = intent.createdAt.getTime();
  const expiresAtMs = intent.expiresAt.getTime();
  if (
    !isUuid(intent.accountId) ||
    !isUuid(intent.planOrderId) ||
    !/^[a-f0-9]{64}$/.test(intent.planHash) ||
    intent.actor.trim().length === 0 ||
    intent.actor.length > 200 ||
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= createdAtMs ||
    expiresAtMs - createdAtMs > LIVE_ORDER_APPROVAL_MAX_LIFETIME_MS
  ) {
    throw new Error("Live 수동 승인 의도가 안전한 주문별 승인 규칙을 만족하지 않습니다.");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
