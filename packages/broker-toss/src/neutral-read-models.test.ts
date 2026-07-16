import type {
  AccountId,
  InstrumentIdentifier,
  MarketCountry,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import { describe, expect, it } from "vitest";

import {
  normalizeTossCommissions,
  normalizeTossKrMarketCalendar,
  normalizeTossOrderbook,
  normalizeTossPriceLimit,
  normalizeTossPrices,
  normalizeTossSellableQuantity,
  normalizeTossUsMarketCalendar,
  TossNeutralReadModelError,
  type TossNeutralReadModelIssue,
} from "./neutral-read-models";
import {
  TossCommissionsResponseSchema,
  TossKrMarketCalendarResponseSchema,
  TossOrderbookResponseSchema,
  TossPriceLimitResponseSchema,
  TossPricesResponseSchema,
  TossSellableQuantityResponseSchema,
  TossUsMarketCalendarResponseSchema,
} from "./read-models";

const accountId = "account-1" as AccountId;
const samsung = instrument("KR", "005930");
const skHynix = instrument("KR", "000660");
const apple = instrument("US", "AAPL");

describe("normalizeTossPrices", () => {
  it("응답 순서와 무관하게 요청 순서의 중립 시세를 만들고 nullable 시각을 보존한다", () => {
    const response = TossPricesResponseSchema.parse({
      result: [
        {
          symbol: "000660",
          timestamp: "2026-03-25T09:30:00.123+09:00",
          lastPrice: "182000",
          currency: "KRW",
        },
        { symbol: "005930", timestamp: null, lastPrice: "72000", currency: "KRW" },
      ],
    });

    expect(normalizeTossPrices(response, [samsung, skHynix])).toEqual([
      {
        marketCountry: "KR",
        symbol: "005930",
        price: "72000",
        currency: "KRW",
        observedAt: null,
      },
      {
        marketCountry: "KR",
        symbol: "000660",
        price: "182000",
        currency: "KRW",
        observedAt: "2026-03-25T09:30:00.123+09:00",
      },
    ]);
  });

  it("요청 종목이 없거나 같은 심볼이 시장만 달리해 중복되면 차단한다", () => {
    const empty = TossPricesResponseSchema.parse({ result: [] });

    expectIssue(() => normalizeTossPrices(empty, []), "REQUESTED_SYMBOLS_EMPTY");
    expectIssue(
      () => normalizeTossPrices(empty, [samsung, instrument("US", "005930")]),
      "REQUESTED_SYMBOL_DUPLICATE",
    );
  });

  it("누락·추가·중복 응답 심볼을 각각 차단한다", () => {
    expectIssue(
      () => normalizeTossPrices(TossPricesResponseSchema.parse({ result: [] }), [samsung]),
      "RESPONSE_SYMBOL_MISSING",
    );
    expectIssue(
      () =>
        normalizeTossPrices(
          TossPricesResponseSchema.parse({
            result: [
              { symbol: "005930", lastPrice: "72000", currency: "KRW" },
              { symbol: "000660", lastPrice: "182000", currency: "KRW" },
            ],
          }),
          [samsung],
        ),
      "RESPONSE_SYMBOL_EXTRA",
    );
    expectIssue(
      () =>
        normalizeTossPrices(
          TossPricesResponseSchema.parse({
            result: [
              { symbol: "005930", lastPrice: "72000", currency: "KRW" },
              { symbol: "005930", lastPrice: "72100", currency: "KRW" },
            ],
          }),
          [samsung],
        ),
      "RESPONSE_SYMBOL_DUPLICATE",
    );
  });

  it("시장 통화 불일치와 0 이하 현재가를 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossPrices(
          TossPricesResponseSchema.parse({
            result: [{ symbol: "AAPL", lastPrice: "211.1", currency: "KRW" }],
          }),
          [apple],
        ),
      "MARKET_CURRENCY_MISMATCH",
    );

    for (const lastPrice of ["0", "0.00", "-1"]) {
      expectIssue(
        () =>
          normalizeTossPrices(
            TossPricesResponseSchema.parse({
              result: [{ symbol: "005930", lastPrice, currency: "KRW" }],
            }),
            [samsung],
          ),
        "PRICE_NON_POSITIVE",
      );
    }
  });
});

describe("normalizeTossOrderbook", () => {
  it("호가 가격·잔량을 중립 레벨로 변환하고 provider null 시각을 유지한다", () => {
    const response = orderbook({
      timestamp: null,
      currency: "USD",
      asks: [{ price: "211.11", volume: "3" }],
      bids: [{ price: "211.10", volume: "5.5" }],
    });

    expect(normalizeTossOrderbook(response, apple)).toEqual({
      marketCountry: "US",
      symbol: "AAPL",
      currency: "USD",
      asks: [{ price: "211.11", quantity: "3" }],
      bids: [{ price: "211.10", quantity: "5.5" }],
      observedAt: null,
    });
  });

  it("한쪽이라도 빈 호가이면 계획 준비 불가로 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [],
            bids: [{ price: "71900", volume: "1" }],
          }),
          samsung,
        ),
      "ORDERBOOK_EMPTY",
    );
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [{ price: "72100", volume: "1" }],
            bids: [],
          }),
          samsung,
        ),
      "ORDERBOOK_EMPTY",
    );
  });

  it("시장 통화 불일치, 0 이하 호가와 음수 잔량을 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "USD",
            asks: [{ price: "72100", volume: "1" }],
            bids: [{ price: "71900", volume: "1" }],
          }),
          samsung,
        ),
      "MARKET_CURRENCY_MISMATCH",
    );
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [{ price: "0", volume: "1" }],
            bids: [{ price: "71900", volume: "1" }],
          }),
          samsung,
        ),
      "PRICE_NON_POSITIVE",
    );
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [{ price: "72100", volume: "-0.1" }],
            bids: [{ price: "71900", volume: "1" }],
          }),
          samsung,
        ),
      "ORDERBOOK_QUANTITY_NEGATIVE",
    );
  });

  it("호가 정렬, 교차호가와 양수 잔량 부재를 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [
              { price: "72100", volume: "1" },
              { price: "72000", volume: "1" },
            ],
            bids: [{ price: "71900", volume: "1" }],
          }),
          samsung,
        ),
      "ORDERBOOK_ORDER_INVALID",
    );
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [{ price: "72000", volume: "1" }],
            bids: [{ price: "72000", volume: "1" }],
          }),
          samsung,
        ),
      "ORDERBOOK_CROSSED",
    );
    expectIssue(
      () =>
        normalizeTossOrderbook(
          orderbook({
            currency: "KRW",
            asks: [{ price: "72100", volume: "0" }],
            bids: [{ price: "71900", volume: "0" }],
          }),
          samsung,
        ),
      "ORDERBOOK_NO_LIQUIDITY",
    );
  });
});

describe("normalizeTossPriceLimit", () => {
  it("국내 종목의 양수 하한·상한과 관측시각을 보존한다", () => {
    expect(
      normalizeTossPriceLimit(
        priceLimit({
          currency: "KRW",
          lowerLimitPrice: "50400",
          upperLimitPrice: "93000",
        }),
        samsung,
      ),
    ).toEqual({
      marketCountry: "KR",
      symbol: "005930",
      currency: "KRW",
      lowerLimitPrice: "50400",
      upperLimitPrice: "93000",
      observedAt: "2026-03-25T09:30:00.123+09:00",
    });
  });

  it("국내 종목의 null·0 이하·역전 또는 같은 가격 제한을 차단한다", () => {
    for (const limits of [
      { lowerLimitPrice: null, upperLimitPrice: "93000" },
      { lowerLimitPrice: "50400", upperLimitPrice: null },
      { lowerLimitPrice: "0", upperLimitPrice: "93000" },
      { lowerLimitPrice: "93000", upperLimitPrice: "50400" },
      { lowerLimitPrice: "93000.0", upperLimitPrice: "93000" },
    ]) {
      expectIssue(
        () => normalizeTossPriceLimit(priceLimit({ currency: "KRW", ...limits }), samsung),
        limits.lowerLimitPrice === "0" ? "PRICE_NON_POSITIVE" : "PRICE_LIMIT_INVALID",
      );
    }
  });

  it("미국 종목은 양쪽 제한이 null일 때만 허용한다", () => {
    expect(
      normalizeTossPriceLimit(
        priceLimit({ currency: "USD", lowerLimitPrice: null, upperLimitPrice: null }),
        apple,
      ),
    ).toMatchObject({ marketCountry: "US", lowerLimitPrice: null, upperLimitPrice: null });

    expectIssue(
      () =>
        normalizeTossPriceLimit(
          priceLimit({ currency: "USD", lowerLimitPrice: null, upperLimitPrice: "300" }),
          apple,
        ),
      "PRICE_LIMIT_INVALID",
    );
    expectIssue(
      () =>
        normalizeTossPriceLimit(
          priceLimit({ currency: "KRW", lowerLimitPrice: null, upperLimitPrice: null }),
          apple,
        ),
      "MARKET_CURRENCY_MISMATCH",
    );
  });
});

describe("market calendar normalizers", () => {
  it("KR 세션 종류와 provider가 준 단일가 경계만 보존한다", () => {
    const calendar = normalizeTossKrMarketCalendar(validKrCalendar());

    expect(calendar.marketCountry).toBe("KR");
    expect(calendar.today.sessions).toEqual([
      {
        kind: "PRE_MARKET",
        startAt: "2026-03-25T08:00:00+09:00",
        endAt: "2026-03-25T09:00:00+09:00",
        auctionStartAt: "2026-03-25T08:50:00+09:00",
        auctionEndAt: null,
      },
      {
        kind: "REGULAR_MARKET",
        startAt: "2026-03-25T09:00:00+09:00",
        endAt: "2026-03-25T15:30:00+09:00",
        auctionStartAt: "2026-03-25T15:20:00+09:00",
        auctionEndAt: null,
      },
      {
        kind: "AFTER_MARKET",
        startAt: "2026-03-25T15:30:00+09:00",
        endAt: "2026-03-25T20:00:00+09:00",
        auctionStartAt: null,
        auctionEndAt: "2026-03-25T15:40:00+09:00",
      },
    ]);
    expect(calendar.previousBusinessDay.sessions).toEqual([]);
  });

  it("US 4개 세션과 휴장일 빈 세션을 보존한다", () => {
    const calendar = normalizeTossUsMarketCalendar(validUsCalendar());

    expect(calendar.marketCountry).toBe("US");
    expect(calendar.today.sessions.map((session) => session.kind)).toEqual([
      "DAY_MARKET",
      "PRE_MARKET",
      "REGULAR_MARKET",
      "AFTER_MARKET",
    ]);
    expect(calendar.previousBusinessDay.sessions).toEqual([]);
    expect(calendar.today.sessions.every((session) => session.auctionStartAt === null)).toBe(true);
  });

  it("세션 시작이 종료와 같거나 늦으면 차단한다", () => {
    const response = validUsCalendar();
    response.result.today.regularMarket = {
      startTime: "2026-03-26T05:00:00+09:00",
      endTime: "2026-03-26T05:00:00+09:00",
    };

    expectIssue(() => normalizeTossUsMarketCalendar(response), "SESSION_INTERVAL_INVALID");
  });

  it("단일가 경계가 세션 구간 밖이면 차단하고 경계값 자체는 허용한다", () => {
    const outside = validKrCalendar();
    if (!outside.result.today.integrated?.regularMarket) {
      throw new Error("테스트 캘린더 정규장이 없습니다.");
    }
    outside.result.today.integrated.regularMarket.singlePriceAuctionStartTime =
      "2026-03-25T15:31:00+09:00";
    expectIssue(() => normalizeTossKrMarketCalendar(outside), "AUCTION_BOUNDARY_INVALID");

    const boundary = validKrCalendar();
    if (!boundary.result.today.integrated?.regularMarket) {
      throw new Error("테스트 캘린더 정규장이 없습니다.");
    }
    boundary.result.today.integrated.regularMarket.singlePriceAuctionStartTime =
      boundary.result.today.integrated.regularMarket.endTime;
    expect(normalizeTossKrMarketCalendar(boundary).today.sessions[1]?.auctionStartAt).toBe(
      "2026-03-25T15:30:00+09:00",
    );
  });

  it("이전일·기준일·다음일 역전과 세션 겹침을 차단한다", () => {
    const dateOrder = validUsCalendar();
    dateOrder.result.previousBusinessDay.date = "2026-03-25";
    expectIssue(() => normalizeTossUsMarketCalendar(dateOrder), "CALENDAR_DATE_ORDER_INVALID");

    const overlap = validUsCalendar();
    overlap.result.today.preMarket = {
      startTime: "2026-03-25T16:40:00+09:00",
      endTime: "2026-03-25T22:30:00+09:00",
    };
    expectIssue(() => normalizeTossUsMarketCalendar(overlap), "SESSION_OVERLAP");
  });
});

describe("normalizeTossSellableQuantity", () => {
  it("국내 정수와 미국 소수 수량을 정규 종목 식별자에 결합한다", () => {
    expect(normalizeTossSellableQuantity(sellable("100"), accountId, samsung)).toMatchObject({
      accountId: "account-1",
      marketCountry: "KR",
      symbol: "005930",
      quantity: "100",
    });
    expect(normalizeTossSellableQuantity(sellable("1.5"), accountId, apple).quantity).toBe("1.5");
  });

  it("음수 수량과 국내 소수 수량을 차단한다", () => {
    expectIssue(
      () => normalizeTossSellableQuantity(sellable("-1"), accountId, samsung),
      "SELLABLE_QUANTITY_NEGATIVE",
    );
    expectIssue(
      () => normalizeTossSellableQuantity(sellable("1.0"), accountId, samsung),
      "SELLABLE_QUANTITY_NOT_INTEGER",
    );
  });
});

describe("normalizeTossCommissions", () => {
  it("계좌별 시장 수수료율과 nullable 유효기간 일정을 보존한다", () => {
    const schedule = normalizeTossCommissions(
      commissions([
        {
          marketCountry: "KR",
          commissionRate: "0.015",
          startDate: "2026-01-01",
          endDate: "2026-06-30",
        },
        {
          marketCountry: "KR",
          commissionRate: "0.010",
          startDate: "2026-07-01",
          endDate: null,
        },
        {
          marketCountry: "US",
          commissionRate: "0.1",
          startDate: null,
          endDate: null,
        },
      ]),
      accountId,
      ["KR", "US"],
    );

    expect(schedule).toEqual({
      accountId: "account-1",
      periods: [
        {
          marketCountry: "KR",
          commissionRatePercent: "0.015",
          startDate: "2026-01-01",
          endDate: "2026-06-30",
        },
        {
          marketCountry: "KR",
          commissionRatePercent: "0.010",
          startDate: "2026-07-01",
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

  it("요청 시장 없음·중복·응답 누락을 차단한다", () => {
    const response = commissions([
      { marketCountry: "KR", commissionRate: "0.015", startDate: null, endDate: null },
    ]);

    expectIssue(() => normalizeTossCommissions(response, accountId, []), "REQUESTED_MARKETS_EMPTY");
    expectIssue(
      () => normalizeTossCommissions(response, accountId, ["KR", "KR"]),
      "REQUESTED_MARKET_DUPLICATE",
    );
    expectIssue(
      () => normalizeTossCommissions(response, accountId, ["KR", "US"]),
      "COMMISSION_MARKET_MISSING",
    );
  });

  it("음수 수수료율과 역전된 유효기간을 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossCommissions(
          commissions([
            { marketCountry: "KR", commissionRate: "-0.01", startDate: null, endDate: null },
          ]),
          accountId,
          ["KR"],
        ),
      "COMMISSION_RATE_NEGATIVE",
    );
    expectIssue(
      () =>
        normalizeTossCommissions(
          commissions([
            {
              marketCountry: "KR",
              commissionRate: "0.015",
              startDate: "2026-07-01",
              endDate: "2026-06-30",
            },
          ]),
          accountId,
          ["KR"],
        ),
      "COMMISSION_PERIOD_INVALID",
    );
  });

  it("같은 시장의 포함 경계·무기한 기간이 겹치면 차단한다", () => {
    expectIssue(
      () =>
        normalizeTossCommissions(
          commissions([
            {
              marketCountry: "KR",
              commissionRate: "0.015",
              startDate: "2026-01-01",
              endDate: "2026-06-30",
            },
            {
              marketCountry: "KR",
              commissionRate: "0.010",
              startDate: "2026-06-30",
              endDate: "2026-12-31",
            },
          ]),
          accountId,
          ["KR"],
        ),
      "COMMISSION_PERIOD_OVERLAP",
    );
    expectIssue(
      () =>
        normalizeTossCommissions(
          commissions([
            {
              marketCountry: "US",
              commissionRate: "0.1",
              startDate: null,
              endDate: null,
            },
            {
              marketCountry: "US",
              commissionRate: "0.05",
              startDate: "2026-07-01",
              endDate: null,
            },
          ]),
          accountId,
          ["US"],
        ),
      "COMMISSION_PERIOD_OVERLAP",
    );
  });
});

function instrument(marketCountry: MarketCountry, symbol: string): InstrumentIdentifier {
  return { marketCountry, symbol: symbol as SymbolCode };
}

function orderbook(result: {
  readonly timestamp?: string | null;
  readonly currency: "KRW" | "USD";
  readonly asks: readonly { readonly price: string; readonly volume: string }[];
  readonly bids: readonly { readonly price: string; readonly volume: string }[];
}) {
  return TossOrderbookResponseSchema.parse({ result });
}

function priceLimit(result: {
  readonly currency: "KRW" | "USD";
  readonly upperLimitPrice?: string | null;
  readonly lowerLimitPrice?: string | null;
}) {
  return TossPriceLimitResponseSchema.parse({
    result: {
      timestamp: "2026-03-25T09:30:00.123+09:00",
      ...result,
    },
  });
}

function sellable(sellableQuantity: string) {
  return TossSellableQuantityResponseSchema.parse({ result: { sellableQuantity } });
}

function commissions(
  result: readonly {
    readonly marketCountry: MarketCountry;
    readonly commissionRate: string;
    readonly startDate?: string | null;
    readonly endDate?: string | null;
  }[],
) {
  return TossCommissionsResponseSchema.parse({ result });
}

function validKrCalendar() {
  return TossKrMarketCalendarResponseSchema.parse({
    result: {
      today: {
        date: "2026-03-25",
        integrated: {
          preMarket: {
            startTime: "2026-03-25T08:00:00+09:00",
            singlePriceAuctionStartTime: "2026-03-25T08:50:00+09:00",
            endTime: "2026-03-25T09:00:00+09:00",
          },
          regularMarket: {
            startTime: "2026-03-25T09:00:00+09:00",
            singlePriceAuctionStartTime: "2026-03-25T15:20:00+09:00",
            endTime: "2026-03-25T15:30:00+09:00",
          },
          afterMarket: {
            startTime: "2026-03-25T15:30:00+09:00",
            singlePriceAuctionEndTime: "2026-03-25T15:40:00+09:00",
            endTime: "2026-03-25T20:00:00+09:00",
          },
        },
      },
      previousBusinessDay: { date: "2026-03-24", integrated: null },
      nextBusinessDay: { date: "2026-03-26", integrated: null },
    },
  });
}

function validUsCalendar() {
  return TossUsMarketCalendarResponseSchema.parse({
    result: {
      today: {
        date: "2026-03-25",
        dayMarket: {
          startTime: "2026-03-25T09:00:00+09:00",
          endTime: "2026-03-25T16:50:00+09:00",
        },
        preMarket: {
          startTime: "2026-03-25T17:00:00+09:00",
          endTime: "2026-03-25T22:30:00+09:00",
        },
        regularMarket: {
          startTime: "2026-03-25T22:30:00+09:00",
          endTime: "2026-03-26T05:00:00+09:00",
        },
        afterMarket: {
          startTime: "2026-03-26T05:00:00+09:00",
          endTime: "2026-03-26T07:00:00+09:00",
        },
      },
      previousBusinessDay: { date: "2026-03-24" },
      nextBusinessDay: { date: "2026-03-26" },
    },
  });
}

function expectIssue(action: () => unknown, issue: TossNeutralReadModelIssue): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TossNeutralReadModelError);
    expect((error as TossNeutralReadModelError).issue).toBe(issue);
    return;
  }
  throw new Error(`예상한 중립 모델 오류가 발생하지 않았습니다: ${issue}`);
}
