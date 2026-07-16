import { describe, expect, it } from "vitest";

import {
  createShadowRebalancePlan,
  type CreateShadowPlanInput,
  type ShadowPlanAssetClassInput,
  type ShadowPlanInstrumentInput,
} from "./shadow-plan";

const identity = {
  pinnedSnapshotId: "snapshot-1",
  currentSnapshotId: "snapshot-1",
  pinnedSnapshotDigest: "digest-1",
  currentSnapshotDigest: "digest-1",
  pinnedConfigVersionId: "config-1",
  currentConfigVersionId: "config-1",
} as const;

const orderPrerequisites = {
  orderType: "LIMIT",
  timeInForce: "DAY",
  wholeSharesOnly: true,
} as const;

function instrument(
  symbol: string,
  currentValueMinor: bigint,
  priceMinor: bigint | null,
  overrides: Partial<ShadowPlanInstrumentInput> = {},
): ShadowPlanInstrumentInput {
  return {
    marketCountry: "KR",
    currency: "KRW",
    symbol,
    currentValueMinor,
    targetWithinAssetPoints: 10_000n,
    currentQuantity: priceMinor === null ? 0n : currentValueMinor / priceMinor,
    priceMinor,
    availableSellQuantity: priceMinor === null ? null : currentValueMinor / priceMinor,
    ...overrides,
  };
}

function securitiesAsset(
  id: string,
  currentValueMinor: bigint,
  targetBasisPoints: bigint,
  lowerBasisPoints: bigint,
  upperBasisPoints: bigint,
  instruments: readonly ShadowPlanInstrumentInput[],
): ShadowPlanAssetClassInput {
  return {
    id,
    kind: "SECURITIES",
    currentValueMinor,
    targetBasisPoints,
    lowerBasisPoints,
    upperBasisPoints,
    instruments,
  };
}

function cashAsset(
  currentValueMinor: bigint,
  targetBasisPoints: bigint,
  lowerBasisPoints: bigint,
  upperBasisPoints: bigint,
): ShadowPlanAssetClassInput {
  return {
    id: "CASH",
    kind: "CASH",
    currentValueMinor,
    targetBasisPoints,
    lowerBasisPoints,
    upperBasisPoints,
    instruments: [],
  };
}

function planInput(
  assetClasses: readonly ShadowPlanAssetClassInput[],
  managedCashMinor: bigint,
  spendableCashMinor: bigint,
  overrides: Partial<CreateShadowPlanInput> = {},
): CreateShadowPlanInput {
  return {
    identity,
    assetClasses,
    managedCashMinor,
    spendableCashMinor,
    returnPolicy: "BAND_EDGE",
    minimumOrderMinor: 10_000n,
    orderPrerequisites,
    ...overrides,
  };
}

function sellFirstInput(): CreateShadowPlanInput {
  return planInput(
    [
      securitiesAsset("CORE", 700_000n, 5_000n, 4_500n, 5_500n, [
        instrument("005930", 700_000n, 50_000n),
      ]),
      securitiesAsset("SAFE", 200_000n, 4_000n, 3_500n, 4_500n, [
        instrument("114800", 200_000n, 50_000n),
      ]),
      cashAsset(100_000n, 1_000n, 500n, 1_500n),
    ],
    100_000n,
    100_000n,
  );
}

describe("createShadowRebalancePlan", () => {
  it("모든 자산과 내부 종목 비중이 범위 안이면 NO_ACTION을 재현한다", () => {
    const result = createShadowRebalancePlan(
      planInput(
        [
          securitiesAsset("CORE", 500_000n, 5_000n, 4_500n, 5_500n, [
            instrument("005930", 500_000n, 10_000n),
          ]),
          securitiesAsset("SAFE", 400_000n, 4_000n, 3_500n, 4_500n, [
            instrument("114800", 400_000n, 10_000n),
          ]),
          cashAsset(100_000n, 1_000n, 500n, 1_500n),
        ],
        100_000n,
        0n,
      ),
    );

    expect(result.reasonCodes).toEqual(["NO_REBALANCE_NEEDED"]);
    expect(result.status).toBe("NO_ACTION");
    expect(result.executableOrders).toEqual([]);
    expect(result.deferredBuyNeeds).toEqual([]);
    expect(result.projectedAllocations.map(({ id, valueMinor }) => [id, valueMinor])).toEqual([
      ["CASH", 100_000n],
      ["CORE", 500_000n],
      ["SAFE", 400_000n],
    ]);
    expect(result.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("현금만 범위를 벗어나 대응 종목 주문이 없으면 재조정 필요를 NO_ACTION 사유로 남긴다", () => {
    const result = createShadowRebalancePlan(
      planInput(
        [
          securitiesAsset("SAFE", 70n, 8_000n, 6_500n, 9_000n, [instrument("114800", 70n, 10n)]),
          cashAsset(30n, 2_000n, 1_500n, 2_500n),
        ],
        30n,
        5n,
        { minimumOrderMinor: 1n },
      ),
    );

    expect(result.status).toBe("NO_ACTION");
    expect(result.reasonCodes).toEqual(["REBALANCE_NEEDS_NO_ORDER_CANDIDATE"]);
    expect(result.assetDecisions.find(({ id }) => id === "CASH")?.reason).toBe("ABOVE_UPPER");
  });

  it("매도 필요가 하나라도 있으면 매도만 Phase A 주문으로 만들고 매수는 재계산 대기로 둔다", () => {
    const result = createShadowRebalancePlan(sellFirstInput());

    expect(result.status).toBe("PLANNED");
    expect(result.reasonCodes).toEqual(["SELL_PHASE_READY", "BUY_PHASE_DEFERRED"]);
    expect(result.executableOrders).toEqual([
      expect.objectContaining({
        phase: "SELL",
        symbol: "005930",
        side: "SELL",
        quantity: 3n,
        notionalMinor: 150_000n,
      }),
    ]);
    expect(result.executableOrders.some(({ side }) => side === "BUY")).toBe(false);
    expect(result.deferredBuyNeeds).toEqual([
      expect.objectContaining({
        symbol: "114800",
        desiredNotionalMinor: 150_000n,
        fundedMinor: 0n,
        executableNotionalMinor: 0n,
        reasonCodes: ["SELL_PHASE_MUST_RECONCILE"],
      }),
    ]);
  });

  it("매도가 없으면 자산 부족액 순서로 spendable cash만 배분해 매수한다", () => {
    const result = createShadowRebalancePlan(
      planInput(
        [
          securitiesAsset("CORE", 600_000n, 5_000n, 4_500n, 6_500n, [
            instrument("005930", 600_000n, 10_000n),
          ]),
          securitiesAsset("SAFE", 200_000n, 4_000n, 3_500n, 4_500n, [
            instrument("114800", 200_000n, 10_000n),
          ]),
          cashAsset(200_000n, 1_000n, 0n, 2_500n),
        ],
        200_000n,
        90_000n,
      ),
    );

    expect(result.status).toBe("PLANNED");
    expect(result.reasonCodes).toEqual(["BUY_PHASE_READY", "BUY_NEEDS_REMAIN"]);
    expect(result.executableOrders).toEqual([
      expect.objectContaining({
        phase: "BUY",
        symbol: "114800",
        quantity: 9n,
        notionalMinor: 90_000n,
      }),
    ]);
    expect(result.deferredBuyNeeds).toEqual([
      expect.objectContaining({
        desiredNotionalMinor: 150_000n,
        fundedMinor: 90_000n,
        executableNotionalMinor: 90_000n,
        remainingNeedMinor: 60_000n,
        reasonCodes: ["INSUFFICIENT_SPENDABLE_CASH"],
      }),
    ]);
  });

  it("한국 정수 수량 내림과 최소 주문금액을 적용하고 남은 편차를 보존한다", () => {
    const input = planInput(
      [
        securitiesAsset("SAFE", 48_000n, 7_300n, 7_300n, 8_000n, [
          instrument("114800", 48_000n, 12_000n),
        ]),
        cashAsset(52_000n, 2_700n, 0n, 10_000n),
      ],
      52_000n,
      25_000n,
      { minimumOrderMinor: 20_000n },
    );

    const rounded = createShadowRebalancePlan(input);
    expect(rounded.executableOrders).toEqual([
      expect.objectContaining({ quantity: 2n, notionalMinor: 24_000n, unallocatedMinor: 1_000n }),
    ]);
    expect(rounded.deferredBuyNeeds[0]).toEqual(
      expect.objectContaining({
        remainingNeedMinor: 1_000n,
        reasonCodes: ["BUY_ROUNDING_REMAINDER"],
      }),
    );

    const belowMinimum = createShadowRebalancePlan({ ...input, minimumOrderMinor: 30_000n });
    expect(belowMinimum.status).toBe("NO_ACTION");
    expect(belowMinimum.reasonCodes).toEqual(["NO_EXECUTABLE_ORDER_AFTER_ROUNDING"]);
    expect(belowMinimum.deferredBuyNeeds[0]?.reasonCodes).toEqual(["BUY_BELOW_MINIMUM"]);
  });

  it("거래 가격이나 매도 가능 수량이 없으면 fail closed 한다", () => {
    const missingPrice = sellFirstInput();
    const core = missingPrice.assetClasses.find(({ id }) => id === "CORE");
    expect(core?.kind).toBe("SECURITIES");
    const withoutPrice = createShadowRebalancePlan({
      ...missingPrice,
      assetClasses: missingPrice.assetClasses.map((asset) =>
        asset.id === "CORE"
          ? {
              ...asset,
              instruments: asset.instruments.map((item) => ({ ...item, priceMinor: null })),
            }
          : asset,
      ),
    });
    expect(withoutPrice.status).toBe("BLOCKED");
    expect(withoutPrice.reasonCodes).toEqual(["PRICE_MISSING_OR_INVALID"]);

    const withoutSellable = createShadowRebalancePlan({
      ...missingPrice,
      assetClasses: missingPrice.assetClasses.map((asset) =>
        asset.id === "CORE"
          ? {
              ...asset,
              instruments: asset.instruments.map((item) => ({
                ...item,
                availableSellQuantity: null,
              })),
            }
          : asset,
      ),
    });
    expect(withoutSellable.status).toBe("BLOCKED");
    expect(withoutSellable.reasonCodes).toEqual(["SELLABLE_QUANTITY_MISSING"]);
  });

  it("현재 평가액이 고정 수량과 가격의 곱과 다르면 계획을 만들지 않는다", () => {
    const input = sellFirstInput();
    const result = createShadowRebalancePlan({
      ...input,
      assetClasses: input.assetClasses.map((asset) =>
        asset.id === "CORE"
          ? {
              ...asset,
              currentValueMinor: asset.currentValueMinor + 1n,
              instruments: asset.instruments.map((item) => ({
                ...item,
                currentValueMinor: item.currentValueMinor + 1n,
              })),
            }
          : asset,
      ),
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toEqual(["INSTRUMENT_VALUE_MISMATCH"]);
  });

  it("자산군과 종목 입력 순서가 달라도 같은 canonical 계획과 hash를 만든다", () => {
    const input = planInput(
      [
        securitiesAsset("CORE", 700_000n, 5_000n, 4_500n, 5_500n, [
          instrument("000002", 350_000n, 50_000n, { targetWithinAssetPoints: 5_000n }),
          instrument("000001", 350_000n, 50_000n, { targetWithinAssetPoints: 5_000n }),
        ]),
        securitiesAsset("SAFE", 200_000n, 4_000n, 3_500n, 4_500n, [
          instrument("114800", 200_000n, 50_000n),
        ]),
        cashAsset(100_000n, 1_000n, 500n, 1_500n),
      ],
      100_000n,
      100_000n,
    );
    const permuted = {
      ...input,
      assetClasses: [...input.assetClasses]
        .reverse()
        .map((asset) => ({ ...asset, instruments: [...asset.instruments].reverse() })),
    };

    const first = createShadowRebalancePlan(input);
    const second = createShadowRebalancePlan(permuted);
    expect(second.canonicalContent).toBe(first.canonicalContent);
    expect(second.planHash).toBe(first.planHash);
    expect(second.assetDecisions).toEqual(first.assetDecisions);
  });

  it("자산군 내부 목표 금액의 largest-remainder 동률은 종목 키로 결정한다", () => {
    const result = createShadowRebalancePlan(
      planInput(
        [
          securitiesAsset("SAFE", 1n, 100n, 100n, 100n, [
            instrument("000002", 1n, 1n, { targetWithinAssetPoints: 5_000n }),
            instrument("000001", 0n, 1n, { targetWithinAssetPoints: 5_000n }),
          ]),
          cashAsset(99n, 9_900n, 9_900n, 9_900n),
        ],
        99n,
        0n,
        { minimumOrderMinor: 1n },
      ),
    );
    const safe = result.assetDecisions.find(({ id }) => id === "SAFE");

    expect(
      safe?.instruments.map(({ instrumentKey, desiredValueMinor }) => [
        instrumentKey,
        desiredValueMinor,
      ]),
    ).toEqual([
      ["KR:000001", 1n],
      ["KR:000002", 0n],
    ]);
    expect(result.executableOrders[0]).toEqual(
      expect.objectContaining({ side: "SELL", symbol: "000002", quantity: 1n }),
    );
    expect(result.deferredBuyNeeds[0]).toEqual(
      expect.objectContaining({ symbol: "000001", desiredNotionalMinor: 1n }),
    );
  });

  it("반올림된 매수·매도만 반영하고 현금 반대분개로 예상 총액을 보존한다", () => {
    const sellProjection = createShadowRebalancePlan(sellFirstInput());
    expect(
      sellProjection.projectedAllocations.map(({ id, valueMinor }) => [id, valueMinor]),
    ).toEqual([
      ["CASH", 250_000n],
      ["CORE", 550_000n],
      ["SAFE", 200_000n],
    ]);
    expect(
      sellProjection.projectedAllocations.reduce(
        (sum, allocation) => sum + allocation.valueMinor,
        0n,
      ),
    ).toBe(1_000_000n);
  });

  it.each([
    [
      "고정 identity 누락",
      (input: CreateShadowPlanInput) => ({
        ...input,
        identity: { ...input.identity, pinnedSnapshotDigest: null },
      }),
      "IDENTITY_MISSING",
    ],
    [
      "고정 identity 변경",
      (input: CreateShadowPlanInput) => ({
        ...input,
        identity: { ...input.identity, currentSnapshotId: "snapshot-2" },
      }),
      "IDENTITY_MISMATCH",
    ],
    [
      "관리 현금 미설정",
      (input: CreateShadowPlanInput) => ({ ...input, managedCashMinor: null }),
      "MANAGED_CASH_UNSET",
    ],
    [
      "미국 시장",
      (input: CreateShadowPlanInput) => ({
        ...input,
        assetClasses: input.assetClasses.map((asset) =>
          asset.id === "CORE"
            ? {
                ...asset,
                instruments: asset.instruments.map((item) => ({
                  ...item,
                  marketCountry: "US",
                  currency: "USD",
                })),
              }
            : asset,
        ),
      }),
      "UNSUPPORTED_MARKET",
    ],
    [
      "원화 외 통화",
      (input: CreateShadowPlanInput) => ({
        ...input,
        assetClasses: input.assetClasses.map((asset) =>
          asset.id === "CORE"
            ? {
                ...asset,
                instruments: asset.instruments.map((item) => ({ ...item, currency: "USD" })),
              }
            : asset,
        ),
      }),
      "UNSUPPORTED_CURRENCY",
    ],
    [
      "시장가 전제",
      (input: CreateShadowPlanInput) => ({
        ...input,
        orderPrerequisites: { ...input.orderPrerequisites, orderType: "MARKET" },
      }),
      "UNSUPPORTED_ORDER_PREREQUISITE",
    ],
  ] as const)("%s은 BLOCKED로 고정한다", (_label, mutate, reasonCode) => {
    const result = createShadowRebalancePlan(mutate(sellFirstInput()));
    expect(result.status).toBe("BLOCKED");
    expect(result.reasonCodes).toEqual([reasonCode]);
    expect(result.executableOrders).toEqual([]);
  });

  it("같은 종목을 두 자산군에 넣으면 중복 계획을 만들지 않는다", () => {
    const input = sellFirstInput();
    const duplicate = createShadowRebalancePlan({
      ...input,
      assetClasses: input.assetClasses.map((asset) =>
        asset.id === "SAFE"
          ? {
              ...asset,
              instruments: [instrument("005930", 200_000n, 50_000n)],
            }
          : asset,
      ),
    });

    expect(duplicate.status).toBe("BLOCKED");
    expect(duplicate.reasonCodes).toEqual(["DUPLICATE_INSTRUMENT"]);
  });

  it("총 평가액이 0이거나 필요한 매도 수량이 부족하면 계획을 만들지 않는다", () => {
    const zeroTotal = createShadowRebalancePlan(
      planInput(
        [
          securitiesAsset("SAFE", 0n, 9_000n, 8_000n, 9_500n, [instrument("114800", 0n, 10_000n)]),
          cashAsset(0n, 1_000n, 500n, 2_000n),
        ],
        0n,
        0n,
      ),
    );
    expect(zeroTotal.status).toBe("BLOCKED");
    expect(zeroTotal.reasonCodes).toEqual(["PORTFOLIO_TOTAL_INVALID"]);

    const input = sellFirstInput();
    const insufficientSellable = createShadowRebalancePlan({
      ...input,
      assetClasses: input.assetClasses.map((asset) =>
        asset.id === "CORE"
          ? {
              ...asset,
              instruments: asset.instruments.map((item) => ({
                ...item,
                availableSellQuantity: 2n,
              })),
            }
          : asset,
      ),
    });
    expect(insufficientSellable.status).toBe("BLOCKED");
    expect(insufficientSellable.reasonCodes).toEqual(["SELLABLE_QUANTITY_INSUFFICIENT"]);
  });
});
