import { describe, expect, it } from "vitest";

import { CreateRebalancePlanInputSchema, RebalancePlanSnapshotSchema } from "./rebalancing";

const latestPlan = {
  runId: "20000000-0000-4000-8000-000000000001",
  planId: "20000000-0000-4000-8000-000000000002",
  mode: "SHADOW",
  status: "PLANNED",
  startedAt: "2026-07-16T01:00:00.000Z",
  completedAt: "2026-07-16T01:00:01.000Z",
  snapshotId: "20000000-0000-4000-8000-000000000003",
  snapshotDigest: "a".repeat(64),
  configVersionId: "20000000-0000-4000-8000-000000000004",
  canonicalVersion: "SHADOW_PLAN_V1",
  planHash: "b".repeat(64),
  returnPolicy: "BAND_EDGE",
  reasonCodes: ["BUY_PHASE_READY"],
  totalValueMinor: "1000000",
  executableOrders: [
    {
      candidateId: "SAFE:KR:114800:BUY",
      phase: "BUY",
      assetClassId: "SAFE",
      instrumentKey: "KR:114800",
      marketCountry: "KR",
      currency: "KRW",
      symbol: "114800",
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: "2",
      limitPriceMinor: "10000",
      notionalMinor: "20000",
      unallocatedMinor: "0",
    },
  ],
  deferredBuyNeeds: [],
  projectedAllocations: [
    {
      id: "SAFE",
      kind: "SECURITIES",
      valueMinor: "420000",
      targetBasisPoints: "4000",
      lowerBasisPoints: "3500",
      upperBasisPoints: "4500",
      currentBasisPoints: "4200",
      driftBasisPoints: "200",
      outsideBand: false,
    },
  ],
} as const;

describe("rebalancing contracts", () => {
  it("Shadow 계획의 저장·조회 응답을 직렬화한다", () => {
    const parsed = RebalancePlanSnapshotSchema.parse({
      state: "READY",
      latest: latestPlan,
      liveOrdersEnabled: false,
    });

    expect(parsed.latest?.planHash).toBe("b".repeat(64));
    expect(parsed.latest?.executableOrders[0]?.notionalMinor).toBe("20000");
  });

  it("Shadow, Paper, Live 계획 생성 모드를 명시적으로 구분한다", () => {
    for (const mode of ["SHADOW", "PAPER", "LIVE"] as const) {
      expect(CreateRebalancePlanInputSchema.parse({ mode })).toEqual({ mode });
    }
    expect(CreateRebalancePlanInputSchema.safeParse({ mode: "AUTO" }).success).toBe(false);
  });

  it("부호가 잘못된 금액과 범위를 벗어난 비중을 거부한다", () => {
    expect(
      RebalancePlanSnapshotSchema.safeParse({
        state: "READY",
        latest: {
          ...latestPlan,
          projectedAllocations: [
            {
              ...latestPlan.projectedAllocations[0],
              valueMinor: "-1",
              targetBasisPoints: "10001",
            },
          ],
        },
        liveOrdersEnabled: false,
      }).success,
    ).toBe(false);
  });
});
