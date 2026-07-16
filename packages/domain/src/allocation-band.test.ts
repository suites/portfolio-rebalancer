import { describe, expect, it } from "vitest";

import { AUTO_BAND_POLICY_VERSION, resolveAutoAllocationBand } from "./allocation-band";

describe("resolveAutoAllocationBand", () => {
  it.each([
    [0n, 0n, 0n, 0n],
    [1n, 1n, 0n, 2n],
    [100n, 25n, 75n, 125n],
    [1_000n, 250n, 750n, 1_250n],
    [1_999n, 500n, 1_499n, 2_499n],
    [2_000n, 500n, 1_500n, 2_500n],
    [9_999n, 500n, 9_499n, 10_000n],
    [10_000n, 500n, 9_500n, 10_000n],
  ])("목표 %sbp에 혼합 정책을 적용한다", (target, drift, expectedLower, expectedUpper) => {
    expect(resolveAutoAllocationBand(target)).toEqual({
      policyVersion: AUTO_BAND_POLICY_VERSION,
      allowedDriftBasisPoints: drift,
      lowerBasisPoints: expectedLower,
      upperBasisPoints: expectedUpper,
    });
  });

  it("저장 범위를 벗어난 목표를 거부한다", () => {
    expect(() => resolveAutoAllocationBand(-1n)).toThrow("0bp");
    expect(() => resolveAutoAllocationBand(10_001n)).toThrow("10000bp");
  });
});
