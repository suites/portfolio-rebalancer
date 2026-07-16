import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@portfolio-rebalancer/database";

import { PrismaPortfolioRepository } from "./prisma-portfolio.repository";

const allocations = [
  {
    assetKey: "NASDAQ:AAPL",
    label: "Apple",
    market: "NASDAQ",
    symbol: "AAPL",
    currency: "USD",
    targetBasisPoints: 10_000,
    lowerBasisPoints: 9_000,
    upperBasisPoints: 10_000,
  },
];

describe("PrismaPortfolioRepository target settings", () => {
  it("canonical hash와 다음 버전으로 DRAFT를 생성한다", async () => {
    const create = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: "version-1", status: "DRAFT" });
    const retireDrafts = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ count: 0 });
    const transaction = {
      portfolioSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1", digest: "digest-1" }),
      },
      targetConfig: {
        upsert: vi.fn().mockResolvedValue({ id: "config-1" }),
      },
      targetConfigVersion: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: retireDrafts,
        aggregate: vi.fn().mockResolvedValue({ _max: { version: 2 } }),
        create,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await repository.createTargetDraft({
      accountId: "account-1",
      sourceSnapshotId: "snapshot-1",
      sourceSnapshotDigest: "digest-1",
      allocations,
    });

    const createInput = create.mock.calls[0]?.[0] as
      | {
          data: {
            version: number;
            status: string;
            contentHash: string;
            source: {
              managedCashMinor: string | null;
              sourceSnapshotId: string;
              sourceSnapshotDigest: string;
            };
          };
        }
      | undefined;
    expect(createInput?.data.version).toBe(3);
    expect(createInput?.data.status).toBe("DRAFT");
    expect(createInput?.data.contentHash).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            version: 1,
            managedCashMinor: null,
            sourceSnapshotId: "snapshot-1",
            sourceSnapshotDigest: "digest-1",
            allocations,
          }),
        )
        .digest("hex"),
    );
    expect(createInput?.data.source.managedCashMinor).toBeNull();
    expect(createInput?.data.source.sourceSnapshotId).toBe("snapshot-1");
    expect(createInput?.data.source.sourceSnapshotDigest).toBe("digest-1");
    expect(retireDrafts.mock.calls[0]?.[0]).toEqual({
      where: { configId: "config-1", status: "DRAFT" },
      data: { status: "RETIRED" },
    });
  });

  it("DRAFT 적용을 한 트랜잭션에서 기존 ACTIVE retire 후 전환한다", async () => {
    const updateMany = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ count: 1 });
    const update = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: "draft-2", status: "ACTIVE" });
    const transaction = {
      portfolioSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-1", digest: "digest-1" }),
      },
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-2",
          configId: "config-1",
          status: "DRAFT",
          source: {
            sourceSnapshotId: "snapshot-1",
            sourceSnapshotDigest: "digest-1",
          },
        }),
        updateMany,
        update,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await repository.activateTargetDraft({
      accountId: "account-1",
      version: 2,
    });

    const retireInput = updateMany.mock.calls[0]?.[0] as
      { where: { status: string; id: { not: string } }; data: { status: string } } | undefined;
    const activateInput = update.mock.calls[0]?.[0] as
      { where: { id: string }; data: { status: string } } | undefined;
    expect(retireInput).toMatchObject({
      where: { status: "ACTIVE", id: { not: "draft-2" } },
      data: { status: "RETIRED" },
    });
    expect(activateInput).toMatchObject({
      where: { id: "draft-2" },
      data: { status: "ACTIVE" },
    });
  });

  it("초안 저장 직전 최신 snapshot이 바뀌면 아무 설정도 쓰지 않는다", async () => {
    const upsert = vi.fn();
    const transaction = {
      portfolioSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-2", digest: "digest-2" }),
      },
      targetConfig: { upsert },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.createTargetDraft({
        accountId: "account-1",
        sourceSnapshotId: "snapshot-1",
        sourceSnapshotDigest: "digest-1",
        allocations,
      }),
    ).resolves.toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("초안의 원본 snapshot이 바뀌면 ACTIVE로 전환하지 않는다", async () => {
    const updateMany = vi.fn();
    const update = vi.fn();
    const transaction = {
      portfolioSnapshot: {
        findFirst: vi.fn().mockResolvedValue({ id: "snapshot-current", digest: "digest-current" }),
      },
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-2",
          configId: "config-1",
          status: "DRAFT",
          source: {
            sourceSnapshotId: "snapshot-old",
            sourceSnapshotDigest: "digest-old",
          },
        }),
        updateMany,
        update,
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.activateTargetDraft({
        accountId: "account-1",
        version: 2,
      }),
    ).resolves.toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("수집 기록을 현재 계좌로 제한한다", async () => {
    const findFirst = vi.fn().mockResolvedValue({ accountId: "account-1" });
    const findMany = vi.fn().mockResolvedValue([]);
    const database = {
      collectionRun: { findFirst, findMany },
    } as unknown as DatabaseClient;
    const repository = new PrismaPortfolioRepository(database);

    await expect(repository.latestCollectionAccountId()).resolves.toBe("account-1");
    await repository.recentCollectionRecords("account-1", 20);

    expect(findFirst).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
      select: { accountId: true },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "account-1" }, take: 20 }),
    );
  });
});

describe("PrismaPortfolioRepository collection evidence", () => {
  it("매수 가능 금액을 관리 현금과 분리된 append-only snapshot 자식으로 저장한다", async () => {
    const createSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const transaction = {
      targetConfigVersion: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      rawBrokerResponse: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      portfolioSnapshot: {
        create: createSnapshot,
      },
      collectionRun: {
        update: vi.fn().mockResolvedValue({ id: "run-1" }),
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const observedAt = new Date("2026-07-16T03:00:00.000Z");

    await repository.completeCollection({
      runId: "run-1",
      accountId: "account-1",
      observedAt,
      totalValueMinor: 3_142_919n,
      usdKrwRate: "1380",
      holdings: [],
      buyingPower: [
        { currency: "KRW", amount: "5000000", valueKrwMinor: 5_000_000n },
        { currency: "USD", amount: "10.5", valueKrwMinor: 14_490n },
      ],
      rawResponses: [],
    });

    const snapshotInput = createSnapshot.mock.calls[0]?.[0] as
      | {
          data: {
            managedCashMinor: bigint | null;
            totalValueMinor: bigint;
            buyingPower: {
              create: readonly {
                currency: string;
                amount: string;
                valueKrwMinor: bigint;
                observedAt: Date;
                valuationEligible: boolean;
              }[];
            };
          };
        }
      | undefined;
    expect(snapshotInput?.data).toMatchObject({
      managedCashMinor: null,
      totalValueMinor: 3_142_919n,
      buyingPower: {
        create: [
          {
            currency: "KRW",
            amount: "5000000",
            valueKrwMinor: 5_000_000n,
            observedAt,
            valuationEligible: false,
          },
          {
            currency: "USD",
            amount: "10.5",
            valueKrwMinor: 14_490n,
            observedAt,
            valuationEligible: false,
          },
        ],
      },
    });
  });
});

function repositoryWithTransaction(transaction: object) {
  const database = {
    $transaction: vi.fn((callback: (value: object) => unknown) =>
      Promise.resolve(callback(transaction)),
    ),
  } as unknown as DatabaseClient;
  return new PrismaPortfolioRepository(database);
}
