import {
  LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES,
  createLiveOrderRequestDigest,
  type IsoDateTime,
  type LiveOrderAuthorizationBinding,
  type PassedLiveOrderRiskCheck,
  type ReadyLiveOrderRiskDecision,
} from "@portfolio-rebalancer/broker";

import type { ExecutionRiskGateDecision } from "./execution-risk-gate";
import type { PreSubmitOrderEvidenceDecision } from "./pre-submit-evidence";

type SubmitBinding = Extract<LiveOrderAuthorizationBinding, { readonly action: "SUBMIT" }>;

export interface LiveSubmitEvidenceReferences {
  readonly executionRiskEvidenceId: string;
  readonly preSubmitEvidenceId: string;
  readonly reservationId: string;
  readonly approvalId: string;
  readonly submissionAuthorizationId: string;
}

export type LiveSubmitRiskDecision =
  | ReadyLiveOrderRiskDecision
  | {
      readonly scope: "SUBMIT";
      readonly planOrderId: string;
      readonly canonicalRequestDigest: string;
      readonly status: "BLOCKED";
      readonly canExecute: false;
      readonly reasonCode: string;
      readonly message: string;
    };

export function composeLiveSubmitRiskDecision(input: {
  readonly binding: SubmitBinding;
  readonly executionDecision: ExecutionRiskGateDecision;
  readonly executionEvaluatedAt: Date;
  readonly executionEvidenceValidUntil: Date;
  readonly preSubmitDecision: PreSubmitOrderEvidenceDecision;
  readonly evidence: LiveSubmitEvidenceReferences;
  readonly now: Date;
}): LiveSubmitRiskDecision {
  const canonicalRequestDigest = createLiveOrderRequestDigest(input.binding);
  const blocked = (reasonCode: string, message: string): LiveSubmitRiskDecision => ({
    scope: "SUBMIT",
    planOrderId: input.binding.planOrderId,
    canonicalRequestDigest,
    status: "BLOCKED",
    canExecute: false,
    reasonCode,
    message,
  });

  if (input.executionDecision.status !== "READY" || !input.executionDecision.canExecute) {
    return blocked(
      "EXECUTION_RISK_DECISION_BLOCKED",
      "계획 전체 위험검사가 통과하지 않아 Live 주문 권한을 만들지 않습니다.",
    );
  }
  if (
    input.preSubmitDecision.status !== "READY" ||
    !input.preSubmitDecision.canSubmit ||
    input.preSubmitDecision.validUntil === null ||
    !input.preSubmitDecision.reservation.canReserve
  ) {
    return blocked(
      "PRE_SUBMIT_EVIDENCE_BLOCKED",
      "주문 직전 시세·장·계좌·거래제한 증거가 통과하지 않아 Live 주문을 차단합니다.",
    );
  }

  const nowMs = input.now.getTime();
  const executionEvaluatedAtMs = input.executionEvaluatedAt.getTime();
  const preSubmitEvaluatedAtMs = input.preSubmitDecision.evaluatedAt.getTime();
  const validUntilMs = Math.min(
    input.executionEvidenceValidUntil.getTime(),
    input.preSubmitDecision.validUntil.getTime(),
  );
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(executionEvaluatedAtMs) ||
    !Number.isFinite(preSubmitEvaluatedAtMs) ||
    !Number.isFinite(validUntilMs) ||
    executionEvaluatedAtMs > nowMs ||
    preSubmitEvaluatedAtMs > nowMs ||
    validUntilMs <= nowMs
  ) {
    return blocked(
      "LIVE_EVIDENCE_TIME_INVALID",
      "Live 위험 증거가 미래 시각이거나 이미 만료되어 주문 권한을 만들 수 없습니다.",
    );
  }

  const evidenceReferences = [
    input.evidence.executionRiskEvidenceId,
    input.evidence.preSubmitEvidenceId,
    input.evidence.reservationId,
    input.evidence.approvalId,
    input.evidence.submissionAuthorizationId,
  ];
  if (
    evidenceReferences.some((reference) => !isUuid(reference)) ||
    new Set(evidenceReferences).size !== evidenceReferences.length
  ) {
    return blocked(
      "LIVE_EVIDENCE_REFERENCE_INVALID",
      "Live 주문에 필요한 위험·pretrade·예약·승인·DB authorization 참조가 올바르지 않습니다.",
    );
  }

  const checks = [
    ...input.executionDecision.checks,
    ...input.preSubmitDecision.checks.map((check) => ({ ...check, subjectKey: null })),
  ].map((check) => ({ ...check, subjectKey: input.binding.planOrderId }));
  if (
    checks.some(({ code, outcome }) => code.trim().length === 0 || outcome !== "PASSED") ||
    new Set(checks.map(({ code }) => code)).size !== checks.length
  ) {
    return blocked(
      "LIVE_RISK_CHECK_SET_INVALID",
      "Live 주문 통과 검사에 차단·중복·빈 코드가 있어 권한을 만들지 않습니다.",
    );
  }

  const observedCodes = new Set(checks.map(({ code }) => code));
  const requiredCodes = [
    ...LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
    ...(input.binding.economicTerms.side === "BUY"
      ? LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES
      : LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES),
  ];
  const missing = requiredCodes.filter((code) => !observedCodes.has(code));
  if (missing.length > 0) {
    return blocked(
      "LIVE_REQUIRED_RISK_CHECK_MISSING",
      `Live 주문 필수 통과 검사가 누락되었습니다: ${missing.join(", ")}`,
    );
  }

  return {
    scope: "SUBMIT",
    planOrderId: input.binding.planOrderId,
    canonicalRequestDigest,
    evaluatedAt: new Date(
      Math.max(executionEvaluatedAtMs, preSubmitEvaluatedAtMs),
    ).toISOString() as IsoDateTime,
    validUntil: new Date(validUntilMs).toISOString() as IsoDateTime,
    evidenceReferences,
    status: "READY",
    canExecute: true,
    checks: checks as readonly PassedLiveOrderRiskCheck[],
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
