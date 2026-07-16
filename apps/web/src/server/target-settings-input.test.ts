import { describe, expect, it } from "vitest";

import { percentToBasisPoints, targetSettingsInputFromFormData } from "./target-settings-input";

describe("target settings form parser", () => {
  it("문자열 백분율을 부동소수점 없이 bp로 변환한다", () => {
    expect(percentToBasisPoints("33.33")).toBe(3_333);
    expect(percentToBasisPoints("100")).toBe(10_000);
    expect(() => percentToBasisPoints("10.001")).toThrow("소수점 둘째");
  });

  it("반복 필드를 검증된 목표 설정 계약으로 만든다", () => {
    const formData = new FormData();
    formData.append("assetKey", "US:AAPL");
    formData.append("targetPercent", "60");
    formData.append("assetKey", "US:BRK.B");
    formData.append("targetPercent", "40");

    expect(targetSettingsInputFromFormData(formData).allocations).toEqual([
      {
        assetKey: "US:AAPL",
        targetBasisPoints: 6_000,
        bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
      },
      {
        assetKey: "US:BRK.B",
        targetBasisPoints: 4_000,
        bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
      },
    ]);
  });
});
