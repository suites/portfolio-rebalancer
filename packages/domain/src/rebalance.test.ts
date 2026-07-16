import { describe, expect, it } from "vitest";

import {
  allocateSpendableCash,
  calculateRebalanceTargets,
  projectAllocationAfterRoundedTrades,
  roundKrOrder,
} from "./rebalance";

describe("calculateRebalanceTargets", () => {
  const assets = [
    {
      id: "SAFE",
      valueMinor: 200n,
      targetBasisPoints: 3_000n,
      lowerBasisPoints: 2_501n,
      upperBasisPoints: 3_500n,
    },
    {
      id: "CORE",
      valueMinor: 700n,
      targetBasisPoints: 6_000n,
      lowerBasisPoints: 5_500n,
      upperBasisPoints: 6_666n,
    },
    {
      id: "CASH",
      valueMinor: 100n,
      targetBasisPoints: 1_000n,
      lowerBasisPoints: 500n,
      upperBasisPoints: 1_500n,
    },
  ] as const;

  it("BAND_EDGE는 하한에 올림, 상한에 내림하고 범위 안 자산은 유지한다", () => {
    const result = calculateRebalanceTargets(assets, "BAND_EDGE");

    expect(result.decisions).toEqual([
      expect.objectContaining({
        id: "SAFE",
        reason: "BELOW_LOWER",
        desiredValueMinor: 251n,
        deltaMinor: 51n,
      }),
      expect.objectContaining({
        id: "CORE",
        reason: "ABOVE_UPPER",
        desiredValueMinor: 666n,
        deltaMinor: -34n,
      }),
      expect.objectContaining({
        id: "CASH",
        reason: "IN_RANGE",
        desiredValueMinor: 100n,
        deltaMinor: 0n,
      }),
    ]);
  });

  it("TARGET은 largest-remainder로 총액을 정확히 보존한다", () => {
    const result = calculateRebalanceTargets(
      [
        {
          id: "B",
          valueMinor: 1n,
          targetBasisPoints: 3_333n,
          lowerBasisPoints: 0n,
          upperBasisPoints: 10_000n,
        },
        {
          id: "A",
          valueMinor: 1n,
          targetBasisPoints: 3_334n,
          lowerBasisPoints: 0n,
          upperBasisPoints: 10_000n,
        },
        {
          id: "C",
          valueMinor: 1n,
          targetBasisPoints: 3_333n,
          lowerBasisPoints: 0n,
          upperBasisPoints: 10_000n,
        },
      ],
      "TARGET",
    );

    expect(result.decisions.map(({ id, desiredValueMinor }) => [id, desiredValueMinor])).toEqual([
      ["B", 1n],
      ["A", 1n],
      ["C", 1n],
    ]);
    expect(result.decisions.reduce((sum, item) => sum + item.desiredValueMinor, 0n)).toBe(3n);
  });

  it("목표 합과 밴드 순서가 잘못되면 차단한다", () => {
    expect(() =>
      calculateRebalanceTargets(
        [
          {
            id: "CORE",
            valueMinor: 1n,
            targetBasisPoints: 9_999n,
            lowerBasisPoints: 10_000n,
            upperBasisPoints: 10_000n,
          },
        ],
        "TARGET",
      ),
    ).toThrow("올바르지 않습니다");
  });
});

describe("allocateSpendableCash", () => {
  it("부족 금액이 큰 자산부터 신규 현금을 배분하고 원래 입력 순서로 결과를 돌려준다", () => {
    expect(
      allocateSpendableCash(
        [
          { id: "SATELLITE", requestedMinor: 20n },
          { id: "CORE", requestedMinor: 80n },
          { id: "SAFE", requestedMinor: 80n },
        ],
        100n,
      ),
    ).toEqual({
      spendableCashMinor: 100n,
      allocatedMinor: 100n,
      remainingCashMinor: 0n,
      allocations: [
        {
          id: "SATELLITE",
          requestedMinor: 20n,
          allocatedMinor: 0n,
          remainingNeedMinor: 20n,
        },
        {
          id: "CORE",
          requestedMinor: 80n,
          allocatedMinor: 80n,
          remainingNeedMinor: 0n,
        },
        {
          id: "SAFE",
          requestedMinor: 80n,
          allocatedMinor: 20n,
          remainingNeedMinor: 60n,
        },
      ],
    });
  });
});

describe("roundKrOrder", () => {
  it("매수 금액을 정수 주식 수량으로 내림해 과소비하지 않는다", () => {
    expect(
      roundKrOrder({
        id: "KR:005930",
        side: "BUY",
        desiredNotionalMinor: 205_000n,
        priceMinor: 72_000n,
        minimumOrderMinor: 10_000n,
      }),
    ).toEqual({
      id: "KR:005930",
      side: "BUY",
      status: "ORDERABLE",
      quantity: 2n,
      notionalMinor: 144_000n,
      unallocatedMinor: 61_000n,
    });
  });

  it("0주 또는 최소 주문금액 미만 후보는 주문 없이 편차로 남긴다", () => {
    expect(
      roundKrOrder({
        id: "KR:000001",
        side: "BUY",
        desiredNotionalMinor: 9_999n,
        priceMinor: 10_000n,
        minimumOrderMinor: 5_000n,
      }).status,
    ).toBe("ZERO_QUANTITY");
    expect(
      roundKrOrder({
        id: "KR:000002",
        side: "SELL",
        desiredNotionalMinor: 9_000n,
        priceMinor: 3_000n,
        minimumOrderMinor: 10_000n,
        availableQuantity: 3n,
      }).status,
    ).toBe("BELOW_MINIMUM");
  });

  it("계산 수량이 매도 가능 수량을 넘으면 fail closed 한다", () => {
    expect(() =>
      roundKrOrder({
        id: "KR:005930",
        side: "SELL",
        desiredNotionalMinor: 300_000n,
        priceMinor: 100_000n,
        minimumOrderMinor: 10_000n,
        availableQuantity: 2n,
      }),
    ).toThrow("매도 가능 수량");
  });
});

describe("projectAllocationAfterRoundedTrades", () => {
  it("반올림된 거래 후 예상 비중을 다시 계산하고 1bp 미만 밴드 이탈도 보존한다", () => {
    const result = projectAllocationAfterRoundedTrades([
      {
        id: "CORE",
        valueMinor: 800_000n,
        deltaMinor: 9n,
        targetBasisPoints: 8_000n,
        lowerBasisPoints: 7_000n,
        upperBasisPoints: 8_000n,
      },
      {
        id: "CASH",
        valueMinor: 200_000n,
        deltaMinor: -9n,
        targetBasisPoints: 2_000n,
        lowerBasisPoints: 2_000n,
        upperBasisPoints: 3_000n,
      },
    ]);

    expect(result.totalValueMinor).toBe(1_000_000n);
    expect(result.allocations.find(({ id }) => id === "CORE")?.outsideBand).toBe(true);
  });
});
