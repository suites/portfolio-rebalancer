import { describe, expect, it } from "vitest";

import { instrumentValueKrwMinor, krwAmountToMinor, usdAmountToKrwMinor } from "./valuation";

describe("Toss valuation conversion", () => {
  it("USD 평가액을 부동소수점 없이 원 단위로 반올림한다", () => {
    expect(usdAmountToKrwMinor("1785", "1380.5")).toBe(2_464_193n);
  });

  it("KRW 소수 금액을 조용히 버리지 않는다", () => {
    expect(() => krwAmountToMinor("100.5")).toThrow("소수점 0자리");
  });

  it("한국 정수 수량과 최신 가격으로 원화 평가액을 다시 계산한다", () => {
    expect(
      instrumentValueKrwMinor({
        marketCountry: "KR",
        currency: "KRW",
        quantity: "158",
        lastPrice: "18640",
      }),
    ).toBe(2_945_120n);
  });

  it("미국 소수 수량·가격·환율을 한 번만 원 단위 반올림한다", () => {
    expect(
      instrumentValueKrwMinor({
        marketCountry: "US",
        currency: "USD",
        quantity: "1.25",
        lastPrice: "211.11",
        usdKrwRate: "1380.5",
      }),
    ).toBe(364_297n);
  });

  it("시장·통화 불일치, KR 소수 수량과 미국 환율 누락을 차단한다", () => {
    expect(() =>
      instrumentValueKrwMinor({
        marketCountry: "KR",
        currency: "USD",
        quantity: "1",
        lastPrice: "10",
      }),
    ).toThrow("시장·통화");
    expect(() =>
      instrumentValueKrwMinor({
        marketCountry: "KR",
        currency: "KRW",
        quantity: "1.5",
        lastPrice: "1000",
      }),
    ).toThrow("소수점 0자리");
    expect(() =>
      instrumentValueKrwMinor({
        marketCountry: "US",
        currency: "USD",
        quantity: "1",
        lastPrice: "10",
      }),
    ).toThrow("환율");
  });
});
