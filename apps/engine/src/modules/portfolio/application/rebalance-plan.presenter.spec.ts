import { describe, expect, it, vi } from "vitest";

import {
  getLatestRebalancePlan,
  presentRebalancePlan,
  unavailableRebalancePlanSnapshot,
} from "./rebalance-plan.presenter";

describe("rebalance plan presenter", () => {
  it("저장된 bigint 계획과 주문 후보를 계약 문자열로 직렬화한다", () => {
    const snapshot = presentRebalancePlan(storedRun() as never);

    expect(snapshot.state).toBe("READY");
    expect(snapshot.latest).toMatchObject({
      status: "PLANNED",
      totalValueMinor: "100000",
      executableOrders: [
        {
          quantity: "2",
          limitPriceMinor: "10000",
          notionalMinor: "20000",
        },
      ],
    });
  });

  it("저장된 실행 모드를 Shadow로 덮어쓰지 않는다", () => {
    const snapshot = presentRebalancePlan(storedRun("PAPER") as never);
    expect(snapshot.latest?.mode).toBe("PAPER");
  });

  it("저장 계획이 없으면 NO_PLAN을 반환한다", async () => {
    const repository = {
      latestRebalanceRun: vi.fn().mockResolvedValue(null),
    };

    await expect(getLatestRebalancePlan(repository as never)).resolves.toEqual({
      state: "NO_PLAN",
      latest: null,
      liveOrdersEnabled: false,
    });
  });

  it("읽기 실패용 응답은 주문 기능을 열지 않는다", () => {
    expect(unavailableRebalancePlanSnapshot()).toEqual({
      state: "UNAVAILABLE",
      latest: null,
      liveOrdersEnabled: false,
    });
  });
});

function storedRun(mode: "SHADOW" | "PAPER" | "LIVE" = "SHADOW") {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    accountId: "20000000-0000-4000-8000-000000000002",
    snapshotId: "20000000-0000-4000-8000-000000000003",
    snapshotDigest: "a".repeat(64),
    targetConfigVersionId: "20000000-0000-4000-8000-000000000004",
    targetConfigContentHash: "b".repeat(64),
    mode,
    status: "PLANNED",
    dedupeKey: "c".repeat(64),
    startedAt: new Date("2026-07-17T00:00:00.000Z"),
    completedAt: new Date("2026-07-17T00:00:01.000Z"),
    appVersion: "0.1.0",
    policyVersion: "SHADOW_PLAN_V1",
    errorCode: null,
    plan: {
      id: "20000000-0000-4000-8000-000000000005",
      runId: "20000000-0000-4000-8000-000000000001",
      snapshotId: "20000000-0000-4000-8000-000000000003",
      targetConfigVersionId: "20000000-0000-4000-8000-000000000004",
      mode,
      status: "PLANNED",
      canonicalVersion: "SHADOW_PLAN_V1",
      planHash: "d".repeat(64),
      returnPolicy: "BAND_EDGE",
      totalValueMinor: 100_000n,
      reasonCodes: ["BUY_PHASE_READY"],
      canonicalContent: "{}",
      assetDecisions: [],
      deferredBuyNeeds: [],
      projectedAllocations: [
        {
          id: "SAFE",
          kind: "SECURITIES",
          valueMinor: "50000",
          targetBasisPoints: "5000",
          lowerBasisPoints: "4500",
          upperBasisPoints: "5500",
          currentBasisPoints: "5000",
          driftBasisPoints: "0",
          outsideBand: false,
        },
      ],
      createdAt: new Date("2026-07-17T00:00:01.000Z"),
      orders: [
        {
          id: "20000000-0000-4000-8000-000000000006",
          planId: "20000000-0000-4000-8000-000000000005",
          candidateId: "SAFE:KR:114800:BUY",
          phase: "BUY",
          ordinal: 0,
          assetClassId: "SAFE",
          instrumentKey: "KR:114800",
          marketCountry: "KR",
          currency: "KRW",
          symbol: "114800",
          side: "BUY",
          orderType: "LIMIT",
          timeInForce: "DAY",
          quantity: 2n,
          limitPriceMinor: 10_000n,
          notionalMinor: 20_000n,
          unallocatedMinor: 0n,
          createdAt: new Date("2026-07-17T00:00:01.000Z"),
        },
      ],
    },
  };
}
