import { describe, expect, it } from "vitest";

import { TossAccountsResponseSchema, TossHoldingsResponseSchema } from "./read-models";

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
});
