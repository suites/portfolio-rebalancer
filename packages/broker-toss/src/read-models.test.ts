import { describe, expect, it } from "vitest";

import {
  TossAccountsResponseSchema,
  TossBuyingPowerResponseSchema,
  TossCommissionsResponseSchema,
  TossHoldingsResponseSchema,
  TossKrMarketCalendarResponseSchema,
  TossOrderbookResponseSchema,
  TossPriceLimitResponseSchema,
  TossPricesResponseSchema,
  TossSellableQuantityResponseSchema,
  TossStockWarningsResponseSchema,
  TossStocksResponseSchema,
  TossUsMarketCalendarResponseSchema,
} from "./read-models";

describe("Toss read response schemas", () => {
  it("안전 정수 범위를 벗어난 accountSeq를 거부한다", () => {
    expect(
      TossAccountsResponseSchema.safeParse({
        result: [
          { accountNo: "12345678901", accountSeq: Number.MAX_VALUE, accountType: "BROKERAGE" },
        ],
      }).success,
    ).toBe(false);
  });

  it("decimal number로 변형된 보유 응답을 거부한다", () => {
    const result = TossHoldingsResponseSchema.safeParse({
      result: {
        totalPurchaseAmount: { krw: "1000", usd: null },
        marketValue: {
          amount: { krw: "1100", usd: null },
          amountAfterCost: { krw: "1090", usd: null },
        },
        profitLoss: {
          amount: { krw: "100", usd: null },
          amountAfterCost: { krw: "90", usd: null },
          rate: "0.1",
          rateAfterCost: "0.09",
        },
        dailyProfitLoss: { amount: { krw: "10", usd: null }, rate: "0.01" },
        items: [
          {
            symbol: "005930",
            name: "삼성전자",
            marketCountry: "KR",
            currency: "KRW",
            quantity: 1,
            lastPrice: "1100",
            averagePurchasePrice: "1000",
            marketValue: { purchaseAmount: "1000", amount: "1100", amountAfterCost: "1090" },
            profitLoss: {
              amount: "100",
              amountAfterCost: "90",
              rate: "0.1",
              rateAfterCost: "0.09",
            },
            dailyProfitLoss: { amount: "10", rate: "0.01" },
            cost: { commission: "1", tax: "9" },
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("매수 가능 금액은 KRW·USD의 0 이상 decimal 문자열만 허용한다", () => {
    expect(
      TossBuyingPowerResponseSchema.safeParse({
        result: { currency: "KRW", cashBuyingPower: "5000000" },
      }).success,
    ).toBe(true);
    expect(
      TossBuyingPowerResponseSchema.safeParse({
        result: { currency: "JPY", cashBuyingPower: "5000" },
      }).success,
    ).toBe(false);
    expect(
      TossBuyingPowerResponseSchema.safeParse({
        result: { currency: "USD", cashBuyingPower: "-1" },
      }).success,
    ).toBe(false);
    expect(
      TossBuyingPowerResponseSchema.safeParse({
        result: { currency: "USD", cashBuyingPower: 1 },
      }).success,
    ).toBe(false);
  });

  it("종목 기본 정보의 시장, 상태, 통화와 decimal 필드를 검증한다", () => {
    const valid = {
      result: [
        {
          symbol: "360750",
          name: "TIGER 미국S&P500",
          englishName: "TIGER S&P500",
          isinCode: "KR7360750004",
          market: "KOSPI",
          securityType: "ETF",
          isCommonShare: false,
          status: "ACTIVE",
          currency: "KRW",
          listDate: "2020-08-07",
          delistDate: null,
          sharesOutstanding: "1000000",
          leverageFactor: "1.0",
          koreanMarketDetail: {
            liquidationTrading: false,
            nxtSupported: false,
            krxTradingSuspended: false,
            nxtTradingSuspended: null,
          },
        },
      ],
    };

    expect(TossStocksResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      TossStocksResponseSchema.safeParse({
        result: [{ ...valid.result[0], market: "LSE" }],
      }).success,
    ).toBe(false);
    expect(
      TossStocksResponseSchema.safeParse({
        result: [{ ...valid.result[0], sharesOutstanding: -1 }],
      }).success,
    ).toBe(false);
  });

  it("종목 유의사항은 알려지지 않은 warningType도 허용하고 날짜 형식은 검증한다", () => {
    expect(
      TossStockWarningsResponseSchema.safeParse({
        result: [
          {
            warningType: "FUTURE_WARNING_CODE",
            exchange: "KRX",
            startDate: "2026-03-26",
            endDate: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      TossStockWarningsResponseSchema.safeParse({
        result: [{ warningType: "", exchange: null }],
      }).success,
    ).toBe(false);
    expect(
      TossStockWarningsResponseSchema.safeParse({
        result: [{ warningType: "VI_STATIC", startDate: "2026-03-26T09:00:00+09:00" }],
      }).success,
    ).toBe(false);
  });

  it("공식 decimal 문자열 최대 길이 30자를 모든 신규 시세 계약에 적용한다", () => {
    expect(
      TossPricesResponseSchema.safeParse({
        result: [
          {
            symbol: "005930",
            timestamp: null,
            lastPrice: "1".repeat(30),
            currency: "KRW",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      TossPricesResponseSchema.safeParse({
        result: [
          {
            symbol: "005930",
            timestamp: null,
            lastPrice: "1".repeat(31),
            currency: "KRW",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      TossCommissionsResponseSchema.safeParse({
        result: [{ marketCountry: "KR", commissionRate: "0." + "1".repeat(29) }],
      }).success,
    ).toBe(false);
  });

  it("시세·호가·가격 제한의 공식 nullable/empty 응답을 전송 스키마에서 허용한다", () => {
    expect(TossPricesResponseSchema.safeParse({ result: [] }).success).toBe(true);
    expect(
      TossPricesResponseSchema.safeParse({
        result: [{ symbol: "AAPL", lastPrice: "0", currency: "USD" }],
      }).success,
    ).toBe(true);
    expect(
      TossOrderbookResponseSchema.safeParse({
        result: { timestamp: null, currency: "KRW", asks: [], bids: [] },
      }).success,
    ).toBe(true);
    expect(
      TossPriceLimitResponseSchema.safeParse({
        result: {
          timestamp: "2026-03-25T09:30:00.123+09:00",
          upperLimitPrice: null,
          lowerLimitPrice: null,
          currency: "USD",
        },
      }).success,
    ).toBe(true);
  });

  it("캘린더의 휴장일·부분 세션·nullable 단일가 경계를 전송 스키마에서 허용한다", () => {
    expect(
      TossKrMarketCalendarResponseSchema.safeParse({
        result: {
          today: { date: "2026-03-25", integrated: null },
          previousBusinessDay: {
            date: "2026-03-24",
            integrated: {
              preMarket: null,
              regularMarket: {
                startTime: "2026-03-24T09:00:00+09:00",
                singlePriceAuctionStartTime: null,
                endTime: "2026-03-24T15:30:00+09:00",
              },
            },
          },
          nextBusinessDay: { date: "2026-03-26" },
        },
      }).success,
    ).toBe(true);
    expect(
      TossUsMarketCalendarResponseSchema.safeParse({
        result: {
          today: {
            date: "2026-03-25",
            dayMarket: null,
            preMarket: null,
            regularMarket: null,
            afterMarket: null,
          },
          previousBusinessDay: { date: "2026-03-24" },
          nextBusinessDay: { date: "2026-03-26" },
        },
      }).success,
    ).toBe(true);
  });

  it("매도 가능 수량과 수수료의 빈 배열·nullable 유효기간은 원본 단계에서 보존한다", () => {
    expect(
      TossSellableQuantityResponseSchema.safeParse({
        result: { sellableQuantity: "-1.5" },
      }).success,
    ).toBe(true);
    expect(TossCommissionsResponseSchema.safeParse({ result: [] }).success).toBe(true);
    expect(
      TossCommissionsResponseSchema.safeParse({
        result: [
          {
            marketCountry: "US",
            commissionRate: "0.1",
            startDate: null,
            endDate: null,
          },
          { marketCountry: "KR", commissionRate: "0.015" },
        ],
      }).success,
    ).toBe(true);
  });

  it("provider date-time은 offset을, 캘린더와 수수료 날짜는 ISO date를 요구한다", () => {
    expect(
      TossPricesResponseSchema.safeParse({
        result: [
          {
            symbol: "005930",
            timestamp: "2026-03-25T09:30:00",
            lastPrice: "72000",
            currency: "KRW",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      TossKrMarketCalendarResponseSchema.safeParse({
        result: {
          today: { date: "2026-02-30" },
          previousBusinessDay: { date: "2026-02-27" },
          nextBusinessDay: { date: "2026-03-02" },
        },
      }).success,
    ).toBe(false);
    expect(
      TossCommissionsResponseSchema.safeParse({
        result: [{ marketCountry: "KR", commissionRate: "0.015", startDate: "2026-01" }],
      }).success,
    ).toBe(false);
  });

  it("성공 응답 스키마는 result 누락을 모두 거부한다", () => {
    const schemas = [
      TossPricesResponseSchema,
      TossOrderbookResponseSchema,
      TossPriceLimitResponseSchema,
      TossKrMarketCalendarResponseSchema,
      TossUsMarketCalendarResponseSchema,
      TossSellableQuantityResponseSchema,
      TossCommissionsResponseSchema,
    ];

    for (const schema of schemas) {
      expect(schema.safeParse({}).success).toBe(false);
    }
  });
});
