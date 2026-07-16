import {
  LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES,
  type AccountId,
} from "@portfolio-rebalancer/broker";
import { describe, expect, it } from "vitest";

import {
  createCancelOperatorAuthorizationDigest,
  createCancelRequestDigest,
  evaluateCancelRiskGate,
  type CancelOperatorAuthorizationEvidence,
  type CancelRiskGateInput,
} from "./cancel-risk-gate";

const accountId = "account-1" as AccountId;
const now = new Date("2026-07-17T01:00:00.000Z");

const originalOrder = {
  planId: "plan-1",
  planOrderId: "plan-order-1",
  logicalOrderId: "logical-order-1",
  accountId,
  brokerAccountReference: "10001",
  clientOrderId: `pr1_${"a".repeat(32)}`,
  brokerOrderId: "broker-order-1",
  state: "PENDING",
} as const;

const request = {
  planId: originalOrder.planId,
  planOrderId: originalOrder.planOrderId,
  logicalOrderId: originalOrder.logicalOrderId,
  accountId: originalOrder.accountId,
  brokerAccountReference: originalOrder.brokerAccountReference,
  clientOrderId: originalOrder.clientOrderId,
  brokerOrderId: originalOrder.brokerOrderId,
  primaryLedgerState: originalOrder.state,
} as const;

function createAuthorization(
  overrides: Partial<CancelOperatorAuthorizationEvidence> = {},
): CancelOperatorAuthorizationEvidence {
  const unsigned = {
    authorizationId: "cancel-authorization-1",
    actor: "operator-1",
    action: "CANCEL",
    orderIdentity: {
      planId: originalOrder.planId,
      planOrderId: originalOrder.planOrderId,
      logicalOrderId: originalOrder.logicalOrderId,
      accountId: originalOrder.accountId,
      brokerAccountReference: originalOrder.brokerAccountReference,
      clientOrderId: originalOrder.clientOrderId,
      brokerOrderId: originalOrder.brokerOrderId,
    },
    canonicalRequestDigest: createCancelRequestDigest(request),
    authorizedAt: new Date("2026-07-17T00:59:45.000Z"),
    expiresAt: new Date("2026-07-17T01:00:15.000Z"),
    evidenceReference: "cancel-authorization:1",
    ...overrides,
  };
  return {
    ...unsigned,
    authorizationDigest:
      overrides.authorizationDigest ??
      createCancelOperatorAuthorizationDigest({
        authorizationId: unsigned.authorizationId,
        actor: unsigned.actor,
        action: unsigned.action,
        orderIdentity: unsigned.orderIdentity,
        canonicalRequestDigest: unsigned.canonicalRequestDigest,
        authorizedAt: unsigned.authorizedAt,
        expiresAt: unsigned.expiresAt,
        evidenceReference: unsigned.evidenceReference,
      }),
    consumedAt: overrides.consumedAt ?? null,
  };
}

const baseInput: CancelRiskGateInput = {
  originalOrder,
  request,
  operatorAuthorization: createAuthorization(),
  now,
};

describe("evaluateCancelRiskGate", () => {
  it("운영 설정 입력 없이 취소 전용 검사만 통과시키고 브로커 READY 계약을 만든다", () => {
    const result = evaluateCancelRiskGate(baseInput);

    expect("operationalConfig" in baseInput).toBe(false);
    expect("killSwitch" in baseInput).toBe(false);
    expect("liveEnabled" in baseInput).toBe(false);
    expect(result).toMatchObject({
      scope: "CANCEL",
      planOrderId: originalOrder.planOrderId,
      canonicalRequestDigest: createCancelRequestDigest(request),
      evaluatedAt: "2026-07-17T01:00:00.000Z",
      validUntil: "2026-07-17T01:00:15.000Z",
      evidenceReferences: ["cancel-authorization:1"],
      status: "READY",
      canExecute: true,
    });
    expect(result.checks.map(({ code }) => code)).toEqual(
      LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES,
    );
    expect(result.checks.every(({ outcome }) => outcome === "PASSED")).toBe(true);
  });

  it("부분체결 주문도 동일한 원 주문 상태에 고정해 취소할 수 있다", () => {
    const result = evaluateCancelRiskGate({
      ...baseInput,
      originalOrder: { ...originalOrder, state: "PARTIAL_FILLED" },
      request: { ...request, primaryLedgerState: "PARTIAL_FILLED" },
    });

    expect(result).toMatchObject({ status: "READY", canExecute: true });
  });

  it.each([
    ["planId", "plan-2"],
    ["planOrderId", "plan-order-2"],
    ["logicalOrderId", "logical-order-2"],
    ["accountId", "account-2" as AccountId],
    ["brokerAccountReference", "10002"],
    ["clientOrderId", `pr1_${"b".repeat(32)}`],
    ["brokerOrderId", "broker-order-2"],
  ] as const)("요청의 %s가 원 주문과 다르면 차단한다", (field, value) => {
    const result = evaluateCancelRiskGate({
      ...baseInput,
      request: { ...request, [field]: value },
    });

    expect(result).toMatchObject({ status: "BLOCKED", canExecute: false });
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "CANCEL_ORIGINAL_ORDER_MISMATCH",
        outcome: "BLOCKED",
      }),
    );
  });

  it.each([
    "PLANNED",
    "SUBMITTING",
    "FILLED",
    "CANCELED",
    "REJECTED",
    "UNKNOWN",
    "UNKNOWN_BLOCKED",
  ] as const)("%s 상태의 원 주문은 취소 실행을 차단한다", (state) => {
    const result = evaluateCancelRiskGate({
      ...baseInput,
      originalOrder: { ...originalOrder, state },
      request: { ...request, primaryLedgerState: state },
    });

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "CANCEL_ORDER_STATE_BLOCKED",
        outcome: "BLOCKED",
      }),
    );
  });

  it("요청 상태가 원 주문 상태와 다르면 취소를 차단한다", () => {
    const result = evaluateCancelRiskGate({
      ...baseInput,
      request: { ...request, primaryLedgerState: "PARTIAL_FILLED" },
    });

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "CANCEL_ORDER_STATE_BLOCKED",
        outcome: "BLOCKED",
      }),
    );
  });

  it.each([
    [
      "만료된",
      {
        expiresAt: new Date("2026-07-17T01:00:00.000Z"),
      },
    ],
    [
      "이미 소비된",
      {
        consumedAt: new Date("2026-07-17T00:59:59.000Z"),
      },
    ],
    [
      "digest가 다른",
      {
        authorizationDigest: "f".repeat(64),
      },
    ],
    [
      "요청 digest가 다른",
      {
        canonicalRequestDigest: "e".repeat(64),
      },
    ],
    [
      "허용 TTL보다 긴",
      {
        authorizedAt: new Date("2026-07-17T00:59:00.000Z"),
        expiresAt: new Date("2026-07-17T01:00:01.000Z"),
      },
    ],
  ] as const)("%s 운영자 승인은 차단한다", (_label, overrides) => {
    const result = evaluateCancelRiskGate({
      ...baseInput,
      operatorAuthorization: createAuthorization(overrides),
    });

    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "CANCEL_REQUEST_UNAUTHORIZED",
        outcome: "BLOCKED",
      }),
    );
  });

  it("다른 원 주문이나 동작에 고정된 승인은 차단한다", () => {
    const wrongOrder = createAuthorization({
      orderIdentity: { ...originalOrder, brokerOrderId: "broker-order-2" },
    });
    const wrongAction = createAuthorization({ action: "SUBMIT" });

    for (const operatorAuthorization of [wrongOrder, wrongAction]) {
      const result = evaluateCancelRiskGate({
        ...baseInput,
        operatorAuthorization,
      });
      expect(result.checks).toContainEqual(
        expect.objectContaining({
          code: "CANCEL_REQUEST_UNAUTHORIZED",
          outcome: "BLOCKED",
        }),
      );
    }
  });

  it("운영자 승인이 없거나 유효하지 않은 시각이면 fail closed 한다", () => {
    const missing = evaluateCancelRiskGate({
      ...baseInput,
      operatorAuthorization: null,
    });
    const invalidNow = evaluateCancelRiskGate({
      ...baseInput,
      now: new Date(Number.NaN),
    });

    expect(missing).toMatchObject({ status: "BLOCKED", canExecute: false });
    expect(invalidNow).toMatchObject({
      status: "BLOCKED",
      canExecute: false,
      evaluatedAt: null,
    });
  });
});
