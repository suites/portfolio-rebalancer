import type { IsoDateTime, PriceQuote, SymbolCode } from "@portfolio-rebalancer/broker";
import { decimal } from "@portfolio-rebalancer/domain";
import { describe, expect, it } from "vitest";

import { evaluatePriceMovement } from "./price-movement";

describe("evaluatePriceMovement", () => {
  it("허용 bp 정확 경계는 통과하고 1 미세단위 초과는 차단한다", () => {
    const exact = evaluatePriceMovement({
      previous: quote("100.0000", "2026-07-16T09:00:00+09:00"),
      current: quote("101.0000", "2026-07-16T09:00:01+09:00"),
      maxAbsoluteChangeBasisPoints: 100n,
    });
    const exceeded = evaluatePriceMovement({
      previous: quote("100.0000", "2026-07-16T09:00:00+09:00"),
      current: quote("101.0001", "2026-07-16T09:00:01+09:00"),
      maxAbsoluteChangeBasisPoints: 100n,
    });

    expect(exact).toMatchObject({
      status: "READY",
      canProceed: true,
      reasonCode: "PRICE_MOVEMENT_ACCEPTABLE",
      changeBasisPointsFloor: 100n,
    });
    expect(exceeded).toMatchObject({
      status: "BLOCKED",
      canProceed: false,
      reasonCode: "PRICE_MOVEMENT_LIMIT_EXCEEDED",
      changeBasisPointsFloor: 100n,
    });
  });

  it("상승과 하락을 절대 변동으로 동일하게 판정한다", () => {
    expect(
      evaluatePriceMovement({
        previous: quote("100", "2026-07-16T09:00:00+09:00"),
        current: quote("95", "2026-07-16T09:00:01+09:00"),
        maxAbsoluteChangeBasisPoints: 499n,
      }).reasonCode,
    ).toBe("PRICE_MOVEMENT_LIMIT_EXCEEDED");
  });

  it("종목·통화·시간 증거가 다르면 fail closed 한다", () => {
    expect(
      evaluatePriceMovement({
        previous: quote("100", "2026-07-16T09:00:00+09:00"),
        current: { ...quote("100", "2026-07-16T09:00:01+09:00"), symbol: "000660" as SymbolCode },
        maxAbsoluteChangeBasisPoints: 100n,
      }).reasonCode,
    ).toBe("PRICE_MOVEMENT_INSTRUMENT_MISMATCH");
    expect(
      evaluatePriceMovement({
        previous: quote("100", "2026-07-16T09:00:00+09:00"),
        current: { ...quote("100", "2026-07-16T09:00:01+09:00"), currency: "USD" },
        maxAbsoluteChangeBasisPoints: 100n,
      }).reasonCode,
    ).toBe("PRICE_MOVEMENT_CURRENCY_MISMATCH");
    expect(
      evaluatePriceMovement({
        previous: quote("100", "2026-07-16T09:00:01+09:00"),
        current: quote("100", "2026-07-16T09:00:00+09:00"),
        maxAbsoluteChangeBasisPoints: 100n,
      }).reasonCode,
    ).toBe("PRICE_MOVEMENT_TIME_ORDER_INVALID");
    expect(
      evaluatePriceMovement({
        previous: quote("100", null),
        current: quote("100", "2026-07-16T09:00:01+09:00"),
        maxAbsoluteChangeBasisPoints: 100n,
      }).reasonCode,
    ).toBe("PRICE_MOVEMENT_TIME_UNKNOWN");
  });
});

function quote(price: string, observedAt: string | null): PriceQuote {
  return {
    marketCountry: "KR",
    symbol: "005930" as SymbolCode,
    price: decimal(price),
    currency: "KRW",
    observedAt: observedAt as IsoDateTime | null,
  };
}
