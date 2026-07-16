import type {
  AccountId,
  InstrumentIdentifier,
  IsoDate,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import {
  createTossManagedFetch,
  getTossResponseMetadata,
  type TossOpenApiClient,
  type TossOperationId,
} from "@portfolio-rebalancer/broker-toss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTossReadSource,
  type TossResponseValidationCallback,
} from "./toss-read-source.adapter";

const mocks = {
  read: {
    getAccounts: vi.fn(),
    getHoldings: vi.fn(),
    getBuyingPower: vi.fn(),
    getPrices: vi.fn(),
    getOrderbook: vi.fn(),
    getPriceLimit: vi.fn(),
    getKrMarketCalendar: vi.fn(),
    getUsMarketCalendar: vi.fn(),
    getSellableQuantity: vi.fn(),
    getCommissions: vi.fn(),
    getExchangeRate: vi.fn(),
    getStocks: vi.fn(),
    getStockWarnings: vi.fn(),
  },
};
const responseValidationId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TossReadSource neutral market reads", () => {
  it("현재가의 정확한 symbols 파라미터, null timestamp와 business Response 메타데이터를 반환한다", async () => {
    const business = await reply(
      "getPrices",
      {
        result: [
          { symbol: "005930", timestamp: null, lastPrice: "72000", currency: "KRW" },
          {
            symbol: "AAPL",
            timestamp: "2026-07-16T09:00:00.000+09:00",
            lastPrice: "211.1",
            currency: "USD",
          },
        ],
      },
      {
        requestId: "official-prices-request",
        receivedAt: "2026-07-16T00:00:00.125Z",
      },
    );
    mocks.read.getPrices.mockResolvedValue(business);
    const source = createSource();

    const result = await source.getPrices([samsung, apple]);

    expect(mocks.read.getPrices).toHaveBeenCalledExactlyOnceWith({
      params: { query: { symbols: "005930,AAPL" } },
    });
    expect(result.value).toEqual([
      expect.objectContaining({ symbol: "005930", observedAt: null }),
      expect.objectContaining({
        symbol: "AAPL",
        observedAt: "2026-07-16T09:00:00.000+09:00",
      }),
    ]);
    expect(result.metadata).toEqual({
      brokerId: "toss",
      operationId: "getPrices",
      requestId: "official-prices-request",
      httpStatus: 200,
      rateLimitGroup: "MARKET_DATA",
      receivedAt: "2026-07-16T00:00:00.125Z",
      auditReference: null,
    });
    expect(result.redactedBody).toEqual(business.data);
    expect(result.responseValidationId).toBeNull();
    expect(getTossResponseMetadata(business.response)?.receivedAt).toBe("2026-07-16T00:00:00.125Z");
  });

  it("호가와 가격 제한은 각각 정확한 symbol query와 중립 결과를 사용한다", async () => {
    mocks.read.getOrderbook.mockResolvedValue(
      await reply("getOrderbook", {
        result: {
          timestamp: null,
          currency: "KRW",
          asks: [{ price: "72100", volume: "5" }],
          bids: [{ price: "71900", volume: "7" }],
        },
      }),
    );
    mocks.read.getPriceLimit.mockResolvedValue(
      await reply("getPriceLimit", {
        result: {
          timestamp: "2026-07-16T09:00:00.000+09:00",
          upperLimitPrice: "93000",
          lowerLimitPrice: "50400",
          currency: "KRW",
        },
      }),
    );
    const source = createSource();

    const orderBook = await source.getOrderBook(samsung);
    const priceLimit = await source.getPriceLimit(samsung);

    expect(mocks.read.getOrderbook).toHaveBeenCalledExactlyOnceWith({
      params: { query: { symbol: "005930" } },
    });
    expect(mocks.read.getPriceLimit).toHaveBeenCalledExactlyOnceWith({
      params: { query: { symbol: "005930" } },
    });
    expect(orderBook.value).toMatchObject({
      marketCountry: "KR",
      symbol: "005930",
      observedAt: null,
      asks: [{ price: "72100", quantity: "5" }],
      bids: [{ price: "71900", quantity: "7" }],
    });
    expect(priceLimit.value).toMatchObject({
      marketCountry: "KR",
      symbol: "005930",
      upperLimitPrice: "93000",
      lowerLimitPrice: "50400",
    });
  });

  it("KR 기준일 query와 US 무기준일 요청을 각 공식 캘린더 operation으로 보낸다", async () => {
    mocks.read.getKrMarketCalendar.mockResolvedValue(
      await reply("getKrMarketCalendar", validKrCalendarPayload()),
    );
    mocks.read.getUsMarketCalendar.mockResolvedValue(
      await reply("getUsMarketCalendar", validUsCalendarPayload()),
    );
    const source = createSource();

    const kr = await source.getMarketCalendar("KR", "2026-07-16" as IsoDate);
    const us = await source.getMarketCalendar("US");

    expect(mocks.read.getKrMarketCalendar).toHaveBeenCalledExactlyOnceWith({
      params: { query: { date: "2026-07-16" } },
    });
    expect(mocks.read.getUsMarketCalendar).toHaveBeenCalledExactlyOnceWith({});
    expect(kr.metadata).toMatchObject({
      operationId: "getKrMarketCalendar",
      rateLimitGroup: "MARKET_INFO",
    });
    expect(us.value.marketCountry).toBe("US");
    expect(us.value.today.sessions.map(({ kind }) => kind)).toEqual([
      "PRE_MARKET",
      "REGULAR_MARKET",
    ]);
  });
});

describe("TossReadSource neutral account reads", () => {
  it("accountSeq는 Toss header에, 저장 AccountId는 중립 매도 가능 수량에 사용한다", async () => {
    mocks.read.getSellableQuantity.mockResolvedValue(
      await reply("getSellableQuantity", {
        result: { sellableQuantity: "7" },
      }),
    );
    const source = createSource();

    const result = await source.getSellableQuantity(accountReference, samsung);

    expect(mocks.read.getSellableQuantity).toHaveBeenCalledExactlyOnceWith({
      params: {
        header: { "X-Tossinvest-Account": 17 },
        query: { symbol: "005930" },
      },
    });
    expect(result.value).toEqual({
      accountId: "stored-account-id",
      marketCountry: "KR",
      symbol: "005930",
      quantity: "7",
    });
    expect(result.metadata).toMatchObject({
      operationId: "getSellableQuantity",
      rateLimitGroup: "ORDER_INFO",
    });
  });

  it("매수 가능 금액 evidence는 저장 AccountId·요청 통화·응답 검증 ID를 함께 반환한다", async () => {
    mocks.read.getBuyingPower.mockResolvedValue(
      await reply(
        "getBuyingPower",
        { result: { currency: "KRW", cashBuyingPower: "5000000" } },
        { auditReference: "11111111-1111-4111-8111-111111111111" },
      ),
    );
    const source = createSource(
      vi.fn<TossResponseValidationCallback>().mockResolvedValue(responseValidationId),
    );

    const result = await source.getBuyingPowerEvidence(accountReference, "KRW");

    expect(result.value).toEqual({
      accountId: "stored-account-id",
      currency: "KRW",
      cashBuyingPower: "5000000",
    });
    expect(result.responseValidationId).toBe(responseValidationId);
  });

  it("수수료는 계좌 header와 요청 시장 누락 검증을 거쳐 계좌별 일정으로 반환한다", async () => {
    mocks.read.getCommissions.mockResolvedValue(
      await reply("getCommissions", {
        result: [
          {
            marketCountry: "KR",
            commissionRate: "0.015",
            startDate: "2026-01-01",
            endDate: null,
          },
          {
            marketCountry: "US",
            commissionRate: "0.1",
            startDate: null,
            endDate: null,
          },
        ],
      }),
    );
    const source = createSource();

    const result = await source.getCommissionSchedule(accountReference, ["KR", "US"]);

    expect(mocks.read.getCommissions).toHaveBeenCalledExactlyOnceWith({
      params: { header: { "X-Tossinvest-Account": 17 } },
    });
    expect(result.value).toEqual({
      accountId: "stored-account-id",
      periods: [
        {
          marketCountry: "KR",
          commissionRatePercent: "0.015",
          startDate: "2026-01-01",
          endDate: null,
        },
        {
          marketCountry: "US",
          commissionRatePercent: "0.1",
          startDate: null,
          endDate: null,
        },
      ],
    });
  });

  it("유효하지 않은 accountSeq/AccountId 매핑은 API 호출 전에 차단한다", async () => {
    const source = createSource();

    await expect(
      source.getSellableQuantity({ accountSeq: 0, accountId: "" as AccountId }, samsung),
    ).rejects.toMatchObject({ code: "DATA_INVALID" });
    await expect(
      source.getCommissionSchedule(
        { accountSeq: Number.MAX_VALUE, accountId: accountReference.accountId },
        ["KR"],
      ),
    ).rejects.toMatchObject({ code: "DATA_INVALID" });

    expect(mocks.read.getSellableQuantity).not.toHaveBeenCalled();
    expect(mocks.read.getCommissions).not.toHaveBeenCalled();
  });
});

describe("TossReadSource validation and compatibility", () => {
  it("Zod 전 원문의 미지 필드를 보존하고 계좌·비밀정보를 재귀적으로 마스킹한 뒤 PASSED를 기록한다", async () => {
    const raw = {
      result: [
        {
          symbol: "005930",
          lastPrice: "72000",
          currency: "KRW",
          accountNo: "12345678901",
          accountSeq: 17,
          accountIdentifier: "broker-account-identifier",
          accountNumberHash: "account-number-hash",
          accountType: "BROKERAGE",
          providerExtension: {
            traceId: "trace-kept",
            clientSecret: "never-store-this",
            nested: [{ Authorization: "Bearer never-store-this", safe: "kept" }],
            header: {
              name: "Authorization",
              value: "Bearer header-token-value",
              extra: "must-also-be-redacted",
            },
            freeForm:
              "client_secret=synthetic-secret; token=abc.defghijkl.mnopqrstuv; 계좌 번호 123-456-7890",
          },
        },
      ],
      unknownRoot: { request_token: "never-store-this", version: 7 },
    };
    const business = await reply("getPrices", raw, {
      auditReference: "11111111-1111-4111-8111-111111111111",
    });
    mocks.read.getPrices.mockResolvedValue(business);
    const onResponseValidation = vi
      .fn<TossResponseValidationCallback>()
      .mockResolvedValue(responseValidationId);
    const source = createSource(onResponseValidation);

    const result = await source.getPrices([samsung]);

    const expectedRedactedBody = {
      result: [
        {
          symbol: "005930",
          lastPrice: "72000",
          currency: "KRW",
          accountNo: "[REDACTED]",
          accountSeq: "[REDACTED]",
          accountIdentifier: "[REDACTED]",
          accountNumberHash: "[REDACTED]",
          accountType: "BROKERAGE",
          providerExtension: {
            traceId: "trace-kept",
            clientSecret: "[REDACTED]",
            nested: [{ Authorization: "[REDACTED]", safe: "kept" }],
            header: {
              name: "Authorization",
              value: "[REDACTED]",
              extra: "[REDACTED]",
            },
            freeForm: "client_secret=[REDACTED]; token=[REDACTED]; 계좌 번호 [REDACTED]",
          },
        },
      ],
      unknownRoot: { request_token: "[REDACTED]", version: 7 },
    };
    expect(result.redactedBody).toEqual(expectedRedactedBody);
    expect(result.responseValidationId).toBe(responseValidationId);
    expect(raw.result[0]?.providerExtension.clientSecret).toBe("never-store-this");
    expect(onResponseValidation).toHaveBeenCalledOnce();
    const event = onResponseValidation.mock.calls[0]?.[0];
    if (!event) throw new Error("PASSED 응답 검증 이벤트가 없습니다.");
    expect(event).toEqual({
      requestAttemptId: "11111111-1111-4111-8111-111111111111",
      operationId: "getPrices",
      outcome: "PASSED",
      redactedBody: expectedRedactedBody,
      safeErrorCode: null,
      validatedAt: event.validatedAt,
    });
    expect(Number.isFinite(Date.parse(event.validatedAt))).toBe(true);
  });

  it("primitive 오류 문자열의 실제 secret, Bearer/JWT와 계좌 식별자를 마스킹한다", async () => {
    mocks.read.getPrices.mockResolvedValue(
      await reply(
        "getPrices",
        "Authorization=Bearer abcdefgh.ijklmnop.qrstuvwx; clientSecret=synthetic-secret; accountIdentifier=123-456-7890",
        { auditReference: "44444444-4444-4444-8444-444444444444" },
      ),
    );
    const onResponseValidation = vi
      .fn<TossResponseValidationCallback>()
      .mockResolvedValue(responseValidationId);
    const source = createSource(onResponseValidation);

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });

    const event = onResponseValidation.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      outcome: "SCHEMA_ERROR",
      redactedBody:
        "Authorization=[REDACTED]; clientSecret=[REDACTED]; accountIdentifier=[REDACTED]",
    });
  });

  it("Zod 실패 시 파싱 전 redacted 원문과 안전 오류 코드로 SCHEMA_ERROR를 먼저 기록한다", async () => {
    const raw = {
      result: [
        {
          symbol: "005930",
          lastPrice: 72000,
          currency: "KRW",
          accessToken: "never-store-this",
          unknownEvidence: { providerField: true },
        },
      ],
    };
    mocks.read.getPrices.mockResolvedValue(
      await reply("getPrices", raw, {
        auditReference: "22222222-2222-4222-8222-222222222222",
      }),
    );
    const onResponseValidation = vi
      .fn<TossResponseValidationCallback>()
      .mockResolvedValue(responseValidationId);
    const source = createSource(onResponseValidation);

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });

    expect(onResponseValidation).toHaveBeenCalledOnce();
    const event = onResponseValidation.mock.calls[0]?.[0];
    if (!event) throw new Error("SCHEMA_ERROR 응답 검증 이벤트가 없습니다.");
    expect(event).toEqual({
      requestAttemptId: "22222222-2222-4222-8222-222222222222",
      operationId: "getPrices",
      outcome: "SCHEMA_ERROR",
      redactedBody: {
        result: [
          {
            symbol: "005930",
            lastPrice: 72000,
            currency: "KRW",
            accessToken: "[REDACTED]",
            unknownEvidence: { providerField: true },
          },
        ],
      },
      safeErrorCode: "TOSS_RESPONSE_SCHEMA_ERROR",
      validatedAt: event.validatedAt,
    });
    expect(Number.isFinite(Date.parse(event.validatedAt))).toBe(true);
  });

  it("응답 검증 callback이 설정되면 요청 감사 참조가 없는 응답을 파싱하지 않는다", async () => {
    mocks.read.getPrices.mockResolvedValue(
      await reply("getPrices", {
        result: [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }],
      }),
    );
    const onResponseValidation = vi
      .fn<TossResponseValidationCallback>()
      .mockResolvedValue(responseValidationId);
    const source = createSource(onResponseValidation);

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
      message: "토스증권 getPrices 응답에 요청 감사 참조가 없습니다.",
    });
    expect(onResponseValidation).not.toHaveBeenCalled();
  });

  it("PASSED 검증 감사 callback 저장이 실패하면 정상 응답도 반환하지 않는다", async () => {
    mocks.read.getPrices.mockResolvedValue(
      await reply(
        "getPrices",
        {
          result: [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }],
        },
        { auditReference: "33333333-3333-4333-8333-333333333333" },
      ),
    );
    const source = createSource(
      vi.fn<TossResponseValidationCallback>().mockRejectedValue(new Error("audit unavailable")),
    );

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
      message: "토스증권 응답 검증 감사 기록을 저장하지 못했습니다.",
    });
  });

  it("검증 callback이 빈 참조를 반환하면 정상 응답도 반환하지 않는다", async () => {
    mocks.read.getPrices.mockResolvedValue(
      await reply(
        "getPrices",
        {
          result: [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }],
        },
        { auditReference: "33333333-3333-4333-8333-333333333333" },
      ),
    );
    const source = createSource(vi.fn<TossResponseValidationCallback>().mockResolvedValue(""));

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
      message: "토스증권 응답 검증 감사 기록을 저장하지 못했습니다.",
    });
  });

  it("종목·유의사항 evidence는 원문 검증 ID를 중립 metadata와 분리해 반환한다", async () => {
    mocks.read.getStocks.mockResolvedValue(
      await reply(
        "getStocks",
        {
          result: [
            {
              symbol: "005930",
              market: "KOSPI",
              currency: "KRW",
              status: "ACTIVE",
              securityType: "STOCK",
              name: "삼성전자",
              englishName: "Samsung Electronics",
              isinCode: "KR7005930003",
              isCommonShare: true,
              listDate: "1975-06-11",
              delistDate: null,
              sharesOutstanding: "1000",
              leverageFactor: null,
              koreanMarketDetail: {
                liquidationTrading: false,
                nxtSupported: true,
                krxTradingSuspended: false,
                nxtTradingSuspended: false,
              },
            },
          ],
        },
        { auditReference: "11111111-1111-4111-8111-111111111111" },
      ),
    );
    mocks.read.getStockWarnings.mockResolvedValue(
      await reply(
        "getStockWarnings",
        { result: [] },
        { auditReference: "22222222-2222-4222-8222-222222222222" },
      ),
    );
    const source = createSource(
      vi.fn<TossResponseValidationCallback>().mockResolvedValue(responseValidationId),
    );

    const stocks = await source.getStocksEvidence(["005930"]);
    const warnings = await source.getStockWarningsEvidence("005930");

    expect(stocks.value.result[0]?.symbol).toBe("005930");
    expect(warnings.value.result).toEqual([]);
    expect(stocks.responseValidationId).toBe(responseValidationId);
    expect(warnings.responseValidationId).toBe(responseValidationId);
  });

  it("요청 시세 누락과 계획 준비 불가 빈 호가는 BROKER_FETCH_FAILED로 차단한다", async () => {
    mocks.read.getPrices.mockResolvedValue(await reply("getPrices", { result: [] }));
    mocks.read.getOrderbook.mockResolvedValue(
      await reply("getOrderbook", {
        result: { timestamp: null, currency: "KRW", asks: [], bids: [] },
      }),
    );
    const source = createSource();

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });
    await expect(source.getOrderBook(samsung)).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });
  });

  it("business Response 메타데이터가 없거나 다른 operation이면 값을 반환하지 않는다", async () => {
    const missingMetadata = {
      data: {
        result: [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }],
      },
      response: new Response(),
    };
    mocks.read.getPrices.mockResolvedValueOnce(missingMetadata);

    const wrongOperation = await reply("getOrderbook", {
      result: [{ symbol: "005930", lastPrice: "72000", currency: "KRW" }],
    });
    mocks.read.getPrices.mockResolvedValueOnce(wrongOperation);
    const source = createSource();

    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });
    await expect(source.getPrices([samsung])).rejects.toMatchObject({
      code: "BROKER_FETCH_FAILED",
    });
  });

  it("기존 raw 계좌 및 매수 가능 금액 메서드의 응답 계약을 유지한다", async () => {
    mocks.read.getAccounts.mockResolvedValue({
      data: {
        result: [{ accountNo: "12345678901", accountSeq: 17, accountType: "BROKERAGE" }],
      },
      response: new Response(),
    });
    mocks.read.getBuyingPower.mockResolvedValue({
      data: { result: { currency: "KRW", cashBuyingPower: "5000000" } },
      response: new Response(),
    });
    const source = createSource();

    await expect(source.listAccounts()).resolves.toEqual([
      { accountNo: "12345678901", accountSeq: 17, accountType: "BROKERAGE" },
    ]);
    await expect(source.getBuyingPower(17, "KRW")).resolves.toEqual({
      result: { currency: "KRW", cashBuyingPower: "5000000" },
    });
    expect(mocks.read.getBuyingPower).toHaveBeenCalledExactlyOnceWith({
      params: {
        header: { "X-Tossinvest-Account": 17 },
        query: { currency: "KRW" },
      },
    });
  });
});

const samsung = instrument("KR", "005930");
const apple = instrument("US", "AAPL");
const accountReference = {
  accountSeq: 17,
  accountId: "stored-account-id" as AccountId,
} as const;

function createSource(onResponseValidation?: TossResponseValidationCallback) {
  return createTossReadSource(
    {
      clientId: "synthetic-client",
      clientSecret: "synthetic-secret",
      ...(onResponseValidation ? { onResponseValidation } : {}),
    },
    {
      client: { read: mocks.read } as unknown as Pick<TossOpenApiClient, "read">,
    },
  );
}

function instrument(
  marketCountry: InstrumentIdentifier["marketCountry"],
  symbol: string,
): InstrumentIdentifier {
  return { marketCountry, symbol: symbol as SymbolCode };
}

async function reply(
  operationId: TossOperationId,
  data: unknown,
  overrides: {
    readonly requestId?: string;
    readonly receivedAt?: string;
    readonly auditReference?: string;
  } = {},
) {
  const startedAt = Date.parse("2026-07-16T00:00:00.000Z");
  const receivedAt = Date.parse(overrides.receivedAt ?? "2026-07-16T00:00:00.100Z");
  const now = vi.fn<() => number>().mockReturnValueOnce(startedAt).mockReturnValueOnce(receivedAt);
  const managedFetch = createTossManagedFetch(
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": overrides.requestId ?? "official-request-id",
        },
      }),
    ),
    {
      now,
      ...(overrides.auditReference ? { onResponseMetadata: () => overrides.auditReference } : {}),
    },
  );
  const response = await managedFetch(operationUrl(operationId));
  return { data, response };
}

function operationUrl(operationId: TossOperationId): string {
  const origin = "https://openapi.tossinvest.com";
  switch (operationId) {
    case "getPrices":
      return `${origin}/api/v1/prices?symbols=005930`;
    case "getOrderbook":
      return `${origin}/api/v1/orderbook?symbol=005930`;
    case "getPriceLimit":
      return `${origin}/api/v1/price-limits?symbol=005930`;
    case "getKrMarketCalendar":
      return `${origin}/api/v1/market-calendar/KR`;
    case "getUsMarketCalendar":
      return `${origin}/api/v1/market-calendar/US`;
    case "getSellableQuantity":
      return `${origin}/api/v1/sellable-quantity?symbol=005930`;
    case "getCommissions":
      return `${origin}/api/v1/commissions`;
    case "getBuyingPower":
      return `${origin}/api/v1/buying-power?currency=KRW`;
    case "getStocks":
      return `${origin}/api/v1/stocks?symbols=005930`;
    case "getStockWarnings":
      return `${origin}/api/v1/stocks/005930/warnings`;
    default:
      throw new Error(`테스트 business operation URL이 없습니다: ${operationId}`);
  }
}

function validKrCalendarPayload() {
  return {
    result: {
      today: {
        date: "2026-07-16",
        integrated: {
          regularMarket: {
            startTime: "2026-07-16T09:00:00+09:00",
            singlePriceAuctionStartTime: "2026-07-16T15:20:00+09:00",
            endTime: "2026-07-16T15:30:00+09:00",
          },
        },
      },
      previousBusinessDay: { date: "2026-07-15", integrated: null },
      nextBusinessDay: { date: "2026-07-17", integrated: null },
    },
  };
}

function validUsCalendarPayload() {
  return {
    result: {
      today: {
        date: "2026-07-16",
        preMarket: {
          startTime: "2026-07-16T17:00:00+09:00",
          endTime: "2026-07-16T22:30:00+09:00",
        },
        regularMarket: {
          startTime: "2026-07-16T22:30:00+09:00",
          endTime: "2026-07-17T05:00:00+09:00",
        },
      },
      previousBusinessDay: { date: "2026-07-15" },
      nextBusinessDay: { date: "2026-07-17" },
    },
  };
}
