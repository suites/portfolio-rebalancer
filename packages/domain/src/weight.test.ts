import { describe, expect, it } from "vitest";

import { weightFromBasisPoints, weightFromValue } from "./weight";

describe("Weight", () => {
  it("basis point와 평가액 비중을 bigint로 표현한다", () => {
    expect(weightFromBasisPoints(2_500n)).toEqual({ basisPoints: 2_500n });
    expect(weightFromValue(1n, 3n)).toEqual({ basisPoints: 3_333n });
  });

  it("저장 범위를 벗어난 비중을 거부한다", () => {
    expect(() => weightFromBasisPoints(10_001n)).toThrow("10000bp");
    expect(() => weightFromValue(2n, 1n)).toThrow("전체 평가액 이하");
  });
});
