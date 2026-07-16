import { describe, expect, it } from "vitest";

import { TargetSettingsDraftInputSchema } from "./console";

const validAllocations = [
  {
    assetKey: "US:AAPL",
    targetBasisPoints: 5_500,
  },
  {
    assetKey: "US:BRK.B",
    targetBasisPoints: 3_500,
  },
  {
    assetKey: "CASH",
    targetBasisPoints: 1_000,
  },
];

describe("target settings contract", () => {
  it("10000bp인 고유 자산 목표에 AUTO 밴드 정책을 기본 적용한다", () => {
    const result = TargetSettingsDraftInputSchema.parse({
      cashPolicy: { mode: "FIXED_KRW", amountMinor: "1000000" },
      allocations: validAllocations,
    });

    expect(result.allocations.every(({ bandPolicy }) => bandPolicy.mode === "AUTO")).toBe(true);
  });

  it("합계 오류와 중복 자산을 거부한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "FIXED_KRW", amountMinor: "1000000" },
      allocations: [
        validAllocations[0],
        {
          ...validAllocations[0],
          targetBasisPoints: 3_000,
        },
      ],
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("한 번씩"),
          expect.stringContaining("10000bp"),
        ]),
      );
    }
  });

  it("고급 CUSTOM 밴드는 하한, 목표, 상한 순서를 검증한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "EXCLUDED" },
      allocations: [
        {
          assetKey: "CASH",
          targetBasisPoints: 10_000,
          bandPolicy: {
            mode: "CUSTOM",
            lowerBasisPoints: 9_000,
            upperBasisPoints: 8_000,
          },
        },
      ],
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toContain(
        "허용 범위는 하한, 목표, 상한 순서여야 합니다.",
      );
    }
  });

  it("현금 제외 정책은 CASH 목표 0%만 허용한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "EXCLUDED" },
      allocations: validAllocations,
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toContain(
        "현금을 제외할 때 CASH 목표 비중은 0%여야 합니다.",
      );
    }
  });
});
