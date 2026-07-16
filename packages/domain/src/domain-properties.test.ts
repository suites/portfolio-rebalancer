import { describe, expect, it } from "vitest";

import { resolveAutoAllocationBand } from "./allocation-band";
import { calculateRebalanceTargets } from "./rebalance";
import { resolveEqualWithinAssetPoints } from "./within-asset-allocation";

describe("domain invariant properties", () => {
  it("모든 저장 가능한 목표 bp에서 자동 밴드의 순서와 범위를 보존한다", () => {
    for (let target = 0n; target <= 10_000n; target += 1n) {
      const band = resolveAutoAllocationBand(target);
      expect(band.lowerBasisPoints).toBeGreaterThanOrEqual(0n);
      expect(band.lowerBasisPoints).toBeLessThanOrEqual(target);
      expect(band.upperBasisPoints).toBeGreaterThanOrEqual(target);
      expect(band.upperBasisPoints).toBeLessThanOrEqual(10_000n);
    }
  });

  it("구성 종목 수와 무관하게 EQUAL 배분 합계를 정확히 10000점으로 유지한다", () => {
    for (let count = 1; count <= 257; count += 1) {
      const keys = Array.from({ length: count }, (_, index) => `KR:${index}`);
      const resolved = resolveEqualWithinAssetPoints(keys);
      expect(resolved.instruments).toHaveLength(count);
      expect(resolved.instruments.reduce((sum, item) => sum + item.withinAssetPoints, 0n)).toBe(
        10_000n,
      );
    }
  });

  it("다양한 총액에서 TARGET desired value 합계를 원래 총액과 동일하게 유지한다", () => {
    for (let total = 3n; total <= 2_003n; total += 37n) {
      const first = total / 3n;
      const second = total / 3n;
      const third = total - first - second;
      const result = calculateRebalanceTargets(
        [
          {
            id: "SAFE",
            valueMinor: first,
            targetBasisPoints: 3_333n,
            lowerBasisPoints: 0n,
            upperBasisPoints: 10_000n,
          },
          {
            id: "CORE",
            valueMinor: second,
            targetBasisPoints: 3_334n,
            lowerBasisPoints: 0n,
            upperBasisPoints: 10_000n,
          },
          {
            id: "CASH",
            valueMinor: third,
            targetBasisPoints: 3_333n,
            lowerBasisPoints: 0n,
            upperBasisPoints: 10_000n,
          },
        ],
        "TARGET",
      );
      expect(result.decisions.reduce((sum, item) => sum + item.desiredValueMinor, 0n)).toBe(total);
    }
  });
});
