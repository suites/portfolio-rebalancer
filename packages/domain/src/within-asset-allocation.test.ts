import { describe, expect, it } from "vitest";

import { resolvePreserveCurrentWithinAssetPoints } from "./within-asset-allocation";

describe("resolvePreserveCurrentWithinAssetPoints", () => {
  it("현재 평가액 비율을 largest-remainder 방식으로 정확히 10000점에 배분한다", () => {
    expect(
      resolvePreserveCurrentWithinAssetPoints([
        { instrumentKey: "US:AAPL", valueMinor: 936_445n },
        { instrumentKey: "US:BRK.B", valueMinor: 63_555n },
      ]).instruments,
    ).toEqual([
      { instrumentKey: "US:AAPL", withinAssetPoints: 9_364n },
      { instrumentKey: "US:BRK.B", withinAssetPoints: 636n },
    ]);
  });

  it("나머지가 같으면 정규 종목 키 오름차순으로 점수를 배분한다", () => {
    expect(
      resolvePreserveCurrentWithinAssetPoints([
        { instrumentKey: "US:C", valueMinor: 1n },
        { instrumentKey: "US:A", valueMinor: 1n },
        { instrumentKey: "US:B", valueMinor: 1n },
      ]).instruments,
    ).toEqual([
      { instrumentKey: "US:A", withinAssetPoints: 3_334n },
      { instrumentKey: "US:B", withinAssetPoints: 3_333n },
      { instrumentKey: "US:C", withinAssetPoints: 3_333n },
    ]);
  });

  it("일부 0원 종목은 0점으로 유지하고 전체가 0원이면 차단한다", () => {
    expect(
      resolvePreserveCurrentWithinAssetPoints([
        { instrumentKey: "KR:005930", valueMinor: 10n },
        { instrumentKey: "KR:000000", valueMinor: 0n },
      ]).instruments,
    ).toEqual([
      { instrumentKey: "KR:000000", withinAssetPoints: 0n },
      { instrumentKey: "KR:005930", withinAssetPoints: 10_000n },
    ]);
    expect(() =>
      resolvePreserveCurrentWithinAssetPoints([
        { instrumentKey: "KR:000000", valueMinor: 0n },
        { instrumentKey: "KR:000001", valueMinor: 0n },
      ]),
    ).toThrow("현재 평가액 합계가 0");
  });

  it("빈 구성, 중복 키와 음수 평가액을 거부한다", () => {
    expect(() => resolvePreserveCurrentWithinAssetPoints([])).toThrow("구성 종목");
    expect(() =>
      resolvePreserveCurrentWithinAssetPoints([
        { instrumentKey: "US:AAPL", valueMinor: 1n },
        { instrumentKey: "US:AAPL", valueMinor: 2n },
      ]),
    ).toThrow("서로 달라야");
    expect(() =>
      resolvePreserveCurrentWithinAssetPoints([{ instrumentKey: "US:AAPL", valueMinor: -1n }]),
    ).toThrow("음수");
  });
});
