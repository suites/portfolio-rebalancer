import { describe, expect, it } from "vitest";

import {
  LIVE_ORDER_APPROVAL_MAX_LIFETIME_MS,
  LIVE_ORDER_CONFIRMATION_VERSION,
  createManualLiveOrderApproval,
} from "./live-order-approval";

const createdAt = new Date("2026-07-17T00:00:00.000Z");
const baseIntent = {
  accountId: "11111111-1111-4111-8111-111111111111",
  planOrderId: "22222222-2222-4222-8222-222222222222",
  planHash: "a".repeat(64),
  actor: "personal-console-operator",
  createdAt,
  expiresAt: new Date(createdAt.getTime() + 5 * 60 * 1_000),
};

describe("createManualLiveOrderApproval", () => {
  it("한 planOrder에 고정된 canonical 승인과 SHA-256을 생성한다", () => {
    const approval = createManualLiveOrderApproval(baseIntent);

    expect(approval.confirmationVersion).toBe(LIVE_ORDER_CONFIRMATION_VERSION);
    expect(approval.approvalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(approval.canonicalContent).toBe(
      JSON.stringify({
        version: LIVE_ORDER_CONFIRMATION_VERSION,
        accountId: baseIntent.accountId,
        planOrderId: baseIntent.planOrderId,
        planHash: baseIntent.planHash,
        actor: baseIntent.actor,
        createdAt: "2026-07-17T00:00:00.000Z",
        expiresAt: "2026-07-17T00:05:00.000Z",
      }),
    );
    expect(createManualLiveOrderApproval({ ...baseIntent })).toEqual(approval);
  });

  it.each([
    ["계획 주문", { planOrderId: "33333333-3333-4333-8333-333333333333" }],
    ["계획 해시", { planHash: "b".repeat(64) }],
    ["운영자", { actor: "another-operator" }],
    ["만료", { expiresAt: new Date(createdAt.getTime() + 6 * 60 * 1_000) }],
  ])("%s이 달라지면 다른 승인 hash를 만든다", (_label, change) => {
    expect(createManualLiveOrderApproval({ ...baseIntent, ...change }).approvalHash).not.toBe(
      createManualLiveOrderApproval(baseIntent).approvalHash,
    );
  });

  it("만료·TTL·식별자·운영자 입력이 안전하지 않으면 생성하지 않는다", () => {
    expect(() => createManualLiveOrderApproval({ ...baseIntent, expiresAt: createdAt })).toThrow(
      "Live 수동 승인 의도",
    );
    expect(() =>
      createManualLiveOrderApproval({
        ...baseIntent,
        expiresAt: new Date(createdAt.getTime() + LIVE_ORDER_APPROVAL_MAX_LIFETIME_MS + 1),
      }),
    ).toThrow("Live 수동 승인 의도");
    expect(() => createManualLiveOrderApproval({ ...baseIntent, accountId: "not-a-uuid" })).toThrow(
      "Live 수동 승인 의도",
    );
    expect(() => createManualLiveOrderApproval({ ...baseIntent, actor: " " })).toThrow(
      "Live 수동 승인 의도",
    );
  });
});
