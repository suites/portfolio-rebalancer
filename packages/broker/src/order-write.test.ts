import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type { AccountId, IsoDateTime, SymbolCode } from "./models";
import {
  consumeLiveOrderAuthorization,
  createLiveOrderRequestDigest,
  issueLiveOrderCancelAuthorization,
  issueLiveOrderSubmitAuthorization,
  LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
  type BrokerLiveOrderPort,
  type KrwLimitDayOrderRequest,
  type LiveOrderAuthorizationBinding,
  type ReadyLiveOrderRiskDecision,
} from "./order-write";

const accountId = "11111111-1111-4111-8111-111111111111" as AccountId;
const issuedAt = new Date("2026-07-17T00:00:00.000Z");
const expiresAt = new Date("2026-07-17T00:00:30.000Z");
const audit = vi.fn().mockResolvedValue("audit-reference-1");
const economicTerms = {
  marketCountry: "KR",
  currency: "KRW",
  symbol: "005930" as SymbolCode,
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: "1",
  limitPriceMinor: "70000",
} as const;
const submitBinding = {
  action: "SUBMIT",
  planId: "plan-1",
  planOrderId: "plan-order-1",
  logicalOrderId: "logical-order-1",
  accountId,
  brokerAccountReference: "17",
  clientOrderId: "pr1_abcdefghijklmnopqrstuvwxyz123456",
  brokerOrderId: null,
  economicTerms,
} satisfies LiveOrderAuthorizationBinding;
const cancelBinding = {
  ...submitBinding,
  action: "CANCEL",
  brokerOrderId: "broker-order-1",
  economicTerms: null,
} satisfies LiveOrderAuthorizationBinding;

function readyRiskDecision(binding: LiveOrderAuthorizationBinding): ReadyLiveOrderRiskDecision {
  const codes =
    binding.action === "SUBMIT"
      ? [
          ...LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
          ...(binding.economicTerms.side === "BUY"
            ? LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES
            : LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES),
        ]
      : LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES;
  return {
    scope: binding.action,
    planOrderId: binding.planOrderId,
    canonicalRequestDigest: createLiveOrderRequestDigest(binding),
    evaluatedAt: "2026-07-17T00:00:00.000Z" as IsoDateTime,
    validUntil: "2026-07-17T00:00:30.000Z" as IsoDateTime,
    evidenceReferences: ["execution-risk-1", "pre-submit-1", "reservation-1", "claim-1"],
    status: "READY",
    canExecute: true,
    checks: codes.map((code) => ({
      code,
      outcome: "PASSED",
      message: "통과",
      subjectKey: binding.planOrderId,
    })),
  };
}

const submitRiskDecision = readyRiskDecision(submitBinding);
const cancelRiskDecision = readyRiskDecision(cancelBinding);

function submitAuthorization() {
  return issueLiveOrderSubmitAuthorization({
    authorizationId: "authorization-1",
    planId: submitBinding.planId,
    planOrderId: submitBinding.planOrderId,
    logicalOrderId: submitBinding.logicalOrderId,
    accountId,
    brokerAccountReference: submitBinding.brokerAccountReference,
    clientOrderId: submitBinding.clientOrderId,
    riskDecision: submitRiskDecision,
    issuedAt,
    expiresAt,
    ledgerState: "SUBMITTING",
    economicTerms,
    audit,
  });
}

describe("live order authorization", () => {
  it("READY 위험 검사와 SUBMITTING 상태를 짧은 일회성 권한으로 고정한다", () => {
    const authorization = submitAuthorization();

    expect(
      consumeLiveOrderAuthorization(
        authorization,
        submitBinding,
        new Date("2026-07-17T00:00:01.000Z"),
      ),
    ).toEqual({ status: "AUTHORIZED" });
    expect(
      consumeLiveOrderAuthorization(
        authorization,
        submitBinding,
        new Date("2026-07-17T00:00:02.000Z"),
      ),
    ).toEqual({ status: "ALREADY_CONSUMED" });
  });

  it("계획·주문·계좌·clientOrderId·경제조건 중 하나라도 다르면 소비 후 차단한다", () => {
    const authorization = submitAuthorization();

    expect(
      consumeLiveOrderAuthorization(
        authorization,
        { ...submitBinding, planOrderId: "different" },
        new Date("2026-07-17T00:00:01.000Z"),
      ),
    ).toEqual({ status: "BINDING_MISMATCH" });
    expect(
      consumeLiveOrderAuthorization(
        authorization,
        submitBinding,
        new Date("2026-07-17T00:00:02.000Z"),
      ),
    ).toEqual({ status: "ALREADY_CONSUMED" });

    const economicAuthorization = submitAuthorization();
    expect(
      consumeLiveOrderAuthorization(
        economicAuthorization,
        {
          ...submitBinding,
          economicTerms: { ...economicTerms, limitPriceMinor: "70001" },
        },
        new Date("2026-07-17T00:00:01.000Z"),
      ),
    ).toEqual({ status: "BINDING_MISMATCH" });
  });

  it("만료되었거나 외부에서 만든 모양만 같은 객체를 승인하지 않는다", () => {
    const authorization = submitAuthorization();
    expect(
      consumeLiveOrderAuthorization(
        authorization,
        submitBinding,
        new Date("2026-07-17T00:00:30.000Z"),
      ),
    ).toEqual({ status: "EXPIRED" });

    expect(
      consumeLiveOrderAuthorization(
        { ...authorization },
        submitBinding,
        new Date("2026-07-17T00:00:01.000Z"),
      ),
    ).toEqual({ status: "NOT_ISSUED" });
  });

  it("30초 초과·빈 검사·감사 callback 부재 권한은 발급하지 않는다", () => {
    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt: new Date("2026-07-17T00:00:30.001Z"),
      }),
    ).toThrow("30초 이하");

    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        riskDecision: { ...submitRiskDecision, checks: [] },
      }),
    ).toThrow("위험 검사");

    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        audit: undefined as never,
      }),
    ).toThrow("감사 callback");
  });

  it("필수 제출 검사 하나라도 빠지거나 scope가 다르면 권한을 발급하지 않는다", () => {
    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        riskDecision: {
          ...submitRiskDecision,
          checks: submitRiskDecision.checks.filter(
            ({ code }) => code !== "ORDER_RESERVATION_READY",
          ),
        },
      }),
    ).toThrow("ORDER_RESERVATION_READY");

    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        riskDecision: cancelRiskDecision,
      }),
    ).toThrow("위험 검사");
  });

  it("결정적 pr1 clientOrderId 형식이 아니면 권한을 발급하지 않는다", () => {
    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        clientOrderId: "manual-order-id",
      }),
    ).toThrow("결정적 pr1");
  });

  it("취소 권한은 원주문 ID와 현재 primary 상태를 별도로 고정한다", () => {
    const authorization = issueLiveOrderCancelAuthorization({
      authorizationId: "cancel-authorization-1",
      planId: "plan-1",
      planOrderId: "plan-order-1",
      logicalOrderId: "logical-order-1",
      accountId,
      brokerAccountReference: "17",
      clientOrderId: "pr1_abcdefghijklmnopqrstuvwxyz123456",
      brokerOrderId: "broker-order-1",
      riskDecision: cancelRiskDecision,
      issuedAt,
      expiresAt,
      ledgerState: "PARTIAL_FILLED",
      audit,
    });

    expect(authorization).toMatchObject({
      action: "CANCEL",
      ledgerState: "PARTIAL_FILLED",
      brokerOrderId: "broker-order-1",
    });
  });

  it("위험 결정 유효기간보다 긴 권한과 다른 주문 digest를 차단한다", () => {
    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        riskDecision: {
          ...submitRiskDecision,
          validUntil: "2026-07-17T00:00:29.999Z" as IsoDateTime,
        },
      }),
    ).toThrow("유효기간");

    expect(() =>
      issueLiveOrderSubmitAuthorization({
        ...submitAuthorization(),
        issuedAt,
        expiresAt,
        riskDecision: {
          ...submitRiskDecision,
          canonicalRequestDigest: "0".repeat(64),
        },
      }),
    ).toThrow("canonical request");
  });
});

describe("BrokerLiveOrderPort", () => {
  it("KR/KRW LIMIT DAY 정수 수량 주문 계약만 노출한다", () => {
    expectTypeOf<
      Parameters<BrokerLiveOrderPort["submitOrder"]>[1]
    >().toEqualTypeOf<KrwLimitDayOrderRequest>();
    expectTypeOf<KrwLimitDayOrderRequest["quantity"]>().toEqualTypeOf<bigint>();
    expectTypeOf<KrwLimitDayOrderRequest["marketCountry"]>().toEqualTypeOf<"KR">();
    expectTypeOf<KrwLimitDayOrderRequest["currency"]>().toEqualTypeOf<"KRW">();
    expectTypeOf<KrwLimitDayOrderRequest["orderType"]>().toEqualTypeOf<"LIMIT">();
    expectTypeOf<KrwLimitDayOrderRequest["timeInForce"]>().toEqualTypeOf<"DAY">();
  });
});
