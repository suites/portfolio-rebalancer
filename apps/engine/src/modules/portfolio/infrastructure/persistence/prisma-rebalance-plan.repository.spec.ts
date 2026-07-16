import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@portfolio-rebalancer/database";

import { PrismaPortfolioRepository } from "./prisma-portfolio.repository";

describe("PrismaPortfolioRepository shadow plan persistence", () => {
  it("최신 VERIFIED snapshot과 ACTIVE target이 정확히 일치할 때만 RUNNING을 만든다", async () => {
    const transaction = {
      rebalanceRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "run-1", status: "RUNNING" }),
      },
      portfolioSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "snapshot-1",
          digest: "a".repeat(64),
          validationStatus: "VERIFIED",
          targetConfigVersionId: "target-1",
        }),
      },
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "target-1", contentHash: "b".repeat(64) }),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(repository.startShadowRebalanceRun(startInput())).resolves.toEqual({
      created: true,
      runId: "run-1",
      status: "RUNNING",
    });
    const createRunInput = transaction.rebalanceRun.create.mock.calls[0]?.[0] as
      { data: Record<string, unknown>; select: Record<string, unknown> } | undefined;
    expect(createRunInput?.data).toMatchObject({
      snapshotId: "snapshot-1",
      targetConfigVersionId: "target-1",
      mode: "SHADOW",
      status: "RUNNING",
    });
    expect(createRunInput?.select).toEqual({ id: true, status: true });
  });

  it("봉인 transaction에서 plan과 orders를 먼저 저장하고 run을 terminal로 바꾼다", async () => {
    const calls: string[] = [];
    const stored = { id: "run-1", status: "PLANNED", plan: { orders: [] } };
    const transaction = {
      rebalanceRun: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: "run-1",
            status: "RUNNING",
            snapshotId: "snapshot-1",
            targetConfigVersionId: "target-1",
            startedAt: new Date("2026-07-16T01:00:00.000Z"),
          })
          .mockResolvedValueOnce(stored),
        update: vi.fn().mockImplementation(() => {
          calls.push("run");
          return Promise.resolve({});
        }),
      },
      portfolioSnapshot: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "snapshot-1", targetConfigVersionId: "target-1" }),
      },
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "target-1" }),
      },
      rebalancePlan: {
        create: vi.fn().mockImplementation(() => {
          calls.push("plan");
          return Promise.resolve({});
        }),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(repository.sealShadowRebalancePlan(sealInput())).resolves.toBe(stored);
    expect(calls).toEqual(["plan", "run"]);
    const createPlanInput = transaction.rebalancePlan.create.mock.calls[0]?.[0] as
      | {
          data: {
            runId: string;
            status: string;
            orders: { create: Array<Record<string, unknown>> };
          };
        }
      | undefined;
    expect(createPlanInput?.data).toMatchObject({
      runId: "run-1",
      status: "PLANNED",
    });
    expect(createPlanInput?.data.orders.create[0]).toMatchObject({
      candidateId: "SAFE:KR:114800:BUY",
      quantity: 2n,
      notionalMinor: 20_000n,
    });
  });

  it("봉인 직전에 최신 snapshot이 바뀌면 아무 것도 저장하지 않는다", async () => {
    const transaction = {
      rebalanceRun: {
        findUnique: vi.fn().mockResolvedValue({
          id: "run-1",
          status: "RUNNING",
          snapshotId: "snapshot-1",
          targetConfigVersionId: "target-1",
          startedAt: new Date("2026-07-16T01:00:00.000Z"),
        }),
        update: vi.fn(),
      },
      portfolioSnapshot: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "snapshot-2", targetConfigVersionId: "target-1" }),
      },
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue({ id: "target-1" }),
      },
      rebalancePlan: { create: vi.fn() },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(repository.sealShadowRebalancePlan(sealInput())).resolves.toBeNull();
    expect(transaction.rebalancePlan.create).not.toHaveBeenCalled();
    expect(transaction.rebalanceRun.update).not.toHaveBeenCalled();
  });
});

function repositoryWithTransaction(transaction: object): PrismaPortfolioRepository {
  type TransactionCallback = (transaction: object) => unknown;
  const database = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: TransactionCallback) =>
        Promise.resolve(callback(transaction)),
      ),
  } as unknown as DatabaseClient;
  return new PrismaPortfolioRepository(database);
}

function startInput() {
  return {
    accountId: "account-1",
    snapshotId: "snapshot-1",
    snapshotDigest: "a".repeat(64),
    targetConfigVersionId: "target-1",
    targetConfigContentHash: "b".repeat(64),
    dedupeKey: "c".repeat(64),
    startedAt: new Date("2026-07-16T01:00:00.000Z"),
    policyVersion: "SHADOW_PLAN_V1",
  };
}

function sealInput() {
  return {
    runId: "run-1",
    accountId: "account-1",
    snapshotId: "snapshot-1",
    targetConfigVersionId: "target-1",
    status: "PLANNED" as const,
    canonicalVersion: "SHADOW_PLAN_V1",
    planHash: "d".repeat(64),
    returnPolicy: "BAND_EDGE" as const,
    totalValueMinor: 100_000n,
    reasonCodes: ["BUY_PHASE_READY"],
    canonicalContent: "{}",
    assetDecisions: [],
    deferredBuyNeeds: [],
    projectedAllocations: [],
    orders: [
      {
        candidateId: "SAFE:KR:114800:BUY",
        phase: "BUY" as const,
        ordinal: 0,
        assetClassId: "SAFE",
        instrumentKey: "KR:114800",
        marketCountry: "KR" as const,
        currency: "KRW" as const,
        symbol: "114800",
        side: "BUY" as const,
        orderType: "LIMIT" as const,
        timeInForce: "DAY" as const,
        quantity: 2n,
        limitPriceMinor: 10_000n,
        notionalMinor: 20_000n,
        unallocatedMinor: 0n,
      },
    ],
    completedAt: new Date("2026-07-16T01:00:01.000Z"),
    requireCurrentIdentity: true,
  };
}
