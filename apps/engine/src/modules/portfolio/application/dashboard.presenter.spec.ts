import { describe, expect, it } from "vitest";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";
import { getDashboard } from "./dashboard.presenter";

describe("dashboard presenter with snapshot-bound target", () => {
  it("고정된 목표를 표시하되 관리 현금 미검증이면 계획을 차단한다", async () => {
    const dashboard = await getDashboard(
      repositoryWith(dashboardState({ managedCashMinor: null })),
    );

    expect(dashboard.blockReason?.code).toBe("MANAGED_CASH_MISSING");
    expect(dashboard.allocations.find(({ id }) => id === "CORE")).toMatchObject({
      targetBasisPoints: 6_000,
      lowerBasisPoints: 5_500,
      upperBasisPoints: 6_500,
      bandStatus: "OUTSIDE_BAND",
      instruments: [
        expect.objectContaining({
          id: "US:AAPL",
          targetWithinAssetPoints: 10_000,
        }),
      ],
    });
    expect(dashboard.buyingPower).toEqual([
      {
        currency: "KRW",
        amount: "5000000",
        valueKrwMinor: "5000000",
        observedAt: "2026-07-16T03:00:00.000Z",
        valuationEligible: false,
      },
    ]);
    expect(dashboard.managedCashMinor).toBeNull();
    expect(dashboard.managedCashSource).toBe("UNSET");
    expect(dashboard.liveOrdersEnabled).toBe(false);
  });

  it("활성 설정과 snapshot 고정 버전이 다르면 과거 snapshot 재해석을 차단한다", async () => {
    const state = dashboardState({ managedCashMinor: 0n });
    const dashboard = await getDashboard(
      repositoryWith({ ...state, activeTargetVersionId: "22222222-2222-4222-8222-222222222222" }),
    );

    expect(dashboard.blockReason?.code).toBe("TARGET_CONFIG_STALE");
    expect(dashboard.conclusion).toBe("BLOCKED");
  });

  it("현금과 목표가 고정되면 bigint 교차 비교로 범위 이탈을 판정한다", async () => {
    const dashboard = await getDashboard(repositoryWith(dashboardState({ managedCashMinor: 0n })));

    expect(dashboard.blockReason).toBeNull();
    expect(dashboard.conclusion).toBe("REBALANCE_REQUIRED");
    expect(dashboard.managedCashMinor).toBe("0");
    expect(dashboard.managedCashSource).toBe("EXCLUDED");
    expect(dashboard.allocations.at(-1)).toMatchObject({
      id: "CASH",
      valueMinor: "0",
      targetBasisPoints: 0,
      bandStatus: "IN_RANGE",
    });
    expect(dashboard.securitiesValueMinor).toBe("1000000");
    expect(dashboard.unmanagedHoldings).toEqual([]);
  });

  it("어느 자산군에도 없는 현재 보유종목은 자동 매도하지 않고 별도로 차단한다", async () => {
    const state = dashboardState({ managedCashMinor: 0n });
    const target = state.snapshot.targetConfigVersion;
    const dashboard = await getDashboard(
      repositoryWith({
        ...state,
        snapshot: {
          ...state.snapshot,
          targetConfigVersion: {
            ...target,
            allocations: target.allocations.map((allocation) =>
              allocation.assetKey === "SATELLITE"
                ? {
                    ...allocation,
                    targetBasisPoints: 0,
                    lowerBasisPoints: 0,
                    upperBasisPoints: 0,
                    instruments: [],
                  }
                : allocation.assetKey === "CORE"
                  ? {
                      ...allocation,
                      targetBasisPoints: 10_000,
                      lowerBasisPoints: 9_500,
                      upperBasisPoints: 10_000,
                    }
                  : allocation,
            ),
          },
        },
      }),
    );

    expect(dashboard.blockReason?.code).toBe("UNMANAGED_ASSET");
    expect(dashboard.unmanagedHoldings).toEqual([
      expect.objectContaining({ id: "US:BRK.B", label: "Berkshire" }),
    ]);
  });
});

function repositoryWith(state: ReturnType<typeof dashboardState>) {
  return {
    latestDashboardState: () => Promise.resolve(state),
  } as unknown as PrismaPortfolioRepository;
}

function dashboardState({ managedCashMinor }: { readonly managedCashMinor: bigint | null }) {
  const targetId = "11111111-1111-4111-8111-111111111111";
  return {
    activeTargetVersionId: targetId,
    snapshot: {
      id: "33333333-3333-4333-8333-333333333333",
      accountId: "44444444-4444-4444-8444-444444444444",
      targetConfigVersionId: targetId,
      observedAt: new Date("2026-07-16T03:00:00.000Z"),
      securitiesValueMinor: 1_000_000n,
      totalValueMinor: 1_000_000n,
      managedCashMinor,
      account: { maskedNumber: "****1234" },
      buyingPower: [
        {
          currency: "KRW",
          amount: "5000000",
          valueKrwMinor: 5_000_000n,
          observedAt: new Date("2026-07-16T03:00:00.000Z"),
          valuationEligible: false,
        },
      ],
      holdings: [
        {
          marketCountry: "US",
          symbol: "AAPL",
          name: "Apple",
          currency: "USD",
          quantity: "1",
          marketValueKrwMinor: 700_000n,
        },
        {
          marketCountry: "US",
          symbol: "BRK.B",
          name: "Berkshire",
          currency: "USD",
          quantity: "1",
          marketValueKrwMinor: 300_000n,
        },
      ],
      targetConfigVersion: {
        id: targetId,
        version: 1,
        cashPolicy:
          managedCashMinor === null
            ? { mode: "UNSET", version: "LEGACY_V1" }
            : { mode: "EXCLUDED", version: "CASH_V1" },
        allocations: [
          {
            assetKey: "SAFE",
            label: "안전자산",
            targetBasisPoints: 0,
            lowerBasisPoints: 0,
            upperBasisPoints: 0,
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [],
          },
          {
            assetKey: "CORE",
            label: "핵심 공격자산",
            targetBasisPoints: 6_000,
            lowerBasisPoints: 5_500,
            upperBasisPoints: 6_500,
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [
              {
                validationId: null,
                marketCountry: "US",
                listingMarket: null,
                symbol: "AAPL",
                name: "Apple",
                englishName: null,
                currency: "USD",
                withinAssetPoints: 10_000,
              },
            ],
          },
          {
            assetKey: "SATELLITE",
            label: "위성 공격자산",
            targetBasisPoints: 4_000,
            lowerBasisPoints: 3_500,
            upperBasisPoints: 4_500,
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [
              {
                validationId: null,
                marketCountry: "US",
                listingMarket: null,
                symbol: "BRK.B",
                name: "Berkshire",
                englishName: null,
                currency: "USD",
                withinAssetPoints: 10_000,
              },
            ],
          },
          {
            assetKey: "CASH",
            label: "관리 현금",
            targetBasisPoints: 0,
            lowerBasisPoints: 0,
            upperBasisPoints: 0,
            compositionPolicy: { mode: "NONE", version: "CASH_V1" },
            instruments: [],
          },
        ],
      },
    },
  };
}
