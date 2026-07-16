import { describe, expect, it } from "vitest";

import { TargetSettingsDraftInputSchema, TargetSettingsVersionSchema } from "./console";

const validAllocations = [
  {
    assetKey: "SAFE" as const,
    targetBasisPoints: 0,
    instrumentKeys: [],
  },
  {
    assetKey: "CORE" as const,
    targetBasisPoints: 0,
    instrumentKeys: [],
  },
  {
    assetKey: "SATELLITE" as const,
    targetBasisPoints: 9_000,
    instrumentKeys: ["US:AAPL", "US:BRK.B"],
  },
  {
    assetKey: "CASH" as const,
    targetBasisPoints: 1_000,
    instrumentKeys: [],
  },
];

describe("target settings contract", () => {
  it("네 자산군의 10000bp 목표에 AUTO 밴드 정책을 기본 적용한다", () => {
    const result = TargetSettingsDraftInputSchema.parse({
      cashPolicy: { mode: "FIXED_KRW", amountMinor: "1000000" },
      allocations: validAllocations,
    });

    expect(result.allocations.map(({ assetKey }) => assetKey)).toEqual([
      "SAFE",
      "CORE",
      "SATELLITE",
      "CASH",
    ]);
    expect(result.allocations.every(({ bandPolicy }) => bandPolicy.mode === "AUTO")).toBe(true);
  });

  it("필수 자산군 누락, 합계 오류와 중복 자산군을 거부한다", () => {
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
          expect.stringContaining("정확히 한 번씩"),
          expect.stringContaining("10000bp"),
        ]),
      );
    }
  });

  it("같은 종목의 복수 자산군 배정과 종목 없는 양수 목표를 거부한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "EXCLUDED" },
      allocations: [
        {
          assetKey: "SAFE",
          targetBasisPoints: 5_000,
          instrumentKeys: ["US:AAPL"],
        },
        {
          assetKey: "CORE",
          targetBasisPoints: 5_000,
          instrumentKeys: ["US:AAPL"],
        },
        {
          assetKey: "SATELLITE",
          targetBasisPoints: 0,
          instrumentKeys: [],
        },
        {
          assetKey: "CASH",
          targetBasisPoints: 0,
          instrumentKeys: [],
        },
      ],
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toContain(
        "같은 종목을 여러 자산군에 포함할 수 없습니다.",
      );
    }
  });

  it("종목 없는 비현금 자산군에는 0%보다 큰 목표를 허용하지 않는다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "EXCLUDED" },
      allocations: [
        { assetKey: "SAFE", targetBasisPoints: 5_000, instrumentKeys: [] },
        {
          assetKey: "CORE",
          targetBasisPoints: 5_000,
          instrumentKeys: ["US:AAPL"],
        },
        { assetKey: "SATELLITE", targetBasisPoints: 0, instrumentKeys: [] },
        { assetKey: "CASH", targetBasisPoints: 0, instrumentKeys: [] },
      ],
    });

    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.issues.map(({ message }) => message)).toContain(
        "목표가 0%보다 큰 자산군에는 종목이 하나 이상 필요합니다.",
      );
    }
  });

  it("고급 CUSTOM 밴드는 하한, 목표, 상한 순서를 검증한다", () => {
    const invalid = TargetSettingsDraftInputSchema.safeParse({
      cashPolicy: { mode: "EXCLUDED" },
      allocations: validAllocations.map((allocation) =>
        allocation.assetKey === "CASH"
          ? {
              ...allocation,
              targetBasisPoints: 0,
              bandPolicy: {
                mode: "CUSTOM" as const,
                lowerBasisPoints: 9_000,
                upperBasisPoints: 8_000,
              },
            }
          : allocation.assetKey === "SATELLITE"
            ? { ...allocation, targetBasisPoints: 10_000 }
            : allocation,
      ),
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

  it("이전 개별 종목 설정 버전도 읽을 수 있다", () => {
    expect(
      TargetSettingsVersionSchema.safeParse({
        version: 1,
        status: "ACTIVE",
        createdAt: "2026-07-16T03:00:00.000Z",
        cashPolicy: { mode: "UNSET", version: "LEGACY_V1" },
        allocations: [
          {
            assetKey: "US:AAPL",
            label: "Apple",
            targetBasisPoints: 10_000,
            lowerBasisPoints: 9_500,
            upperBasisPoints: 10_000,
            bandPolicy: {
              mode: "CUSTOM",
              version: "LEGACY_V1",
              lowerBasisPoints: 9_500,
              upperBasisPoints: 10_000,
            },
            compositionPolicy: { mode: "LEGACY_SINGLE", version: "LEGACY_V1" },
            instruments: [
              {
                instrumentKey: "US:AAPL",
                validationId: null,
                marketCountry: "US",
                listingMarket: "NASDAQ",
                symbol: "AAPL",
                name: "Apple",
                englishName: null,
                currency: "USD",
                withinAssetPoints: 10_000,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
