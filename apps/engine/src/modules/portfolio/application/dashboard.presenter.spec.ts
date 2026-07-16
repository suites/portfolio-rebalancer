import { describe, expect, it } from "vitest";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";
import { getDashboard } from "./dashboard.presenter";

describe("dashboard presenter with snapshot-bound target", () => {
  it("고정된 목표를 표시하되 관리 현금 미검증이면 계획을 차단한다", async () => {
    const dashboard = await getDashboard(
      repositoryWith(dashboardState({ managedCashMinor: null })),
    );

    expect(dashboard.blockReason?.code).toBe("MANAGED_CASH_MISSING");
    expect(dashboard.allocations[0]).toMatchObject({
      targetBasisPoints: 6_000,
      lowerBasisPoints: 5_500,
      upperBasisPoints: 6_500,
      bandStatus: "OUTSIDE_BAND",
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
            assetKey: "US:AAPL",
            targetBasisPoints: 6_000,
            lowerBasisPoints: 5_500,
            upperBasisPoints: 6_500,
          },
          {
            assetKey: "US:BRK.B",
            targetBasisPoints: 4_000,
            lowerBasisPoints: 3_500,
            upperBasisPoints: 4_500,
          },
          {
            assetKey: "CASH",
            targetBasisPoints: 0,
            lowerBasisPoints: 0,
            upperBasisPoints: 0,
          },
        ],
      },
    },
  };
}
