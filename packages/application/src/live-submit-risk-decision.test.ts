import {
  LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
  issueLiveOrderSubmitAuthorization,
  type AccountId,
  type LiveOrderAuthorizationBinding,
  type SymbolCode,
} from "@portfolio-rebalancer/broker";
import { describe, expect, it, vi } from "vitest";

import type { ExecutionRiskGateDecision } from "./execution-risk-gate";
import { composeLiveSubmitRiskDecision } from "./live-submit-risk-decision";
import type { PreSubmitOrderEvidenceDecision } from "./pre-submit-evidence";

const accountId = "11111111-1111-4111-8111-111111111111" as AccountId;
const binding = {
  action: "SUBMIT",
  planId: "plan-1",
  planOrderId: "plan-order-1",
  logicalOrderId: "logical-order-1",
  accountId,
  brokerAccountReference: "17",
  clientOrderId: `pr1_${"a".repeat(32)}`,
  brokerOrderId: null,
  economicTerms: {
    marketCountry: "KR",
    currency: "KRW",
    symbol: "005930" as SymbolCode,
    side: "BUY",
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: "1",
    limitPriceMinor: "50000",
  },
} satisfies LiveOrderAuthorizationBinding;
const now = new Date("2026-07-17T00:00:10.000Z");

describe("composeLiveSubmitRiskDecision", () => {
  it("계획·주문별 검사와 DB 증거를 합쳐 브로커 권한으로 바로 변환한다", () => {
    const decision = composeLiveSubmitRiskDecision(fixture());
    expect(decision).toMatchObject({
      status: "READY",
      canExecute: true,
      scope: "SUBMIT",
      planOrderId: "plan-order-1",
      evaluatedAt: "2026-07-17T00:00:09.000Z",
      validUntil: "2026-07-17T00:00:25.000Z",
    });
    if (decision.status !== "READY") throw new Error("READY 결정이 필요합니다.");

    expect(() =>
      issueLiveOrderSubmitAuthorization({
        authorizationId: "authorization-1",
        planId: binding.planId,
        planOrderId: binding.planOrderId,
        logicalOrderId: binding.logicalOrderId,
        accountId,
        brokerAccountReference: binding.brokerAccountReference,
        clientOrderId: binding.clientOrderId,
        economicTerms: binding.economicTerms,
        riskDecision: decision,
        issuedAt: now,
        expiresAt: new Date("2026-07-17T00:00:20.000Z"),
        ledgerState: "SUBMITTING",
        audit: vi.fn().mockResolvedValue("dispatch-claim-1"),
      }),
    ).not.toThrow();
  });

  it("주문별 필수 검사 누락·만료·잘못된 DB 참조를 각각 차단한다", () => {
    const missingCheck = fixture();
    const missing = composeLiveSubmitRiskDecision({
      ...missingCheck,
      preSubmitDecision: {
        ...missingCheck.preSubmitDecision,
        checks: missingCheck.preSubmitDecision.checks.filter(
          ({ code }) => code !== "BUYING_POWER_SUFFICIENT",
        ),
      },
    });
    expect(missing).toMatchObject({
      status: "BLOCKED",
      reasonCode: "LIVE_REQUIRED_RISK_CHECK_MISSING",
    });

    expect(
      composeLiveSubmitRiskDecision({
        ...fixture(),
        executionEvidenceValidUntil: now,
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "LIVE_EVIDENCE_TIME_INVALID" });

    const invalidEvidence = fixture();
    expect(
      composeLiveSubmitRiskDecision({
        ...invalidEvidence,
        evidence: { ...invalidEvidence.evidence, approvalId: "not-a-uuid" },
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "LIVE_EVIDENCE_REFERENCE_INVALID" });
  });

  it("계획 전체 또는 주문 직전 결정이 BLOCKED면 합성하지 않는다", () => {
    expect(
      composeLiveSubmitRiskDecision({
        ...fixture(),
        executionDecision: {
          status: "BLOCKED",
          canExecute: false,
          checks: [
            {
              code: "KILL_SWITCH_ACTIVE",
              outcome: "BLOCKED",
              message: "차단",
              subjectKey: null,
            },
          ],
        },
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "EXECUTION_RISK_DECISION_BLOCKED" });

    const base = fixture();
    expect(
      composeLiveSubmitRiskDecision({
        ...base,
        preSubmitDecision: {
          ...base.preSubmitDecision,
          status: "BLOCKED",
          canSubmit: false,
          validUntil: null,
        },
      }),
    ).toMatchObject({ status: "BLOCKED", reasonCode: "PRE_SUBMIT_EVIDENCE_BLOCKED" });
  });
});

function fixture() {
  const preSubmitBaseCodes = new Set<string>([
    "PRE_SUBMIT_EVIDENCE_IDENTITY_MATCHED",
    "QUOTE_FRESH",
    "PRICE_MOVEMENT_ACCEPTABLE",
    "PRICE_LIMIT_FRESH",
    "MARKET_SESSION_OPEN",
    "ORDER_PRICE_WITHIN_DAILY_LIMITS",
    "ORDER_RESERVATION_READY",
    "INSTRUMENT_WARNING_EVIDENCE_FRESH",
    "INSTRUMENT_TRADE_RESTRICTIONS_CLEAR",
    "BROKER_OPEN_ORDERS_RECONCILED",
    "NO_CONFLICTING_BROKER_OPEN_ORDER",
  ]);
  const executionCodes = LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES.filter(
    (code) => !preSubmitBaseCodes.has(code),
  );
  const preSubmitCodes = [
    ...preSubmitBaseCodes,
    ...LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES,
  ];
  const executionDecision: ExecutionRiskGateDecision = {
    status: "READY",
    canExecute: true,
    checks: executionCodes.map((code) => ({
      code,
      outcome: "PASSED",
      message: "통과",
      subjectKey: null,
    })),
  };
  const preSubmitDecision: PreSubmitOrderEvidenceDecision = {
    status: "READY",
    canSubmit: true,
    checks: preSubmitCodes.map((code) => ({ code, outcome: "PASSED", message: "통과" })),
    reservation: {
      status: "READY",
      canReserve: true,
      reasonCode: "ORDER_RESERVATION_READY",
      message: "통과",
      plannedGrossMinor: 50_000n,
      reservedGrossMinor: 50_000n,
    },
    evaluatedAt: new Date("2026-07-17T00:00:09.000Z"),
    validUntil: new Date("2026-07-17T00:00:25.000Z"),
  };
  return {
    binding,
    executionDecision,
    executionEvaluatedAt: new Date("2026-07-17T00:00:08.000Z"),
    executionEvidenceValidUntil: new Date("2026-07-17T00:00:30.000Z"),
    preSubmitDecision,
    evidence: {
      executionRiskEvidenceId: "11111111-1111-4111-8111-111111111111",
      preSubmitEvidenceId: "22222222-2222-4222-8222-222222222222",
      reservationId: "33333333-3333-4333-8333-333333333333",
      approvalId: "44444444-4444-4444-8444-444444444444",
      submissionAuthorizationId: "55555555-5555-4555-8555-555555555555",
    },
    now,
  };
}
