import { describe, expect, it } from "vitest";

import type { TossStockInfo, TossStockWarning } from "@portfolio-rebalancer/broker-toss";

import {
  normalizeTossInstrumentValidation,
  parseExactInstrumentQuery,
  selectExactStock,
  validationCandidate,
} from "./instrument-catalog";

const observedAt = new Date("2026-07-16T13:00:00.000Z");

describe("instrument catalog policy", () => {
  it("국내 6자리 코드, 미국 티커와 올바른 국가 접두어만 정확 조회로 분류한다", () => {
    expect(parseExactInstrumentQuery("360750")).toEqual({
      requestedMarketCountry: "KR",
      symbol: "360750",
    });
    expect(parseExactInstrumentQuery("sgov")).toEqual({
      requestedMarketCountry: "US",
      symbol: "SGOV",
    });
    expect(parseExactInstrumentQuery("kr:005930")).toEqual({
      requestedMarketCountry: "KR",
      symbol: "005930",
    });
    expect(parseExactInstrumentQuery("KR:AAPL")).toBeNull();
    expect(parseExactInstrumentQuery("US:005930")).toBeNull();
    expect(parseExactInstrumentQuery("삼성전자")).toBeNull();
  });

  it("요청 시장과 심볼에 정확히 일치하는 단 하나의 응답만 선택한다", () => {
    const stock = stockFixture();
    expect(selectExactStock([stock], { requestedMarketCountry: "US", symbol: "SGOV" })).toBe(stock);
    expect(() =>
      selectExactStock([stock], { requestedMarketCountry: "KR", symbol: "SGOV" }),
    ).toThrow("정확히 일치");
    expect(() =>
      selectExactStock([stock, { ...stock }], { requestedMarketCountry: "US", symbol: "SGOV" }),
    ).toThrow("둘 이상");
  });

  it("지원 시장의 일반 ETF를 목표 편입 가능으로 고정한다", () => {
    const validation = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "US", symbol: "SGOV" },
      stock: stockFixture(),
      warnings: [],
      observedAt,
    });

    expect(validation).toMatchObject({
      marketCountry: "US",
      targetEligibility: "ELIGIBLE",
      targetReasonCodes: [],
      tradeBlockedNow: false,
    });
    expect(
      validationCandidate(
        { id: "2bf2e437-c981-4dbd-842e-d0d9a11ac318", ...validation },
        "TOSS_EXACT",
      ),
    ).toMatchObject({
      instrumentKey: "US:SGOV",
      addEligible: true,
      blockedReason: null,
    });
  });

  it.each([
    [{ market: "US_ETC" as const }, "UNSUPPORTED_LISTING_MARKET"],
    [{ currency: "KRW" as const }, "CURRENCY_MISMATCH"],
    [{ status: "DELISTED" as const }, "LISTING_NOT_ACTIVE"],
    [{ delistDate: "2026-07-15" }, "LISTING_METADATA_CONFLICT"],
    [{ securityType: "STOCK_WARRANTS" as const }, "UNSUPPORTED_SECURITY_TYPE"],
    [{ leverageFactor: null }, "LEVERAGE_UNKNOWN"],
    [{ leverageFactor: "2.0" }, "LEVERAGED_OR_INVERSE"],
  ])("구조적 위험 %o를 목표 편입에서 차단한다", (override, reason) => {
    const validation = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "US", symbol: "SGOV" },
      stock: stockFixture(override),
      warnings: [],
      observedAt,
    });
    expect(validation.targetEligibility).toBe("BLOCKED");
    expect(validation.targetReasonCodes).toContain(reason);
  });

  it("국내 상세 누락과 정리매매는 목표를 차단하고 KRX 정지는 거래만 차단한다", () => {
    const missingDetail = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "KR", symbol: "005930" },
      stock: koreanStockFixture({ koreanMarketDetail: null }),
      warnings: [],
      observedAt,
    });
    expect(missingDetail.targetReasonCodes).toContain("UNKNOWN_REFERENCE_CODE");

    const liquidation = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "KR", symbol: "005930" },
      stock: koreanStockFixture({
        koreanMarketDetail: koreanDetail({ liquidationTrading: true }),
      }),
      warnings: [],
      observedAt,
    });
    expect(liquidation.targetReasonCodes).toContain("LIQUIDATION_TRADING");

    const suspended = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "KR", symbol: "005930" },
      stock: koreanStockFixture({
        koreanMarketDetail: koreanDetail({ krxTradingSuspended: true }),
      }),
      warnings: [],
      observedAt,
    });
    expect(suspended.targetEligibility).toBe("ELIGIBLE");
    expect(suspended.tradeReasonCodes).toEqual(["KRX_TRADING_SUSPENDED"]);
  });

  it("NXT 단독 정지는 전체 거래를 막지 않고 경고와 미지 코드는 거래 상태로 분리한다", () => {
    const nxtOnly = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "KR", symbol: "005930" },
      stock: koreanStockFixture({
        koreanMarketDetail: koreanDetail({
          nxtSupported: true,
          nxtTradingSuspended: true,
        }),
      }),
      warnings: [],
      observedAt,
    });
    expect(nxtOnly.tradeBlockedNow).toBe(false);

    const warned = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "KR", symbol: "005930" },
      stock: koreanStockFixture(),
      warnings: [warningFixture("INVESTMENT_WARNING"), warningFixture("FUTURE_UNKNOWN_WARNING")],
      observedAt,
    });
    expect(warned.targetEligibility).toBe("ELIGIBLE");
    expect(warned.tradeReasonCodes).toEqual(["INVESTMENT_WARNING", "UNKNOWN_STOCK_WARNING"]);
  });

  it("VI는 목표 편입과 분리하고 주문 직전 재검증 플래그를 남긴다", () => {
    const validation = normalizeTossInstrumentValidation({
      request: { requestedMarketCountry: "US", symbol: "SGOV" },
      stock: stockFixture(),
      warnings: [warningFixture("VI_STATIC")],
      observedAt,
    });
    expect(validation.targetEligibility).toBe("ELIGIBLE");
    expect(validation.tradeBlockedNow).toBe(true);
    expect(validation.requiresOrderRevalidation).toBe(true);
  });
});

function stockFixture(override: Partial<TossStockInfo> = {}): TossStockInfo {
  return {
    symbol: "SGOV",
    name: "아이셰어즈 0-3개월 미국채",
    englishName: "iShares 0-3 Month Treasury Bond ETF",
    isinCode: "US46436E7186",
    market: "NYSE",
    securityType: "FOREIGN_ETF",
    isCommonShare: false,
    status: "ACTIVE",
    currency: "USD",
    listDate: "2020-05-26",
    delistDate: null,
    sharesOutstanding: "1000000",
    leverageFactor: "1.0",
    koreanMarketDetail: null,
    ...override,
  };
}

function koreanStockFixture(override: Partial<TossStockInfo> = {}): TossStockInfo {
  return {
    symbol: "005930",
    name: "삼성전자",
    englishName: "Samsung Electronics",
    isinCode: "KR7005930003",
    market: "KOSPI",
    securityType: "STOCK",
    isCommonShare: true,
    status: "ACTIVE",
    currency: "KRW",
    listDate: "1975-06-11",
    delistDate: null,
    sharesOutstanding: "5969782550",
    leverageFactor: null,
    koreanMarketDetail: koreanDetail(),
    ...override,
  };
}

function koreanDetail(
  override: Partial<NonNullable<TossStockInfo["koreanMarketDetail"]>> = {},
): NonNullable<TossStockInfo["koreanMarketDetail"]> {
  return {
    liquidationTrading: false,
    nxtSupported: true,
    krxTradingSuspended: false,
    nxtTradingSuspended: false,
    ...override,
  };
}

function warningFixture(warningType: string): TossStockWarning {
  return {
    warningType,
    exchange: null,
    startDate: "2026-07-16",
    endDate: null,
  };
}
