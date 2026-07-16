import { describe, expect, it } from "vitest";

import { evaluateAmbiguousOrderRecovery, evaluateOrderTransition } from "./order-state";

describe("evaluateOrderTransition", () => {
  it("정상 제출과 체결 상태 전이를 허용한다", () => {
    expect(
      evaluateOrderTransition({ from: "PLANNED", to: "SUBMITTING", actor: "EXECUTOR" }),
    ).toMatchObject({ allowed: true, reasonCode: "ORDER_TRANSITION_ALLOWED" });
    expect(
      evaluateOrderTransition({ from: "PENDING", to: "PARTIAL_FILLED", actor: "RECONCILER" }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateOrderTransition({ from: "PARTIAL_FILLED", to: "FILLED", actor: "RECONCILER" }),
    ).toMatchObject({ allowed: true });
    expect(
      evaluateOrderTransition({ from: "PARTIAL_FILLED", to: "REJECTED", actor: "RECONCILER" }),
    ).toMatchObject({ allowed: true });
  });

  it("종료 상태와 허용되지 않은 역방향 전이를 차단한다", () => {
    expect(
      evaluateOrderTransition({ from: "FILLED", to: "PENDING", actor: "RECONCILER" }),
    ).toMatchObject({ allowed: false, reasonCode: "ORDER_TERMINAL_IMMUTABLE" });
    expect(
      evaluateOrderTransition({ from: "PENDING", to: "SUBMITTING", actor: "EXECUTOR" }),
    ).toMatchObject({ allowed: false, reasonCode: "ORDER_TRANSITION_NOT_ALLOWED" });
  });

  it("PARTIAL_FILLED 동일 상태는 체결 누계가 증가한 경우에만 허용한다", () => {
    expect(
      evaluateOrderTransition({
        from: "PARTIAL_FILLED",
        to: "PARTIAL_FILLED",
        actor: "RECONCILER",
        previousFilledQuantity: 1n,
        nextFilledQuantity: 2n,
      }),
    ).toMatchObject({ allowed: true, reasonCode: "ORDER_FILL_PROGRESS_ALLOWED" });
    expect(
      evaluateOrderTransition({
        from: "PARTIAL_FILLED",
        to: "PARTIAL_FILLED",
        actor: "RECONCILER",
        previousFilledQuantity: 2n,
        nextFilledQuantity: 2n,
      }),
    ).toMatchObject({ allowed: false, reasonCode: "ORDER_STATE_UNCHANGED" });
  });

  it("UNKNOWN_BLOCKED 복구는 운영자와 증거를 모두 요구한다", () => {
    expect(
      evaluateOrderTransition({
        from: "UNKNOWN_BLOCKED",
        to: "FILLED",
        actor: "RECONCILER",
        evidenceReference: "broker-order-1",
      }),
    ).toMatchObject({ allowed: false, reasonCode: "UNKNOWN_BLOCKED_OPERATOR_REQUIRED" });
    expect(
      evaluateOrderTransition({
        from: "UNKNOWN_BLOCKED",
        to: "FILLED",
        actor: "OPERATOR",
      }),
    ).toMatchObject({ allowed: false, reasonCode: "UNKNOWN_BLOCKED_EVIDENCE_REQUIRED" });
    expect(
      evaluateOrderTransition({
        from: "UNKNOWN_BLOCKED",
        to: "FILLED",
        actor: "OPERATOR",
        evidenceReference: "broker-order-1",
      }),
    ).toMatchObject({ allowed: true });
  });
});

describe("evaluateAmbiguousOrderRecovery", () => {
  const ambiguousSince = new Date("2026-07-16T00:00:00.000Z");

  it("9분 59초에는 조회만 허용하고 재제출은 금지한다", () => {
    expect(
      evaluateAmbiguousOrderRecovery({
        ambiguousSince,
        now: new Date("2026-07-16T00:09:59.000Z"),
        reconciledBrokerState: null,
      }),
    ).toEqual({
      action: "RECONCILE_ONLY",
      nextState: "UNKNOWN",
      canResubmit: false,
      reasonCode: "IDEMPOTENCY_WINDOW_ACTIVE",
      message: "토스 멱등성 창 안에서는 주문 조회만 반복하고 재제출하지 않습니다.",
    });
  });

  it("10분이 지나면 UNKNOWN_BLOCKED로 잠그고 재제출하지 않는다", () => {
    expect(
      evaluateAmbiguousOrderRecovery({
        ambiguousSince,
        now: new Date("2026-07-16T00:10:01.000Z"),
        reconciledBrokerState: null,
      }),
    ).toMatchObject({
      action: "TRANSITION_UNKNOWN_BLOCKED",
      nextState: "UNKNOWN_BLOCKED",
      canResubmit: false,
      reasonCode: "IDEMPOTENCY_WINDOW_EXPIRED",
    });
  });

  it("브로커에서 찾은 기존 주문 상태만 적용하고 재제출하지 않는다", () => {
    expect(
      evaluateAmbiguousOrderRecovery({
        ambiguousSince,
        now: new Date("2026-07-16T00:20:00.000Z"),
        reconciledBrokerState: "PARTIAL_FILLED",
      }),
    ).toMatchObject({
      action: "APPLY_RECONCILED_STATE",
      nextState: "PARTIAL_FILLED",
      canResubmit: false,
    });
  });

  it("시각이 역행하면 자동 실행을 차단한다", () => {
    expect(
      evaluateAmbiguousOrderRecovery({
        ambiguousSince,
        now: new Date("2026-07-15T23:59:59.000Z"),
        reconciledBrokerState: null,
      }),
    ).toMatchObject({
      action: "TRANSITION_UNKNOWN_BLOCKED",
      nextState: "UNKNOWN_BLOCKED",
      canResubmit: false,
      reasonCode: "AMBIGUOUS_TIME_INVALID",
    });
  });
});
