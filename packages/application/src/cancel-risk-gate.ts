import { createHash } from "node:crypto";

import {
  LIVE_ORDER_AUTHORIZATION_MAX_LIFETIME_MS,
  LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES,
  createLiveOrderRequestDigest,
  type AccountId,
  type IsoDateTime,
  type PassedLiveOrderRiskCheck,
  type ReadyLiveOrderRiskDecision,
} from "@portfolio-rebalancer/broker";

export const CANCEL_OPERATOR_AUTHORIZATION_VERSION = "CANCEL_OPERATOR_AUTHORIZATION_V1" as const;

export type CancelOrderLedgerState =
  | "PLANNED"
  | "SUBMITTING"
  | "PENDING"
  | "PARTIAL_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "UNKNOWN"
  | "UNKNOWN_BLOCKED";

export interface CancelOrderIdentity {
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly brokerOrderId: string;
}

export interface CancelableOriginalOrder extends CancelOrderIdentity {
  readonly state: CancelOrderLedgerState;
}

export interface CancelOrderRequest extends CancelOrderIdentity {
  readonly primaryLedgerState: CancelOrderLedgerState;
}

export interface CancelOperatorAuthorizationEvidence {
  readonly authorizationId: string;
  readonly actor: string;
  readonly action: string;
  readonly orderIdentity: CancelOrderIdentity;
  readonly canonicalRequestDigest: string;
  readonly authorizationDigest: string;
  readonly authorizedAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly evidenceReference: string;
}

export interface CancelOperatorAuthorizationCanonical {
  readonly canonicalContent: string;
  readonly authorizationDigest: string;
}

export interface CancelRiskCheck {
  readonly code: string;
  readonly outcome: "PASSED" | "BLOCKED";
  readonly message: string;
  readonly subjectKey: string | null;
}

export interface BlockedCancelRiskDecision {
  readonly scope: "CANCEL";
  readonly planOrderId: string;
  readonly canonicalRequestDigest: string;
  readonly evaluatedAt: IsoDateTime | null;
  readonly validUntil: IsoDateTime | null;
  readonly evidenceReferences: readonly string[];
  readonly status: "BLOCKED";
  readonly canExecute: false;
  readonly checks: readonly CancelRiskCheck[];
}

export type CancelRiskGateDecision = ReadyLiveOrderRiskDecision | BlockedCancelRiskDecision;

export interface CancelRiskGateInput {
  readonly originalOrder: CancelableOriginalOrder;
  readonly request: CancelOrderRequest;
  readonly operatorAuthorization: CancelOperatorAuthorizationEvidence | null;
  readonly now: Date;
}

/**
 * Cancellation is risk-reducing, so this gate intentionally has no kill-switch,
 * live-enabled, account-allowlist, or mutable operational-config input.
 */
export function evaluateCancelRiskGate(input: CancelRiskGateInput): CancelRiskGateDecision {
  const canonicalRequestDigest = createCancelRequestDigest(input.request);
  const originalMatched = identitiesMatch(input.originalOrder, input.request);
  const stateAllowed =
    (input.originalOrder.state === "PENDING" || input.originalOrder.state === "PARTIAL_FILLED") &&
    input.request.primaryLedgerState === input.originalOrder.state;
  const authorizationValid = evaluateOperatorAuthorization(
    input.operatorAuthorization,
    input.originalOrder,
    canonicalRequestDigest,
    input.now,
  );

  const checks: CancelRiskCheck[] = [
    passOrBlock(
      originalMatched,
      LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES[0],
      "CANCEL_ORIGINAL_ORDER_MISMATCH",
      "취소 요청이 원 주문의 변경 불가능한 식별자와 정확히 일치합니다.",
      "취소 요청이 원 주문의 계획·계좌 또는 브로커 주문 식별자와 일치하지 않습니다.",
      input.originalOrder.planOrderId,
    ),
    passOrBlock(
      stateAllowed,
      LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES[1],
      "CANCEL_ORDER_STATE_BLOCKED",
      "원 주문이 취소 가능한 미체결 또는 부분체결 상태입니다.",
      "원 주문 상태가 PENDING 또는 PARTIAL_FILLED가 아니거나 요청 상태와 일치하지 않습니다.",
      input.originalOrder.planOrderId,
    ),
    passOrBlock(
      authorizationValid,
      LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES[2],
      "CANCEL_REQUEST_UNAUTHORIZED",
      "원 주문과 취소 동작에 고정된 미사용 운영자 승인이 유효합니다.",
      "운영자 승인이 없거나 원 주문·취소 요청과 일치하지 않고, 만료·소비 또는 digest 오류가 있습니다.",
      input.originalOrder.planOrderId,
    ),
  ];

  const evaluatedAt = toIsoDateTime(input.now);
  const validUntil = toIsoDateTime(input.operatorAuthorization?.expiresAt ?? null);
  const evidenceReferences =
    input.operatorAuthorization?.evidenceReference.trim().length === 0 ||
    input.operatorAuthorization === null
      ? []
      : [input.operatorAuthorization.evidenceReference];

  if (
    checks.every(({ outcome }) => outcome === "PASSED") &&
    evaluatedAt !== null &&
    validUntil !== null
  ) {
    return {
      scope: "CANCEL",
      planOrderId: input.originalOrder.planOrderId,
      canonicalRequestDigest,
      evaluatedAt,
      validUntil,
      evidenceReferences,
      status: "READY",
      canExecute: true,
      checks: checks as readonly PassedLiveOrderRiskCheck[],
    };
  }

  return {
    scope: "CANCEL",
    planOrderId: input.originalOrder.planOrderId,
    canonicalRequestDigest,
    evaluatedAt,
    validUntil,
    evidenceReferences,
    status: "BLOCKED",
    canExecute: false,
    checks,
  };
}

export function createCancelRequestDigest(request: CancelOrderIdentity): string {
  return createLiveOrderRequestDigest({
    action: "CANCEL",
    planId: request.planId,
    planOrderId: request.planOrderId,
    logicalOrderId: request.logicalOrderId,
    accountId: request.accountId,
    brokerAccountReference: request.brokerAccountReference,
    clientOrderId: request.clientOrderId,
    brokerOrderId: request.brokerOrderId,
    economicTerms: null,
  });
}

export function createCancelOperatorAuthorizationDigest(
  evidence: Omit<CancelOperatorAuthorizationEvidence, "authorizationDigest" | "consumedAt">,
): string {
  return createCancelOperatorAuthorizationCanonical(evidence).authorizationDigest;
}

export function createCancelOperatorAuthorizationCanonical(
  evidence: Omit<CancelOperatorAuthorizationEvidence, "authorizationDigest" | "consumedAt">,
): CancelOperatorAuthorizationCanonical {
  const canonicalContent = JSON.stringify({
    version: CANCEL_OPERATOR_AUTHORIZATION_VERSION,
    authorizationId: evidence.authorizationId,
    actor: evidence.actor,
    action: evidence.action,
    orderIdentity: {
      planId: evidence.orderIdentity.planId,
      planOrderId: evidence.orderIdentity.planOrderId,
      logicalOrderId: evidence.orderIdentity.logicalOrderId,
      accountId: evidence.orderIdentity.accountId,
      clientOrderId: evidence.orderIdentity.clientOrderId,
      brokerOrderId: evidence.orderIdentity.brokerOrderId,
    },
    canonicalRequestDigest: evidence.canonicalRequestDigest,
    authorizedAt: evidence.authorizedAt.toISOString(),
    expiresAt: evidence.expiresAt.toISOString(),
    evidenceReference: evidence.evidenceReference,
  });
  return {
    canonicalContent,
    authorizationDigest: createHash("sha256").update(canonicalContent).digest("hex"),
  };
}

function evaluateOperatorAuthorization(
  evidence: CancelOperatorAuthorizationEvidence | null,
  originalOrder: CancelOrderIdentity,
  canonicalRequestDigest: string,
  now: Date,
): boolean {
  if (evidence === null) return false;

  const authorizedAtMs = evidence.authorizedAt.getTime();
  const expiresAtMs = evidence.expiresAt.getTime();
  const nowMs = now.getTime();
  if (
    !Number.isFinite(authorizedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    !Number.isFinite(nowMs) ||
    authorizedAtMs > nowMs ||
    expiresAtMs <= nowMs ||
    expiresAtMs <= authorizedAtMs ||
    expiresAtMs - authorizedAtMs > LIVE_ORDER_AUTHORIZATION_MAX_LIFETIME_MS
  ) {
    return false;
  }

  const expectedAuthorizationDigest = createCancelOperatorAuthorizationDigest({
    authorizationId: evidence.authorizationId,
    actor: evidence.actor,
    action: evidence.action,
    orderIdentity: evidence.orderIdentity,
    canonicalRequestDigest: evidence.canonicalRequestDigest,
    authorizedAt: evidence.authorizedAt,
    expiresAt: evidence.expiresAt,
    evidenceReference: evidence.evidenceReference,
  });

  return (
    evidence.authorizationId.trim().length > 0 &&
    evidence.actor.trim().length > 0 &&
    evidence.action === "CANCEL" &&
    evidence.evidenceReference.trim().length > 0 &&
    evidence.consumedAt === null &&
    identitiesMatch(originalOrder, evidence.orderIdentity) &&
    evidence.canonicalRequestDigest === canonicalRequestDigest &&
    /^[a-f0-9]{64}$/.test(evidence.authorizationDigest) &&
    evidence.authorizationDigest === expectedAuthorizationDigest
  );
}

function identitiesMatch(left: CancelOrderIdentity, right: CancelOrderIdentity): boolean {
  return (
    identityIsComplete(left) &&
    identityIsComplete(right) &&
    left.planId === right.planId &&
    left.planOrderId === right.planOrderId &&
    left.logicalOrderId === right.logicalOrderId &&
    left.accountId === right.accountId &&
    left.brokerAccountReference === right.brokerAccountReference &&
    left.clientOrderId === right.clientOrderId &&
    left.brokerOrderId === right.brokerOrderId
  );
}

function identityIsComplete(identity: CancelOrderIdentity): boolean {
  return [
    identity.planId,
    identity.planOrderId,
    identity.logicalOrderId,
    identity.accountId,
    identity.brokerAccountReference,
    identity.clientOrderId,
    identity.brokerOrderId,
  ].every((value) => value.trim().length > 0);
}

function passOrBlock(
  condition: boolean,
  passedCode: string,
  blockedCode: string,
  passedMessage: string,
  blockedMessage: string,
  subjectKey: string | null,
): CancelRiskCheck {
  return condition
    ? { code: passedCode, outcome: "PASSED", message: passedMessage, subjectKey }
    : { code: blockedCode, outcome: "BLOCKED", message: blockedMessage, subjectKey };
}

function toIsoDateTime(value: Date | null): IsoDateTime | null {
  if (value === null || !Number.isFinite(value.getTime())) return null;
  return value.toISOString() as IsoDateTime;
}
