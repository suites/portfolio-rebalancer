import { describe, expect, it } from "vitest";

import { TargetSettingsDraftInputSchema } from "./console";

const validAllocations = [
  {
    assetKey: "NASDAQ:AAPL",
    targetBasisPoints: 6_000,
    lowerBasisPoints: 5_500,
    upperBasisPoints: 6_500,
  },
  {
    assetKey: "NYSE:BRK.B",
    targetBasisPoints: 4_000,
    lowerBasisPoints: 3_500,
    upperBasisPoints: 4_500,
  },
];

describe("target settings contract", () => {
  it("10000bp인 고유 자산 목표와 밴드를 허용한다", () => {
    expect(
      TargetSettingsDraftInputSchema.safeParse({ allocations: validAllocations }).success,
    ).toBe(true);
  });

  it("합계 오류, 중복 자산과 뒤집힌 밴드를 거부한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      allocations: [
        validAllocations[0],
        {
          ...validAllocations[0],
          targetBasisPoints: 3_000,
          lowerBasisPoints: 3_500,
          upperBasisPoints: 2_500,
        },
      ],
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("한 번씩"),
          expect.stringContaining("10000bp"),
          expect.stringContaining("하한"),
        ]),
      );
    }
  });
});
