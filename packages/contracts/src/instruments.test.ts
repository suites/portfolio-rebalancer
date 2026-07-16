import { describe, expect, it } from "vitest";

import {
  InstrumentCatalogSearchResultSchema,
  InstrumentSearchInputSchema,
  InstrumentValidationInputSchema,
  InstrumentValidationResultSchema,
} from "./instruments";

describe("instrument search contract", () => {
  const candidate = {
    validationId: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
    instrumentKey: "US:SGOV",
    symbol: "SGOV",
    name: "아이셰어즈 0-3개월 미국채",
    englishName: "iShares 0-3 Month Treasury Bond ETF",
    marketCountry: "US",
    listingMarket: "NYSE",
    currency: "USD",
    securityType: "FOREIGN_ETF",
    listingStatus: "ACTIVE",
    source: "TOSS_EXACT",
    targetEligibility: "ELIGIBLE",
    targetReasonCodes: [],
    addEligible: true,
    blockedReason: null,
    tradeBlockedNow: false,
    tradeReasonCodes: [],
    tradeBlockedReason: null,
    requiresOrderRevalidation: false,
    verifiedAt: "2026-07-16T13:00:00.000Z",
  } as const;

  it("이름 검색과 정확 심볼 검증 계약을 분리한다", () => {
    expect(InstrumentSearchInputSchema.parse({ query: "  US:SGOV  " })).toEqual({
      query: "US:SGOV",
    });
    expect(InstrumentSearchInputSchema.safeParse({ query: "" }).success).toBe(false);
    expect(
      InstrumentCatalogSearchResultSchema.safeParse({
        query: "SGOV",
        catalogScope: "LOCAL_VALIDATED",
        candidates: [{ ...candidate, source: "CATALOG" }],
      }).success,
    ).toBe(true);
    expect(InstrumentValidationResultSchema.safeParse({ candidate }).success).toBe(true);
  });

  it("정확 심볼 형식이 아닌 이름은 검증 입력에서 거부한다", () => {
    expect(InstrumentValidationInputSchema.safeParse({ query: "KR:005930" }).success).toBe(true);
    expect(InstrumentValidationInputSchema.safeParse({ query: "삼성전자" }).success).toBe(false);
  });
});
