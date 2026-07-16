import { describe, expect, it } from "vitest";

import { calculateOrderGrossReservation } from "./order-reservation";

describe("calculateOrderGrossReservation", () => {
  it("매수는 지정가보다 높게 체결될 수 없으므로 계획금액을 그대로 예약한다", () => {
    expect(
      calculateOrderGrossReservation({
        side: "BUY",
        quantity: 3n,
        limitPriceMinor: 10_000n,
        upperPriceLimitMinor: 15_000n,
      }),
    ).toMatchObject({
      status: "READY",
      plannedGrossMinor: 30_000n,
      reservedGrossMinor: 30_000n,
    });
  });

  it("매도는 가격 개선으로 계획금액을 넘을 수 있어 상한가 기준으로 예약한다", () => {
    expect(
      calculateOrderGrossReservation({
        side: "SELL",
        quantity: 3n,
        limitPriceMinor: 10_000n,
        upperPriceLimitMinor: 13_000n,
      }),
    ).toMatchObject({
      status: "READY",
      plannedGrossMinor: 30_000n,
      reservedGrossMinor: 39_000n,
    });
  });

  it("매도 상한가가 없거나 지정가보다 낮으면 fail closed 한다", () => {
    expect(
      calculateOrderGrossReservation({
        side: "SELL",
        quantity: 1n,
        limitPriceMinor: 10_000n,
        upperPriceLimitMinor: null,
      }).reasonCode,
    ).toBe("SELL_UPPER_PRICE_LIMIT_MISSING");
    expect(
      calculateOrderGrossReservation({
        side: "SELL",
        quantity: 1n,
        limitPriceMinor: 10_000n,
        upperPriceLimitMinor: 9_999n,
      }).reasonCode,
    ).toBe("SELL_UPPER_PRICE_LIMIT_INVALID");
  });

  it("signed bigint 범위를 넘는 예약을 저장하지 않는다", () => {
    expect(
      calculateOrderGrossReservation({
        side: "BUY",
        quantity: 9_223_372_036_854_775_807n,
        limitPriceMinor: 2n,
        upperPriceLimitMinor: null,
      }).reasonCode,
    ).toBe("ORDER_RESERVATION_OVERFLOW");
  });
});
