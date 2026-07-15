import { describe, expect, it } from "vitest";

import { calculateAllocationSnapshot, isOutsideAllocationBand } from "./allocation";

describe("calculateAllocationSnapshot", () => {
  it("평가액으로 현재 비중과 이탈을 결정론적으로 계산한다", () => {
    const result = calculateAllocationSnapshot([
      { id: "core", valueMinor: 6_800_000n, targetBasisPoints: 7_500n },
      { id: "satellite", valueMinor: 2_200_000n, targetBasisPoints: 1_500n },
      { id: "cash", valueMinor: 1_000_000n, targetBasisPoints: 1_000n },
    ]);

    expect(result.totalValueMinor).toBe(10_000_000n);
    expect(result.allocations.map(({ currentBasisPoints }) => currentBasisPoints)).toEqual([
      6_800n,
      2_200n,
      1_000n,
    ]);
    expect(result.allocations.map(({ driftBasisPoints }) => driftBasisPoints)).toEqual([
      -700n,
      700n,
      0n,
    ]);
  });

  it("목표 비중 합계가 100%가 아니면 차단한다", () => {
    expect(() =>
      calculateAllocationSnapshot([{ id: "core", valueMinor: 1n, targetBasisPoints: 9_999n }]),
    ).toThrow("10000bp가 아닙니다");
  });

  it("중복되거나 비어 있는 자산 ID를 차단한다", () => {
    expect(() =>
      calculateAllocationSnapshot([
        { id: "core", valueMinor: 7n, targetBasisPoints: 7_000n },
        { id: "core", valueMinor: 3n, targetBasisPoints: 3_000n },
      ]),
    ).toThrow("자산 ID");
    expect(() =>
      calculateAllocationSnapshot([{ id: " ", valueMinor: 1n, targetBasisPoints: 10_000n }]),
    ).toThrow("자산 ID");
  });
});

describe("isOutsideAllocationBand", () => {
  it("표시용 bp로 내림하지 않고 1bp 미만의 상한 이탈을 감지한다", () => {
    expect(
      isOutsideAllocationBand({
        valueMinor: 800_009n,
        totalValueMinor: 1_000_000n,
        lowerBasisPoints: 7_000n,
        upperBasisPoints: 8_000n,
      }),
    ).toBe(true);
    expect(
      isOutsideAllocationBand({
        valueMinor: 800_000n,
        totalValueMinor: 1_000_000n,
        lowerBasisPoints: 7_000n,
        upperBasisPoints: 8_000n,
      }),
    ).toBe(false);
  });

  it("표시용 bp로 내림하면 놓칠 수 있는 하한 이탈도 감지한다", () => {
    expect(
      isOutsideAllocationBand({
        valueMinor: 699_999n,
        totalValueMinor: 1_000_000n,
        lowerBasisPoints: 7_000n,
        upperBasisPoints: 8_000n,
      }),
    ).toBe(true);
  });
});
