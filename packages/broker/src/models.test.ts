import type { DecimalString } from "@portfolio-rebalancer/domain";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  AccountId,
  BrokerId,
  BrokerReadResult,
  CommissionRateSchedule,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  OrderBookSnapshot,
  PriceLimitQuote,
  PriceQuote,
  SellableQuantityQuote,
  SymbolCode,
} from "./models";

const accountId = "account-1" as AccountId;
const brokerId = "toss" as BrokerId;
const krSymbol = "005930" as SymbolCode;
const usSymbol = "AAPL" as SymbolCode;
const observedAt = "2026-07-16T09:00:00+09:00" as IsoDateTime;
const tradeDate = "2026-07-16" as IsoDate;
const decimal = (value: string): DecimalString => value as DecimalString;

describe("broker-neutral read models", () => {
  it("시세와 호가에 정규 종목 식별자·통화·nullable 관측시각을 보존한다", () => {
    const quote: PriceQuote = {
      marketCountry: "KR",
      symbol: krSymbol,
      price: decimal("72000"),
      currency: "KRW",
      observedAt: null,
    };
    const orderBook: OrderBookSnapshot = {
      marketCountry: "US",
      symbol: usSymbol,
      currency: "USD",
      bids: [{ price: decimal("211.10"), quantity: decimal("5") }],
      asks: [{ price: decimal("211.11"), quantity: decimal("3") }],
      observedAt: null,
    };

    expect(quote).toMatchObject({ marketCountry: "KR", symbol: "005930", observedAt: null });
    expect(orderBook).toMatchObject({ marketCountry: "US", symbol: "AAPL", observedAt: null });
  });

  it("모든 조회 결과에 HTTP 수신 시각·request ID·정적 rate group 메타데이터를 붙인다", () => {
    const result: BrokerReadResult<readonly PriceQuote[]> = {
      value: [
        {
          marketCountry: "KR",
          symbol: krSymbol,
          price: decimal("72000"),
          currency: "KRW",
          observedAt,
        },
      ],
      metadata: {
        brokerId,
        operationId: "getPrices",
        requestId: "request-1",
        httpStatus: 200,
        rateLimitGroup: "MARKET_DATA",
        receivedAt: observedAt,
      },
    };

    expect(result.metadata).toMatchObject({
      operationId: "getPrices",
      requestId: "request-1",
      rateLimitGroup: "MARKET_DATA",
    });
  });

  it("가격 제한은 별도 모델에서 제한 없음(null)과 관측시각을 보존한다", () => {
    const priceLimit: PriceLimitQuote = {
      marketCountry: "US",
      symbol: usSymbol,
      currency: "USD",
      upperLimitPrice: null,
      lowerLimitPrice: null,
      observedAt,
    };

    expect(priceLimit.upperLimitPrice).toBeNull();
    expect(priceLimit.lowerLimitPrice).toBeNull();
  });

  it("시장 캘린더의 날짜·세션 종류·거래 구간·단일가 경계를 축약하지 않는다", () => {
    const calendar: MarketCalendar = {
      marketCountry: "KR",
      today: {
        date: tradeDate,
        sessions: [
          {
            kind: "PRE_MARKET",
            startAt: "2026-07-16T08:00:00+09:00" as IsoDateTime,
            endAt: "2026-07-16T09:00:00+09:00" as IsoDateTime,
            auctionStartAt: "2026-07-16T08:50:00+09:00" as IsoDateTime,
            auctionEndAt: null,
          },
          {
            kind: "REGULAR_MARKET",
            startAt: "2026-07-16T09:00:00+09:00" as IsoDateTime,
            endAt: "2026-07-16T15:30:00+09:00" as IsoDateTime,
            auctionStartAt: "2026-07-16T15:20:00+09:00" as IsoDateTime,
            auctionEndAt: null,
          },
        ],
      },
      previousBusinessDay: { date: "2026-07-15" as IsoDate, sessions: [] },
      nextBusinessDay: { date: "2026-07-17" as IsoDate, sessions: [] },
    };

    expect(calendar.today.sessions.map((session) => session.kind)).toEqual([
      "PRE_MARKET",
      "REGULAR_MARKET",
    ]);
    expect(calendar.today.sessions[0]?.auctionStartAt).toBe("2026-07-16T08:50:00+09:00");
  });

  it("매도 가능 수량은 시장을 포함하고 수수료는 계좌별 시장·유효기간 일정이다", () => {
    const sellable: SellableQuantityQuote = {
      accountId,
      marketCountry: "US",
      symbol: usSymbol,
      quantity: decimal("1.5"),
    };
    const commissions: CommissionRateSchedule = {
      accountId,
      periods: [
        {
          marketCountry: "KR",
          commissionRatePercent: decimal("0.015"),
          startDate: tradeDate,
          endDate: null,
        },
        {
          marketCountry: "US",
          commissionRatePercent: decimal("0.1"),
          startDate: null,
          endDate: null,
        },
      ],
    };

    expect(sellable).toMatchObject({ marketCountry: "US", symbol: "AAPL" });
    expect(commissions.periods).toHaveLength(2);
    expect(commissions.periods[0]).not.toHaveProperty("symbol");
    expectTypeOf(commissions.periods[0]?.commissionRatePercent).toEqualTypeOf<
      DecimalString | undefined
    >();
  });
});
