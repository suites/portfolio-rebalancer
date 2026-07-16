import { describe, expect, it, vi } from "vitest";

import { assertTossResponse, createTimedFetch, createTossManagedFetch } from "./transport";

describe("createTimedFetch", () => {
  it("시간이 초과된 요청을 재제출 경고가 있는 안전 오류로 변환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")), {
          once: true,
        });
      });
    });
    const timedFetch = createTimedFetch(fetchMock, 5);

    await expect(
      timedFetch("https://openapi.tossinvest.com/api/v1/accounts"),
    ).rejects.toMatchObject({
      code: "TOSS_API_TIMEOUT",
    });
  });
});

describe("createTossManagedFetch", () => {
  it("같은 rate group은 직렬화하고 다른 그룹은 독립적으로 실행한다", async () => {
    let releaseFirstMarketRequest: () => void = () => undefined;
    const firstMarketResponse = new Promise<Response>((resolve) => {
      releaseFirstMarketRequest = () =>
        resolve(
          new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
    });
    let marketCalls = 0;
    let stockCalls = 0;
    let activeMarketRequests = 0;
    let maximumActiveMarketRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname } = new URL(request.url);
      if (pathname === "/api/v1/stocks") {
        stockCalls += 1;
        return new Response(JSON.stringify({ result: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      marketCalls += 1;
      activeMarketRequests += 1;
      maximumActiveMarketRequests = Math.max(maximumActiveMarketRequests, activeMarketRequests);
      if (marketCalls === 1) {
        const response = await firstMarketResponse;
        activeMarketRequests -= 1;
        return response;
      }
      activeMarketRequests -= 1;
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const managedFetch = createTossManagedFetch(fetchMock);

    const firstMarket = managedFetch("https://openapi.tossinvest.com/api/v1/prices?symbols=005930");
    const secondMarket = managedFetch(
      "https://openapi.tossinvest.com/api/v1/orderbook?symbol=005930",
    );
    const independentStock = managedFetch(
      "https://openapi.tossinvest.com/api/v1/stocks?symbols=005930",
    );
    await vi.waitFor(() => {
      expect(marketCalls).toBe(1);
      expect(stockCalls).toBe(1);
    });
    expect(maximumActiveMarketRequests).toBe(1);

    releaseFirstMarketRequest();
    await Promise.all([firstMarket, secondMarket, independentStock]);

    expect(marketCalls).toBe(2);
    expect(maximumActiveMarketRequests).toBe(1);
  });

  it("GET 429를 Retry-After와 양의 bounded jitter 이후 딱 한 번 재시도한다", async () => {
    const requests: Request[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((input) => {
        if (!(input instanceof Request)) throw new Error("Request가 아닙니다.");
        requests.push(input);
        return Promise.resolve(
          new Response("rate limited", {
            status: 429,
            headers: { "retry-after": "2" },
          }),
        );
      })
      .mockImplementationOnce((input) => {
        if (!(input instanceof Request)) throw new Error("Request가 아닙니다.");
        requests.push(input);
        return Promise.resolve(
          new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      });
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const managedFetch = createTossManagedFetch(fetchMock, {
      sleep,
      random: () => 0.5,
      retryJitterMaxMs: 100,
    });

    const response = await managedFetch(
      new Request("https://openapi.tossinvest.com/api/v1/accounts", {
        headers: { authorization: "Bearer synthetic-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(2_050);
    expect(requests[0]).not.toBe(requests[1]);
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer synthetic-token",
      "Bearer synthetic-token",
    ]);
  });

  it("jitter를 포함한 총 대기시간이 최대값을 넘으면 재시도하지 않는다", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "30" },
      }),
    );
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const managedFetch = createTossManagedFetch(fetchMock, {
      sleep,
      random: () => 1,
      maxRetryAfterMs: 30_000,
      retryJitterMaxMs: 250,
    });

    const response = await managedFetch("https://openapi.tossinvest.com/api/v1/accounts");

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("쓰기 429는 본문을 한 번만 전송하고 자동 재시도하지 않는다", async () => {
    const requestBodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (!(input instanceof Request)) throw new Error("Request가 아닙니다.");
      requestBodies.push(await input.text());
      return new Response("rate limited", {
        status: 429,
        headers: {
          "retry-after": "1",
          "x-ratelimit-limit": "4",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1",
        },
      });
    });
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const managedFetch = createTossManagedFetch(fetchMock, { sleep });

    const response = await managedFetch("https://openapi.tossinvest.com/api/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "005930", quantity: "1" }),
    });
    const error: unknown = (() => {
      try {
        assertTossResponse(response);
      } catch (cause) {
        return cause;
      }
      return null;
    })();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(requestBodies).toEqual([JSON.stringify({ symbol: "005930", quantity: "1" })]);
    expect(error).toMatchObject({
      operationId: "createOrder",
      staticRateLimitGroup: "ORDER",
      rateLimitGroup: "ORDER",
      rateLimitLimit: 4,
      rateLimitRemaining: 0,
      rateLimitResetSeconds: 1,
    });
  });

  it.each([401, 500])("GET HTTP %s는 자동 재시도하지 않는다", async (status) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("rejected", { status, headers: { "retry-after": "1" } }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const managedFetch = createTossManagedFetch(fetchMock, { sleep });

    const response = await managedFetch("https://openapi.tossinvest.com/api/v1/accounts");

    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("network 오류는 자동 재시도하지 않고 attempt 메타데이터를 남긴다", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("socket failed"));
    const metadata = vi.fn();
    const managedFetch = createTossManagedFetch(fetchMock, {
      onResponseMetadata: metadata,
    });

    await expect(managedFetch("https://openapi.tossinvest.com/api/v1/accounts")).rejects.toThrow(
      "socket failed",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(metadata).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        operationId: "getAccounts",
        staticRateLimitGroup: "ACCOUNT",
        attempt: 1,
        outcome: "NETWORK_ERROR",
        httpStatus: null,
      }),
    );
  });

  it("감사 callback 저장 실패를 숨기지 않고 요청 흐름을 fail closed 한다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ result: [] }), { status: 200 }));
    const managedFetch = createTossManagedFetch(fetchMock, {
      onResponseMetadata: () => {
        throw new Error("database unavailable");
      },
    });

    await expect(
      managedFetch("https://openapi.tossinvest.com/api/v1/accounts"),
    ).rejects.toMatchObject({
      code: "TOSS_REQUEST_AUDIT_FAILED",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
