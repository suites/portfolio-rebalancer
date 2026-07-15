import { describe, expect, it } from "vitest";

import { decimal, fromScaledInteger, toScaledInteger } from "./decimal";

describe("decimal", () => {
  it("부동소수점 없이 decimal 문자열을 정수 스케일로 변환한다", () => {
    expect(toScaledInteger(decimal("123.45"), 2)).toBe(12_345n);
    expect(fromScaledInteger(12_345n, 2)).toBe("123.45");
  });

  it("허용 정밀도를 넘는 값을 거부한다", () => {
    expect(() => toScaledInteger(decimal("1.001"), 2)).toThrow("소수점 2자리를 초과");
  });

  it("지수 표기와 비정상 입력을 거부한다", () => {
    expect(() => decimal("1e3")).toThrow("올바르지 않은 decimal");
    expect(() => decimal("01.2")).toThrow("올바르지 않은 decimal");
  });
});
