import { describe, expect, it } from "vitest";

import { evaluateExposureLimits, evaluateTradeNotionalLimits } from "./risk-limits";

describe("evaluateTradeNotionalLimits", () => {
  const base = {
    baselinePortfolioValueMinor: 1_000_000n,
    tradeDayFilledGrossMinor: 20_000n,
    reservedPendingGrossMinor: 30_000n,
    plannedOrders: [{ logicalOrderId: "order-1", grossNotionalMinor: 50_000n }],
    maxSingleOrderMinor: 50_000n,
    maxDailyGrossMinor: 100_000n,
    maxDailyTurnoverBasisPoints: 1_000n,
  } as const;

  it("단일·일일·회전율 정확 경계는 허용한다", () => {
    expect(evaluateTradeNotionalLimits(base)).toMatchObject({
      status: "READY",
      canProceed: true,
      reasonCode: "TRADE_LIMITS_OK",
      projectedDailyGrossMinor: 100_000n,
      projectedTurnoverBasisPointsFloor: 1_000n,
    });
  });

  it("단일 주문, 일일 총액, 회전율 초과를 각각 차단한다", () => {
    expect(
      evaluateTradeNotionalLimits({
        ...base,
        plannedOrders: [{ logicalOrderId: "order-1", grossNotionalMinor: 50_001n }],
        maxDailyGrossMinor: 200_000n,
      }).reasonCode,
    ).toBe("SINGLE_ORDER_LIMIT_EXCEEDED");
    expect(
      evaluateTradeNotionalLimits({
        ...base,
        maxDailyGrossMinor: 99_999n,
      }).reasonCode,
    ).toBe("DAILY_GROSS_LIMIT_EXCEEDED");
    expect(
      evaluateTradeNotionalLimits({
        ...base,
        maxDailyGrossMinor: 200_000n,
        maxDailyTurnoverBasisPoints: 999n,
      }).reasonCode,
    ).toBe("DAILY_TURNOVER_LIMIT_EXCEEDED");
  });

  it("pending 예약을 빼거나 중복 logical order를 허용하지 않는다", () => {
    expect(
      evaluateTradeNotionalLimits({
        ...base,
        plannedOrders: [
          { logicalOrderId: "same", grossNotionalMinor: 1n },
          { logicalOrderId: "same", grossNotionalMinor: 1n },
        ],
      }).reasonCode,
    ).toBe("TRADE_LIMIT_INPUT_INVALID");
    expect(
      evaluateTradeNotionalLimits({
        ...base,
        reservedPendingGrossMinor: -1n,
      }).reasonCode,
    ).toBe("TRADE_LIMIT_INPUT_INVALID");
  });
});

describe("evaluateExposureLimits", () => {
  const base = {
    portfolioValueMinor: 1_000_000n,
    instruments: [
      { key: "KR:005930", valueMinor: 400_000n },
      { key: "KR:000660", valueMinor: 300_000n },
    ],
    assetClasses: [
      { key: "CORE", valueMinor: 700_000n },
      { key: "SAFE", valueMinor: 200_000n },
      { key: "CASH", valueMinor: 100_000n },
    ],
    riskyAssetValueMinor: 700_000n,
    maxInstrumentBasisPoints: 4_000n,
    maxAssetClassBasisPoints: 7_000n,
    maxRiskyAssetBasisPoints: 7_000n,
  } as const;

  it("종목·자산군·위험자산 정확 경계를 허용한다", () => {
    expect(evaluateExposureLimits(base)).toMatchObject({
      status: "READY",
      canProceed: true,
      reasonCode: "EXPOSURE_LIMITS_OK",
    });
  });

  it("종목·자산군·위험자산 상한 초과를 각각 차단한다", () => {
    expect(
      evaluateExposureLimits({
        ...base,
        instruments: [{ key: "KR:005930", valueMinor: 400_001n }],
      }).reasonCode,
    ).toBe("INSTRUMENT_WEIGHT_LIMIT_EXCEEDED");
    expect(
      evaluateExposureLimits({
        ...base,
        assetClasses: [{ key: "CORE", valueMinor: 700_001n }],
      }).reasonCode,
    ).toBe("ASSET_CLASS_WEIGHT_LIMIT_EXCEEDED");
    expect(
      evaluateExposureLimits({
        ...base,
        riskyAssetValueMinor: 700_001n,
      }).reasonCode,
    ).toBe("RISKY_ASSET_WEIGHT_LIMIT_EXCEEDED");
  });
});
