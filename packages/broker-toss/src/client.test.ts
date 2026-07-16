import { describe, expect, it, vi } from "vitest";

import { TOSS_OPERATIONS, TOSS_OPENAPI_VERSION } from "./generated/operations";
import { TOSS_TRANSPORT_DESCRIPTOR } from "./descriptor";
import { TossOpenApiClient, TossReadApi, TossTradingApi } from "./client";

describe("Toss OpenAPI parity", () => {
  it("공식 v1.2.4의 전체 30개 operation을 포함한다", () => {
    expect(TOSS_OPENAPI_VERSION).toBe("1.2.4");
    expect(TOSS_OPERATIONS).toHaveLength(30);
    expect(TOSS_OPERATIONS.filter(({ method }) => method === "GET")).toHaveLength(23);
    expect(TOSS_OPERATIONS.filter(({ mutatesAccount }) => mutatesAccount)).toHaveLength(6);
    expect(new Set(TOSS_OPERATIONS.map(({ operationId }) => operationId)).size).toBe(30);
    expect(
      TOSS_OPERATIONS.filter(
        ({ path, rateLimitGroup }) => path !== "/oauth2/token" && rateLimitGroup === null,
      ),
    ).toHaveLength(0);
    expect(
      TOSS_OPERATIONS.find(({ operationId }) => operationId === "issueOAuth2Token")?.rateLimitGroup,
    ).toBe("AUTH");
  });

  it("활성 capability에는 조회 기능만 포함하고 주문 쓰기를 제외한다", () => {
    expect(TOSS_TRANSPORT_DESCRIPTOR.capabilities).toContain("orders.read");
    expect(TOSS_TRANSPORT_DESCRIPTOR.capabilities).toContain("pretrade.commissions");
    expect(TOSS_TRANSPORT_DESCRIPTOR.capabilities).not.toContain("orders.write");
    expect(TOSS_TRANSPORT_DESCRIPTOR.capabilities).not.toContain("orders.conditional.write");
  });

  it("모든 업무 operation을 호출 가능한 명시적 메서드로 제공한다", () => {
    const expectedReadOperations = TOSS_OPERATIONS.filter(({ method }) => method === "GET")
      .map(({ operationId }) => operationId)
      .sort();
    const implementedReadOperations = Object.getOwnPropertyNames(TossReadApi.prototype)
      .filter((name) => name !== "constructor")
      .sort();

    const expectedTradingOperations = TOSS_OPERATIONS.filter(({ mutatesAccount }) => mutatesAccount)
      .map(({ operationId }) => operationId)
      .sort();
    const implementedTradingOperations = Object.getOwnPropertyNames(TossTradingApi.prototype)
      .filter((name) => name !== "constructor")
      .sort();

    expect(implementedReadOperations).toEqual(expectedReadOperations);
    expect(implementedTradingOperations).toEqual(expectedTradingOperations);
  });
});

describe("TossTradingApi", () => {
  it("여섯 개 계좌 변경 메서드를 모두 네트워크 요청 전에 차단한다", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const api = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      { fetch: fetchMock },
    );

    const attempts: readonly (() => Promise<unknown>)[] = [
      () =>
        api.trading.createOrder({
          params: { header: { "X-Tossinvest-Account": 1 } },
          body: {
            symbol: "005930",
            side: "BUY",
            orderType: "LIMIT",
            timeInForce: "DAY",
            quantity: "1",
            price: "70000",
            confirmHighValueOrder: false,
          },
        }),
      () =>
        api.trading.modifyOrder({
          params: {
            header: { "X-Tossinvest-Account": 1 },
            path: { orderId: "synthetic-order" },
          },
          body: {
            orderType: "LIMIT",
            quantity: "1",
            price: "70000",
            confirmHighValueOrder: false,
          },
        }),
      () =>
        api.trading.cancelOrder({
          params: {
            header: { "X-Tossinvest-Account": 1 },
            path: { orderId: "synthetic-order" },
          },
        }),
      () =>
        api.trading.createConditionalOrder({
          params: { header: { "X-Tossinvest-Account": 1 } },
          body: {
            symbol: "005930",
            type: "SINGLE",
            quantity: "1",
            orderType: "LIMIT",
            expireDate: "2026-09-10",
            first: { orderSide: "SELL", triggerPrice: "71000", orderPrice: "71000" },
            confirmHighValueOrder: false,
          },
        }),
      () =>
        api.trading.modifyConditionalOrder({
          params: {
            header: { "X-Tossinvest-Account": 1 },
            path: { conditionalOrderId: "synthetic-conditional-order" },
          },
          body: {
            type: "SINGLE",
            quantity: "1",
            orderType: "LIMIT",
            expireDate: "2026-09-10",
            first: { orderSide: "SELL", triggerPrice: "71000", orderPrice: "71000" },
            confirmHighValueOrder: false,
          },
        }),
      () =>
        api.trading.cancelConditionalOrder({
          params: {
            header: { "X-Tossinvest-Account": 1 },
            path: { conditionalOrderId: "synthetic-conditional-order" },
          },
        }),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ code: "TOSS_LIVE_TRADING_DISABLED" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Toss create-order type contract", () => {
  it("공식 주문 입력 타입을 컴파일 시점에 유지한다", () => {
    const typedOrderOptions = {
      params: { header: { "X-Tossinvest-Account": 1 } },
      body: {
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: "1",
        price: "70000",
        confirmHighValueOrder: false,
      },
    } satisfies Parameters<TossTradingApi["createOrder"]>[0];

    expect(typedOrderOptions.body.orderType).toBe("LIMIT");
  });
});

describe("Toss read transport", () => {
  it("read GET의 짧은 429만 Retry-After 이후 한 번 재시도한다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "do-not-expose-upstream-body" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "3",
            "x-ratelimit-group": "ACCOUNT",
            "x-request-id": "synthetic-request-id",
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const responseMetadata: unknown[] = [];
    const api = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: fetchMock,
        sleep,
        random: () => 0.5,
        retryJitterMaxMs: 100,
        onResponseMetadata: (metadata) => {
          responseMetadata.push(metadata);
        },
      },
    );

    await expect(api.read.getAccounts()).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(3_050);
    expect(responseMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "getAccounts",
          staticRateLimitGroup: "ACCOUNT",
          attempt: 1,
          outcome: "HTTP_ERROR",
          httpStatus: 429,
          requestId: "synthetic-request-id",
          retryAfterSeconds: 3,
        }),
        expect.objectContaining({
          operationId: "getAccounts",
          staticRateLimitGroup: "ACCOUNT",
          attempt: 2,
          outcome: "SUCCESS",
          httpStatus: 200,
        }),
      ]),
    );
  });

  it("긴 Retry-After는 기다리지 않고 static group과 공식 rate fields를 보존한다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "do-not-expose-upstream-body" }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "31",
            "x-ratelimit-limit": "10",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "2",
            "x-ratelimit-group": "UNOFFICIAL_WRONG_GROUP",
            "x-request-id": "official-request-id",
            "x-toss-request-id": "legacy-request-id",
          },
        }),
      );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const api = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      { fetch: fetchMock, sleep },
    );

    await expect(api.read.getAccounts()).rejects.toMatchObject({
      code: "TOSS_API_RESPONSE_ERROR",
      httpStatus: 429,
      rateLimitGroup: "ACCOUNT",
      staticRateLimitGroup: "ACCOUNT",
      unofficialRateLimitGroup: "UNOFFICIAL_WRONG_GROUP",
      operationId: "getAccounts",
      attempt: 1,
      requestId: "official-request-id",
      rateLimitLimit: 10,
      rateLimitRemaining: 0,
      rateLimitResetSeconds: 2,
      retryAfterSeconds: 31,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("공식 응답 헤더와 시도 시각을 비밀 없는 callback metadata로 전달한다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "official-request-id",
            "x-ratelimit-limit": "20",
            "x-ratelimit-remaining": "19",
            "x-ratelimit-reset": "1",
            "x-ratelimit-group": "AUXILIARY_ONLY",
          },
        }),
      );
    const metadata: unknown[] = [];
    const api = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: fetchMock,
        now: () => Date.parse("2026-07-16T00:00:00.000Z"),
        onResponseMetadata: (entry) => {
          metadata.push(entry);
        },
      },
    );

    await api.read.getAccounts();

    expect(metadata).toContainEqual({
      operationId: "getAccounts",
      staticRateLimitGroup: "ACCOUNT",
      attempt: 1,
      startedAt: "2026-07-16T00:00:00.000Z",
      receivedAt: "2026-07-16T00:00:00.000Z",
      outcome: "SUCCESS",
      httpStatus: 200,
      requestId: "official-request-id",
      rateLimitLimit: 20,
      rateLimitRemaining: 19,
      rateLimitResetSeconds: 1,
      retryAfterSeconds: null,
      legacyRequestId: null,
      unofficialRateLimitGroup: "AUXILIARY_ONLY",
    });
  });

  it("401 응답 뒤에는 캐시된 토큰을 폐기한다", async () => {
    const tokenResponse = (token: string) =>
      new Response(
        JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: 3600 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse("first-token"))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("second-token"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const api = new TossOpenApiClient(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      { fetch: fetchMock },
    );

    await expect(api.read.getAccounts()).rejects.toMatchObject({ httpStatus: 401 });
    await expect(api.read.getAccounts()).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
