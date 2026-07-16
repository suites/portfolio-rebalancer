import { describe, expect, it } from "vitest";

import {
  percentToBasisPoints,
  targetSettingsInputFromFormData,
  wonToMinor,
} from "./target-settings-input";

describe("target settings form parser", () => {
  it("문자열 백분율을 부동소수점 없이 bp로 변환한다", () => {
    expect(percentToBasisPoints("33.33")).toBe(3_333);
    expect(percentToBasisPoints("100")).toBe(10_000);
    expect(() => percentToBasisPoints("10.001")).toThrow("소수점 둘째");
  });

  it("반복 필드를 검증된 목표 설정 계약으로 만든다", () => {
    const formData = new FormData();
    formData.append("cashMode", "FIXED_KRW");
    formData.append("managedCashWon", "1000000");
    formData.append("assetKey", "US:AAPL");
    formData.append("targetPercent", "55");
    formData.append("assetKey", "US:BRK.B");
    formData.append("targetPercent", "35");
    formData.append("assetKey", "CASH");
    formData.append("targetPercent", "10");

    expect(targetSettingsInputFromFormData(formData)).toEqual({
      cashPolicy: {
        mode: "FIXED_KRW",
        version: "CASH_V1",
        amountMinor: "1000000",
      },
      allocations: [
        {
          assetKey: "US:AAPL",
          targetBasisPoints: 5_500,
          bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
        },
        {
          assetKey: "US:BRK.B",
          targetBasisPoints: 3_500,
          bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
        },
        {
          assetKey: "CASH",
          targetBasisPoints: 1_000,
          bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
        },
      ],
    });
  });

  it("현금을 제외할 때는 금액 입력 없이 CASH 목표 0%를 허용한다", () => {
    const formData = new FormData();
    formData.append("cashMode", "EXCLUDED");
    formData.append("assetKey", "US:AAPL");
    formData.append("targetPercent", "100");
    formData.append("assetKey", "CASH");
    formData.append("targetPercent", "0");

    expect(targetSettingsInputFromFormData(formData).cashPolicy).toEqual({
      mode: "EXCLUDED",
      version: "CASH_V1",
    });
  });

  it("관리 현금은 선행 0 없는 PostgreSQL bigint 범위의 원 단위 정수만 허용한다", () => {
    expect(wonToMinor("0")).toBe("0");
    expect(wonToMinor("1000000")).toBe("1000000");
    expect(() => wonToMinor("01")).toThrow("정수");
    expect(() => wonToMinor("9223372036854775808")).toThrow("범위");
  });
});
