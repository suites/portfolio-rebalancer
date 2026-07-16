import { describe, expect, it } from "vitest";

import {
  TossAccountsResponseSchema,
  TossBuyingPowerResponseSchema,
  TossHoldingsResponseSchema,
  TossStockWarningsResponseSchema,
  TossStocksResponseSchema,
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
});
