export const ORDER_STATES = [
  "PLANNED",
  "SUBMITTING",
  "PENDING",
  "PARTIAL_FILLED",
  "FILLED",
  "CANCELED",
  "REJECTED",
  "UNKNOWN",
  "UNKNOWN_BLOCKED",
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export type OrderTransitionActor = "EXECUTOR" | "RECONCILER" | "OPERATOR";

export type OrderTransitionReasonCode =
  | "ORDER_TRANSITION_ALLOWED"
  | "ORDER_FILL_PROGRESS_ALLOWED"
  | "ORDER_STATE_UNCHANGED"
  | "ORDER_TERMINAL_IMMUTABLE"
  | "ORDER_TRANSITION_NOT_ALLOWED"
  | "UNKNOWN_BLOCKED_OPERATOR_REQUIRED"
  | "UNKNOWN_BLOCKED_EVIDENCE_REQUIRED"
  | "UNKNOWN_BLOCKED_ONLY_FROM_UNKNOWN";

export interface OrderTransitionDecision {
  readonly allowed: boolean;
  readonly reasonCode: OrderTransitionReasonCode;
  readonly message: string;
}

export type ReconciledBrokerState =
  "PENDING" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED";

export type AmbiguousOrderRecoveryAction =
  "APPLY_RECONCILED_STATE" | "RECONCILE_ONLY" | "TRANSITION_UNKNOWN_BLOCKED";

export interface AmbiguousOrderRecoveryDecision {
  readonly action: AmbiguousOrderRecoveryAction;
  readonly nextState: OrderState;
  readonly canResubmit: false;
  readonly reasonCode:
    | "BROKER_STATE_RECONCILED"
    | "IDEMPOTENCY_WINDOW_ACTIVE"
    | "IDEMPOTENCY_WINDOW_EXPIRED"
    | "AMBIGUOUS_TIME_INVALID";
  readonly message: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<OrderState, readonly OrderState[]>> = {
  PLANNED: ["SUBMITTING"],
  SUBMITTING: ["PENDING", "REJECTED", "UNKNOWN"],
  PENDING: ["PARTIAL_FILLED", "FILLED", "CANCELED", "REJECTED"],
  PARTIAL_FILLED: ["FILLED", "CANCELED", "REJECTED"],
  FILLED: [],
  CANCELED: [],
  REJECTED: [],
  UNKNOWN: ["PENDING", "PARTIAL_FILLED", "FILLED", "CANCELED", "REJECTED", "UNKNOWN_BLOCKED"],
  UNKNOWN_BLOCKED: ["PENDING", "PARTIAL_FILLED", "FILLED", "CANCELED", "REJECTED"],
};

const IMMUTABLE_TERMINAL_STATES: ReadonlySet<OrderState> = new Set([
  "FILLED",
  "CANCELED",
  "REJECTED",
]);

const IDEMPOTENCY_WINDOW_MILLISECONDS = 10 * 60 * 1_000;

export function evaluateOrderTransition(input: {
  readonly from: OrderState;
  readonly to: OrderState;
  readonly actor: OrderTransitionActor;
  readonly evidenceReference?: string | null;
  readonly previousFilledQuantity?: bigint;
  readonly nextFilledQuantity?: bigint;
}): OrderTransitionDecision {
  if (input.from === input.to) {
    if (
      input.from === "PARTIAL_FILLED" &&
      typeof input.previousFilledQuantity === "bigint" &&
      typeof input.nextFilledQuantity === "bigint" &&
      input.previousFilledQuantity >= 0n &&
      input.nextFilledQuantity > input.previousFilledQuantity
    ) {
      return {
        allowed: true,
        reasonCode: "ORDER_FILL_PROGRESS_ALLOWED",
        message: "부분체결 누계가 증가한 진행 이벤트를 기록할 수 있습니다.",
      };
    }
    return blocked("ORDER_STATE_UNCHANGED", "같은 주문 상태를 중복 기록하지 않습니다.");
  }
  if (IMMUTABLE_TERMINAL_STATES.has(input.from)) {
    return blocked(
      "ORDER_TERMINAL_IMMUTABLE",
      "체결·취소·거부로 종료된 주문 상태는 변경할 수 없습니다.",
    );
  }
  if (input.to === "UNKNOWN_BLOCKED" && input.from !== "UNKNOWN") {
    return blocked(
      "UNKNOWN_BLOCKED_ONLY_FROM_UNKNOWN",
      "UNKNOWN_BLOCKED는 상태가 불명확한 UNKNOWN 주문에서만 전환할 수 있습니다.",
    );
  }
  if (input.from === "UNKNOWN_BLOCKED") {
    if (input.actor !== "OPERATOR") {
      return blocked(
        "UNKNOWN_BLOCKED_OPERATOR_REQUIRED",
        "UNKNOWN_BLOCKED 주문은 운영자가 브로커 증거를 확인한 뒤에만 복구할 수 있습니다.",
      );
    }
    if (!input.evidenceReference?.trim()) {
      return blocked(
        "UNKNOWN_BLOCKED_EVIDENCE_REQUIRED",
        "UNKNOWN_BLOCKED 주문 복구에는 브로커 조회 증거 참조가 필요합니다.",
      );
    }
  }
  if (!ALLOWED_TRANSITIONS[input.from].includes(input.to)) {
    return blocked(
      "ORDER_TRANSITION_NOT_ALLOWED",
      `${input.from}에서 ${input.to}(으)로 주문 상태를 변경할 수 없습니다.`,
    );
  }
  return {
    allowed: true,
    reasonCode: "ORDER_TRANSITION_ALLOWED",
    message: `${input.from}에서 ${input.to}(으)로 주문 상태를 변경할 수 있습니다.`,
  };
}

export function evaluateAmbiguousOrderRecovery(input: {
  readonly ambiguousSince: Date;
  readonly now: Date;
  readonly reconciledBrokerState: ReconciledBrokerState | null;
}): AmbiguousOrderRecoveryDecision {
  if (input.reconciledBrokerState !== null) {
    return {
      action: "APPLY_RECONCILED_STATE",
      nextState: input.reconciledBrokerState,
      canResubmit: false,
      reasonCode: "BROKER_STATE_RECONCILED",
      message: "브로커 조회 결과로 기존 주문 상태를 복구하며 새 주문을 제출하지 않습니다.",
    };
  }

  const elapsedMilliseconds = input.now.getTime() - input.ambiguousSince.getTime();
  if (
    !Number.isFinite(elapsedMilliseconds) ||
    Number.isNaN(input.now.getTime()) ||
    Number.isNaN(input.ambiguousSince.getTime()) ||
    elapsedMilliseconds < 0
  ) {
    return {
      action: "TRANSITION_UNKNOWN_BLOCKED",
      nextState: "UNKNOWN_BLOCKED",
      canResubmit: false,
      reasonCode: "AMBIGUOUS_TIME_INVALID",
      message: "불명확 주문의 경과 시간을 신뢰할 수 없어 자동 실행을 차단합니다.",
    };
  }
  if (elapsedMilliseconds < IDEMPOTENCY_WINDOW_MILLISECONDS) {
    return {
      action: "RECONCILE_ONLY",
      nextState: "UNKNOWN",
      canResubmit: false,
      reasonCode: "IDEMPOTENCY_WINDOW_ACTIVE",
      message: "토스 멱등성 창 안에서는 주문 조회만 반복하고 재제출하지 않습니다.",
    };
  }
  return {
    action: "TRANSITION_UNKNOWN_BLOCKED",
    nextState: "UNKNOWN_BLOCKED",
    canResubmit: false,
    reasonCode: "IDEMPOTENCY_WINDOW_EXPIRED",
    message: "10분 안에 주문 상태를 확정하지 못해 자동 실행을 잠갔습니다.",
  };
}

function blocked(
  reasonCode: Exclude<
    OrderTransitionReasonCode,
    "ORDER_TRANSITION_ALLOWED" | "ORDER_FILL_PROGRESS_ALLOWED"
  >,
  message: string,
): OrderTransitionDecision {
  return { allowed: false, reasonCode, message };
}
