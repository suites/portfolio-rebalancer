import { describe, expect, it } from "vitest";

import { addMoney, formatMoney, money, nonNegativeMoney } from "./money";

describe("Money", () => {
  it("통화별 minor unit을 적용하고 같은 통화만 더한다", () => {
    const usd = addMoney(money("USD", "1.20"), money("USD", "2.30"));
    expect(usd.minor).toBe(350n);
    expect(formatMoney(usd)).toBe("3.50");
    expect(money("KRW", "1200").minor).toBe(1_200n);
  });

  it("운용 금액에는 음수를 허용하지 않고 통화 혼합을 차단한다", () => {
    expect(() => nonNegativeMoney("KRW", "-1")).toThrow("음수");
    expect(() => addMoney(money("KRW", "1"), money("USD", "1.00"))).toThrow("통화");
  });
});
