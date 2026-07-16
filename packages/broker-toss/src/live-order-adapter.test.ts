import {
  createLiveOrderRequestDigest,
  issueLiveOrderCancelAuthorization,
  issueLiveOrderSubmitAuthorization,
  LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES,
  LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
  type AccountId,
  type BrokerOrderCancelRequest,
  type IsoDateTime,
  type KrwLimitDayOrderRequest,
  type LiveOrderAuditIntent,
  type LiveOrderAuthorizationBinding,
  type ReadyLiveOrderRiskDecision,
  type SymbolCode,
} from "@portfolio-rebalancer/broker";
import { describe, expect, it, vi } from "vitest";

import { TossOpenApiClient } from "./client";
import {
  TossLiveOrderAdapter,
  type TossLiveOrderTransport,
  type TossLiveOrderTransportResponse,
} from "./live-order-adapter";
import { TossTransportError } from "./transport";

const now = new Date("2026-07-17T00:00:01.000Z");
const accountId = "11111111-1111-4111-8111-111111111111" as AccountId;
const clientOrderId = "pr1_abcdefghijklmnopqrstuvwxyz123456";
const audit = vi
  .fn<(intent: LiveOrderAuditIntent) => Promise<string>>()
  .mockResolvedValue("authorization-audit-1");

const request: KrwLimitDayOrderRequest = {
  planId: "plan-1",
  planOrderId: "plan-order-1",
  logicalOrderId: "logical-order-1",
  accountId,
  brokerAccountReference: "17",
  clientOrderId,
  marketCountry: "KR",
  currency: "KRW",
  symbol: "005930" as SymbolCode,
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: 1n,
  limitPriceMinor: 70_000n,
};

const cancelRequest: BrokerOrderCancelRequest = {
  planId: request.planId,
  planOrderId: request.planOrderId,
  logicalOrderId: request.logicalOrderId,
  accountId,
  brokerAccountReference: "17",
  clientOrderId,
  brokerOrderId: "broker-order-1",
  primaryLedgerState: "PENDING",
};

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

function economicTerms(input: KrwLimitDayOrderRequest) {
  return {
    marketCountry: input.marketCountry,
    currency: input.currency,
    symbol: input.symbol,
    side: input.side,
    orderType: input.orderType,
    timeInForce: input.timeInForce,
    quantity: input.quantity.toString(),
    limitPriceMinor: input.limitPriceMinor.toString(),
  };
}

function submitAuthorization(
  overrides: Partial<Parameters<typeof issueLiveOrderSubmitAuthorization>[0]> = {},
) {
  const base = {
    authorizationId: "authorization-submit-1",
    planId: request.planId,
    planOrderId: request.planOrderId,
    logicalOrderId: request.logicalOrderId,
    accountId,
    brokerAccountReference: "17",
    clientOrderId,
    issuedAt: new Date("2026-07-17T00:00:00.000Z"),
    expiresAt: new Date("2026-07-17T00:00:30.000Z"),
    ledgerState: "SUBMITTING" as const,
    economicTerms: economicTerms(request),
    audit,
    ...overrides,
  };
  const binding = {
    action: "SUBMIT",
    planId: base.planId,
    planOrderId: base.planOrderId,
    logicalOrderId: base.logicalOrderId,
    accountId: base.accountId,
    brokerAccountReference: base.brokerAccountReference,
    clientOrderId: base.clientOrderId,
    brokerOrderId: null,
    economicTerms: base.economicTerms,
  } satisfies LiveOrderAuthorizationBinding;
  return issueLiveOrderSubmitAuthorization({
    ...base,
    riskDecision: base.riskDecision ?? readyRiskDecision(binding),
  });
}

function cancelAuthorization() {
  const binding = {
    action: "CANCEL",
    planId: request.planId,
    planOrderId: request.planOrderId,
    logicalOrderId: request.logicalOrderId,
    accountId,
    brokerAccountReference: "17",
    clientOrderId,
    brokerOrderId: cancelRequest.brokerOrderId,
    economicTerms: null,
  } satisfies LiveOrderAuthorizationBinding;
  return issueLiveOrderCancelAuthorization({
    authorizationId: "authorization-cancel-1",
    planId: binding.planId,
    planOrderId: binding.planOrderId,
    logicalOrderId: binding.logicalOrderId,
    accountId,
    brokerAccountReference: binding.brokerAccountReference,
    clientOrderId,
    brokerOrderId: cancelRequest.brokerOrderId,
    riskDecision: readyRiskDecision(binding),
    issuedAt: new Date("2026-07-17T00:00:00.000Z"),
    expiresAt: new Date("2026-07-17T00:00:30.000Z"),
    ledgerState: "PENDING",
    audit,
  });
}

function response(httpStatus: number, rawPayload: unknown): TossLiveOrderTransportResponse {
  return { httpStatus, rawPayload, metadata: null, auditReference: null };
}

function createTransport(
  submitResult: TossLiveOrderTransportResponse | Error = response(500, { error: {} }),
): TossLiveOrderTransport & {
  submitOrder: ReturnType<typeof vi.fn<TossLiveOrderTransport["submitOrder"]>>;
  getOrder: ReturnType<typeof vi.fn<TossLiveOrderTransport["getOrder"]>>;
  listOpenOrders: ReturnType<typeof vi.fn<TossLiveOrderTransport["listOpenOrders"]>>;
  cancelOrder: ReturnType<typeof vi.fn<TossLiveOrderTransport["cancelOrder"]>>;
} {
  const submitOrder = vi.fn<TossLiveOrderTransport["submitOrder"]>();
  if (submitResult instanceof Error) submitOrder.mockRejectedValue(submitResult);
  else submitOrder.mockResolvedValue(submitResult);
  return {
    submitOrder,
    getOrder: vi.fn<TossLiveOrderTransport["getOrder"]>(),
    listOpenOrders: vi.fn<TossLiveOrderTransport["listOpenOrders"]>(),
    cancelOrder: vi.fn<TossLiveOrderTransport["cancelOrder"]>(),
  };
}

function orderPayload(
  status: string,
  overrides: { readonly quantity?: string; readonly filledQuantity?: string } = {},
) {
  const quantity = overrides.quantity ?? "2";
  const filledQuantity =
    overrides.filledQuantity ??
    (status === "PARTIAL_FILLED" ? "1" : status === "FILLED" ? quantity : "0");
  const hasFill = BigInt(filledQuantity) > 0n;
  return {
    result: {
      orderId: "broker-order-1",
      symbol: "005930",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      status,
      price: "70000",
      quantity,
      currency: "KRW",
      orderedAt: "2026-07-17T09:00:00+09:00",
      canceledAt: null,
      execution: {
        filledQuantity,
        averageFilledPrice: hasFill ? "70000" : null,
        filledAmount: hasFill ? (BigInt(filledQuantity) * 70_000n).toString() : null,
        commission: null,
        tax: null,
        filledAt: hasFill ? "2026-07-17T09:00:01+09:00" : null,
        settlementDate: null,
      },
    },
  };
}

describe("TossLiveOrderAdapter submit", () => {
  it("일회성 권한을 감사한 뒤 KR LIMIT DAY 주문 한 번만 전송하고 ACK를 PENDING으로 기록한다", async () => {
    const rawPayload = {
      result: { orderId: "broker-order-1", clientOrderId },
      futureField: "preserved",
    };
    const transport = createTransport(response(200, rawPayload));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });
    const authorization = submitAuthorization();

    await expect(adapter.submitOrder(authorization, request)).resolves.toMatchObject({
      outcome: "ACKNOWLEDGED",
      normalizedState: "PENDING",
      brokerOrderId: "broker-order-1",
      clientOrderId,
      rawPayload,
      metadata: {
        auditReference: "authorization-audit-1",
        transportAuditReference: null,
      },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SUBMIT",
        planId: "plan-1",
        planOrderId: "plan-order-1",
        accountId,
        clientOrderId,
        economicTerms: economicTerms(request),
      }),
    );
    expect(audit.mock.calls[0]?.[0].canonicalRequestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(transport.submitOrder).toHaveBeenCalledExactlyOnceWith({
      accountSeq: 17,
      symbol: "005930",
      side: "BUY",
      quantity: "1",
      price: "70000",
      clientOrderId,
    });

    await expect(adapter.submitOrder(authorization, request)).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      reasonCode: "LIVE_AUTHORIZATION_ALREADY_CONSUMED",
    });
    expect(transport.submitOrder).toHaveBeenCalledTimes(1);
  });

  it("승인 뒤 종목·방향·수량·가격 중 하나라도 바뀌면 네트워크 전에 차단한다", async () => {
    const transport = createTransport(response(200, {}));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });
    const changedRequests: readonly KrwLimitDayOrderRequest[] = [
      { ...request, symbol: "000660" as SymbolCode },
      { ...request, side: "SELL" },
      { ...request, quantity: 2n },
      { ...request, limitPriceMinor: 70_001n },
    ];

    for (const changed of changedRequests) {
      await expect(adapter.submitOrder(submitAuthorization(), changed)).resolves.toMatchObject({
        outcome: "INTEGRITY_BLOCKED",
        reasonCode: "LIVE_AUTHORIZATION_BINDING_MISMATCH",
      });
    }
    expect(transport.submitOrder).not.toHaveBeenCalled();
  });

  it("권한 binding, accountSeq, 감사 참조가 잘못되면 네트워크 전에 차단한다", async () => {
    const transport = createTransport(response(200, {}));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(
      adapter.submitOrder(submitAuthorization(), { ...request, planOrderId: "other" }),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      reasonCode: "LIVE_AUTHORIZATION_BINDING_MISMATCH",
    });
    await expect(
      adapter.submitOrder(submitAuthorization({ brokerAccountReference: "9007199254740992" }), {
        ...request,
        brokerAccountReference: "9007199254740992",
      }),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      reasonCode: "INVALID_TOSS_ACCOUNT_SEQ",
    });
    await expect(
      adapter.submitOrder(submitAuthorization({ audit: vi.fn().mockResolvedValue(" ") }), request),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      reasonCode: "LIVE_ORDER_AUDIT_FAILED",
    });
    expect(transport.submitOrder).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid-request"],
    [422, "market-closed"],
  ])("알려진 %i 오류는 REJECTED로 분류한다", async (httpStatus, code) => {
    const rawPayload = { error: { requestId: "request-1", code, message: "거부" } };
    const adapter = new TossLiveOrderAdapter(createTransport(response(httpStatus, rawPayload)), {
      now: () => now,
    });

    await expect(adapter.submitOrder(submitAuthorization(), request)).resolves.toMatchObject({
      outcome: "REJECTED",
      normalizedState: "REJECTED",
      rawPayload,
      metadata: { requestId: "request-1" },
    });
  });

  it.each([
    [409, "request-in-progress", "AMBIGUOUS", "TOSS_ORDER_REQUEST_IN_PROGRESS"],
    [409, "idempotency-key-conflict", "INTEGRITY_BLOCKED", "TOSS_IDEMPOTENCY_KEY_CONFLICT"],
    [400, "idempotency-key-conflict", "INTEGRITY_BLOCKED", "TOSS_IDEMPOTENCY_KEY_CONFLICT"],
    [422, "idempotency-key-conflict", "INTEGRITY_BLOCKED", "TOSS_IDEMPOTENCY_KEY_CONFLICT"],
    [422, "request-in-progress", "AMBIGUOUS", "TOSS_ORDER_REQUEST_IN_PROGRESS"],
    [429, "rate-limit-exceeded", "AMBIGUOUS", "TOSS_CREATE_ORDER_HTTP_429_AMBIGUOUS"],
    [500, "internal-error", "AMBIGUOUS", "TOSS_CREATE_ORDER_HTTP_500_AMBIGUOUS"],
  ])("%i %s를 %s로 fail closed 한다", async (httpStatus, code, outcome, reasonCode) => {
    const adapter = new TossLiveOrderAdapter(
      createTransport(
        response(httpStatus, {
          error: { requestId: "request-1", code, message: "upstream" },
        }),
      ),
      { now: () => now },
    );

    await expect(adapter.submitOrder(submitAuthorization(), request)).resolves.toMatchObject({
      outcome,
      reasonCode,
    });
  });

  it("불완전 200과 clientOrderId 불일치는 알려진 broker ID를 보존한 AMBIGUOUS다", async () => {
    const incomplete = new TossLiveOrderAdapter(
      createTransport(response(200, { result: { orderId: "broker-order-incomplete" } })),
      {
        now: () => now,
      },
    );
    await expect(incomplete.submitOrder(submitAuthorization(), request)).resolves.toMatchObject({
      outcome: "AMBIGUOUS",
      reasonCode: "TOSS_CREATE_ORDER_200_INCOMPLETE",
      brokerOrderId: "broker-order-incomplete",
    });

    const mismatched = new TossLiveOrderAdapter(
      createTransport(
        response(200, {
          result: { orderId: "broker-order-1", clientOrderId: "different" },
        }),
      ),
      { now: () => now },
    );
    await expect(mismatched.submitOrder(submitAuthorization(), request)).resolves.toMatchObject({
      outcome: "AMBIGUOUS",
      reasonCode: "TOSS_CLIENT_ORDER_ID_MISMATCH",
      brokerOrderId: "broker-order-1",
    });
  });

  it.each(["TOSS_API_TIMEOUT", "TOSS_API_NETWORK_FAILED"] as const)(
    "%s는 상태 대사 전 재제출할 수 없는 UNKNOWN이다",
    async (code) => {
      const adapter = new TossLiveOrderAdapter(createTransport(new TossTransportError(code)), {
        now: () => now,
      });
      await expect(adapter.submitOrder(submitAuthorization(), request)).resolves.toMatchObject({
        outcome: "AMBIGUOUS",
        normalizedState: "UNKNOWN",
        reasonCode: code,
      });
    },
  );

  it("실제 client 경로도 쓰기 429를 자동 재시도하지 않는다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { requestId: "request-1", code: "rate-limit-exceeded", message: "slow" },
          }),
          {
            status: 429,
            headers: { "content-type": "application/json", "retry-after": "1" },
          },
        ),
      );
    const client = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      { fetch: fetchMock, sleep: vi.fn().mockResolvedValue(undefined) },
    );

    await expect(
      client.createLiveOrderAdapter({ now: () => now }).submitOrder(submitAuthorization(), request),
    ).resolves.toMatchObject({ outcome: "AMBIGUOUS" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const submittedRequest = fetchMock.mock.calls[1]?.[0];
    expect(submittedRequest).toBeInstanceOf(Request);
    expect((submittedRequest as Request).headers.get("authorization")).toBe(
      "Bearer synthetic-token",
    );
    expect((submittedRequest as Request).headers.get("x-tossinvest-account")).toBe("17");
    await expect((submittedRequest as Request).clone().json()).resolves.toMatchObject({
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "1",
      clientOrderId,
    });
  });

  it("POST 뒤 응답 감사 저장이 실패해도 브로커 주문 ID와 원응답을 보존해 재제출을 막는다", async () => {
    const rawPayload = { result: { orderId: "broker-order-audit-failed", clientOrderId } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(rawPayload), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "request-1" },
        }),
      );
    const client = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: fetchMock,
        onResponseMetadata: (metadata) => {
          if (metadata.operationId === "createOrder") throw new Error("ledger unavailable");
          return "token-audit";
        },
      },
    );

    await expect(
      client.createLiveOrderAdapter({ now: () => now }).submitOrder(submitAuthorization(), request),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      normalizedState: "UNKNOWN_BLOCKED",
      reasonCode: "TOSS_RESPONSE_AUDIT_FAILED",
      brokerOrderId: "broker-order-audit-failed",
      rawPayload,
      metadata: {
        httpStatus: 200,
        requestId: "request-1",
        auditReference: "authorization-audit-1",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("OAuth 응답 감사 실패는 주문 POST 결과로 오인하거나 토큰 payload를 노출하지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "must-not-be-exposed",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: fetchMock,
        onResponseMetadata: () => {
          throw new Error("audit unavailable");
        },
      },
    );

    await expect(
      client.createLiveOrderAdapter({ now: () => now }).submitOrder(submitAuthorization(), request),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      normalizedState: "UNKNOWN_BLOCKED",
      reasonCode: "TOSS_PRE_DISPATCH_AUDIT_FAILED_ISSUE_OAUTH2_TOKEN",
      brokerOrderId: null,
      rawPayload: null,
      metadata: {
        dispatchStage: "PRE_DISPATCH",
        upstreamOperationId: "issueOAuth2Token",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("TossLiveOrderAdapter order reconciliation", () => {
  it.each([
    ["PENDING", "PENDING", "NONE", null, true],
    ["PENDING_CANCEL", "PENDING", "PENDING", null, true],
    ["PARTIAL_FILLED", "PARTIAL_FILLED", "NONE", null, true],
    ["CANCEL_REJECTED", null, "REJECTED", "CANCEL_REJECTED", false],
    ["REPLACE_REJECTED", null, "REJECTED", "REPLACE_REJECTED", false],
    ["PENDING_REPLACE", "UNKNOWN_BLOCKED", "UNSUPPORTED_BLOCKED", null, true],
    ["REPLACED", "UNKNOWN_BLOCKED", "UNSUPPORTED_BLOCKED", null, true],
    ["FUTURE_STATUS", "UNKNOWN_BLOCKED", "UNSUPPORTED_BLOCKED", null, true],
  ])(
    "%s 상태의 primary/취소/auxiliary 의미를 보존한다",
    async (status, primaryState, cancelLifecycle, auxiliaryStatus, mayOverwritePrimary) => {
      const transport = createTransport();
      transport.getOrder.mockResolvedValue(response(200, orderPayload(status)));
      const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

      await expect(
        adapter.getOrder({
          accountId,
          brokerAccountReference: "17",
          brokerOrderId: "broker-order-1",
        }),
      ).resolves.toMatchObject({
        outcome: "OBSERVED",
        value: {
          brokerStatusRaw: status,
          primaryState,
          cancelLifecycle,
          auxiliaryStatus,
          mayOverwritePrimary,
        },
      });
    },
  );

  it("부분체결 뒤 취소 대기는 PENDING으로 역행시키지 않는다", async () => {
    const transport = createTransport();
    transport.getOrder.mockResolvedValue(
      response(200, orderPayload("PENDING_CANCEL", { filledQuantity: "1" })),
    );
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(
      adapter.getOrder({
        accountId,
        brokerAccountReference: "17",
        brokerOrderId: "broker-order-1",
      }),
    ).resolves.toMatchObject({
      outcome: "OBSERVED",
      value: {
        primaryState: "PARTIAL_FILLED",
        cancelLifecycle: "PENDING",
        filledQuantity: 1n,
      },
    });
  });

  it.each([
    ["FILLED", { filledQuantity: "0" }, "TOSS_ORDER_FILLED_QUANTITY_MISMATCH"],
    ["PARTIAL_FILLED", { filledQuantity: "0" }, "TOSS_ORDER_PARTIAL_FILL_INVALID"],
    [
      "PARTIAL_FILLED",
      { quantity: "2", filledQuantity: "3" },
      "TOSS_ORDER_FILLED_QUANTITY_EXCEEDS_ORDER_QUANTITY",
    ],
  ])("상태·체결 불변식 위반 %s 응답을 차단한다", async (status, overrides, reasonCode) => {
    const transport = createTransport();
    transport.getOrder.mockResolvedValue(response(200, orderPayload(status, overrides)));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(
      adapter.getOrder({
        accountId,
        brokerAccountReference: "17",
        brokerOrderId: "broker-order-1",
      }),
    ).resolves.toMatchObject({
      outcome: "INTEGRITY_BLOCKED",
      value: null,
      reasonCode,
    });
  });

  it("OPEN 목록은 전량 응답만 허용하고 raw payload를 함께 반환한다", async () => {
    const rawPayload = {
      result: { orders: [orderPayload("PENDING").result], nextCursor: null, hasNext: false },
    };
    const transport = createTransport();
    transport.listOpenOrders.mockResolvedValue(response(200, rawPayload));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(
      adapter.listOpenOrders({ accountId, brokerAccountReference: "17" }),
    ).resolves.toMatchObject({
      outcome: "OBSERVED",
      value: [{ primaryState: "PENDING" }],
      rawPayload,
    });
    expect(transport.listOpenOrders).toHaveBeenCalledExactlyOnceWith({ accountSeq: 17 });
  });
});

describe("TossLiveOrderAdapter cancel", () => {
  it("취소 200의 새 orderId를 action ID로 분리하고 원주문을 CANCELED로 단정하지 않는다", async () => {
    const transport = createTransport();
    transport.cancelOrder.mockResolvedValue(
      response(200, { result: { orderId: "cancel-action-order-1" } }),
    );
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(adapter.cancelOrder(cancelAuthorization(), cancelRequest)).resolves.toMatchObject({
      outcome: "ACKNOWLEDGED",
      primaryState: "PENDING",
      cancelLifecycle: "REQUEST_ACCEPTED",
      brokerOrderId: "broker-order-1",
      brokerActionOrderId: "cancel-action-order-1",
      reasonCode: "TOSS_CANCEL_REQUEST_ACCEPTED_NOT_FINAL",
    });
    expect(transport.cancelOrder).toHaveBeenCalledExactlyOnceWith({
      accountSeq: 17,
      brokerOrderId: "broker-order-1",
    });
  });

  it("취소 timeout은 원주문 결과를 추측하지 않고 UNKNOWN으로 대사시킨다", async () => {
    const transport = createTransport();
    transport.cancelOrder.mockRejectedValue(new TossTransportError("TOSS_API_TIMEOUT"));
    const adapter = new TossLiveOrderAdapter(transport, { now: () => now });

    await expect(adapter.cancelOrder(cancelAuthorization(), cancelRequest)).resolves.toMatchObject({
      outcome: "AMBIGUOUS",
      primaryState: "UNKNOWN",
      cancelLifecycle: "AMBIGUOUS",
    });
  });
});
