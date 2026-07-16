import { describe, expect, it } from "vitest";

import { krwAmountToMinor, usdAmountToKrwMinor } from "./valuation";

describe("Toss valuation conversion", () => {
  it("USD 평가액을 부동소수점 없이 원 단위로 반올림한다", () => {
    expect(usdAmountToKrwMinor("1785", "1380.5")).toBe(2_464_193n);
  });

  it("KRW 소수 금액을 조용히 버리지 않는다", () => {
    expect(() => krwAmountToMinor("100.5")).toThrow("소수점 0자리");
  });
});
