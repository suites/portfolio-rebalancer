import { describe, expect, it } from "vitest";

import { assertIntegerQuantity, formatQuantity, integerQuantity, quantity } from "./quantity";

describe("Quantity", () => {
  it("수량을 부동소수점 없이 atoms와 자릿수로 보존한다", () => {
    const value = quantity("1.250000", 6);
    expect(value).toEqual({ atoms: 1_250_000n, fractionDigits: 6 });
    expect(formatQuantity(value)).toBe("1.250000");
  });

  it("한국 정수 수량과 음수 수량을 구분한다", () => {
    expect(() => assertIntegerQuantity(integerQuantity("3"))).not.toThrow();
    expect(() => assertIntegerQuantity(quantity("3.5", 1))).toThrow("정수");
    expect(() => quantity("-1", 0)).toThrow("음수");
  });
});
