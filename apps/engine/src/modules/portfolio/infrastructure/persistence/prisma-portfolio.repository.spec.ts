import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@portfolio-rebalancer/database";

import { PrismaPortfolioRepository } from "./prisma-portfolio.repository";

const cashPolicy = {
  mode: "FIXED_KRW" as const,
  version: "CASH_V1" as const,
  amountMinor: "1000000",
};

const allocations = [
  {
    assetKey: "US:AAPL",
    label: "Apple",
    targetBasisPoints: 10_000,
    lowerBasisPoints: 9_000,
    upperBasisPoints: 10_000,
    bandPolicy: {
      mode: "CUSTOM" as const,
      version: "LEGACY_V1",
      lowerBasisPoints: 9_000,
      upperBasisPoints: 10_000,
    },
    compositionPolicy: {
      mode: "LEGACY_SINGLE" as const,
      version: "LEGACY_V1",
    },
    instruments: [
      {
        validationId: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
        marketCountry: "US",
        listingMarket: "NASDAQ",
        symbol: "AAPL",
        name: "Apple",
        englishName: "Apple Inc.",
        currency: "USD",
        withinAssetPoints: 10_000,
      },
    ],
  },
];

describe("PrismaPortfolioRepository broker request attempts", () => {
  it("workflow correlation과 rate-limit 메타데이터를 append-only 행으로 저장한다", async () => {
    const create = vi.fn().mockResolvedValue({ id: "attempt-1" });
    const database = {
      brokerRequestAttempt: { create },
    } as unknown as DatabaseClient;
    const repository = new PrismaPortfolioRepository(database);
    const startedAt = new Date("2026-07-16T03:00:00.000Z");
    const completedAt = new Date("2026-07-16T03:00:00.250Z");

    await repository.appendBrokerRequestAttempt({
      workflowType: "PORTFOLIO_COLLECTION",
      correlationId: "11111111-1111-4111-8111-111111111111",
      collectionRunId: "22222222-2222-4222-8222-222222222222",
      operationId: "getPrices",
      ordinal: 0,
      attempt: 2,
      rateLimitGroup: "MARKET_DATA",
      startedAt,
      completedAt,
      outcome: "HTTP_ERROR",
      httpStatus: 429,
      requestId: "synthetic-request-id",
      rateLimitLimit: 10,
      rateLimitRemaining: 0,
      rateLimitResetSeconds: 1,
      retryAfterSeconds: 1,
      safeErrorCode: "TOSS_API_RESPONSE_ERROR",
      redactedRequestSummary: {
        method: "GET",
        path: "/api/v1/prices",
        symbols: ["005930"],
        account: "[REDACTED]",
      },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
        collectionRunId: "22222222-2222-4222-8222-222222222222",
        operationId: "getPrices",
        ordinal: 0,
        attempt: 2,
        rateLimitGroup: "MARKET_DATA",
        startedAt,
        completedAt,
        outcome: "HTTP_ERROR",
        httpStatus: 429,
        requestId: "synthetic-request-id",
        rateLimitLimit: 10,
        rateLimitRemaining: 0,
        rateLimitResetSeconds: 1,
        retryAfterSeconds: 1,
        safeErrorCode: "TOSS_API_RESPONSE_ERROR",
        redactedRequestSummary: {
          method: "GET",
          path: "/api/v1/prices",
          symbols: ["005930"],
          account: "[REDACTED]",
        },
      },
    });
  });

  it("collection run이 없는 진단 workflow와 nullable 응답 메타데이터도 보존한다", async () => {
    const create = vi.fn().mockResolvedValue({ id: "attempt-2" });
    const database = {
      brokerRequestAttempt: { create },
    } as unknown as DatabaseClient;
    const repository = new PrismaPortfolioRepository(database);

    await repository.appendBrokerRequestAttempt({
      workflowType: "DOCTOR",
      correlationId: "33333333-3333-4333-8333-333333333333",
      collectionRunId: null,
      operationId: "getAccounts",
      ordinal: 0,
      attempt: 1,
      rateLimitGroup: "ACCOUNT",
      startedAt: new Date("2026-07-16T03:00:00.000Z"),
      completedAt: new Date("2026-07-16T03:00:00.100Z"),
      outcome: "NETWORK_ERROR",
      httpStatus: null,
      requestId: null,
      rateLimitLimit: null,
      rateLimitRemaining: null,
      rateLimitResetSeconds: null,
      retryAfterSeconds: null,
      safeErrorCode: "TOSS_API_NETWORK_FAILED",
      redactedRequestSummary: { method: "GET", path: "/api/v1/accounts" },
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowType: "DOCTOR",
        collectionRunId: null,
        outcome: "NETWORK_ERROR",
        httpStatus: null,
        requestId: null,
      }),
    });
  });
});

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
      cashPolicy,
      allocations,
    });

    const createInput = create.mock.calls[0]?.[0] as
      | {
          data: {
            version: number;
            status: string;
            contentHash: string;
            cashPolicy: typeof cashPolicy;
            source: {
              cashPolicy: typeof cashPolicy;
              sourceSnapshotId: string;
              sourceSnapshotDigest: string;
              version: number;
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
            version: 6,
            cashPolicy,
            sourceSnapshotId: "snapshot-1",
            sourceSnapshotDigest: "digest-1",
            allocations,
          }),
        )
        .digest("hex"),
    );
    expect(createInput?.data.cashPolicy).toEqual(cashPolicy);
    expect(createInput?.data.source.version).toBe(6);
    expect(createInput?.data.source.cashPolicy).toEqual(cashPolicy);
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
        cashPolicy,
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

  it("종목 검증 증거를 새 행으로 저장한 뒤 검색 카탈로그의 최신 포인터만 갱신한다", async () => {
    const createValidation = vi.fn().mockResolvedValue({
      id: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
    });
    const updateCatalog = vi.fn().mockResolvedValue({ id: "catalog-1" });
    const transaction = {
      instrumentCatalog: {
        upsert: vi.fn().mockResolvedValue({ id: "catalog-1" }),
        update: updateCatalog,
      },
      instrumentValidation: {
        create: createValidation,
      },
    };
    const repository = repositoryWithTransaction(transaction);
    const observedAt = new Date("2026-07-16T13:00:00.000Z");

    await repository.recordInstrumentValidation({
      requestedMarketCountry: "US",
      requestedSymbol: "SGOV",
      providerApiVersion: "1.2.4",
      marketCountry: "US",
      symbol: "SGOV",
      listingMarket: "NYSE",
      name: "아이셰어즈 0-3개월 미국채",
      englishName: "iShares 0-3 Month Treasury Bond ETF",
      isinCode: "US46436E7186",
      currency: "USD",
      securityType: "FOREIGN_ETF",
      isCommonShare: false,
      listingStatus: "ACTIVE",
      listDate: "2020-05-26",
      delistDate: null,
      sharesOutstanding: "1000000",
      leverageFactor: "1.0",
      liquidationTrading: null,
      nxtSupported: null,
      krxTradingSuspended: null,
      nxtTradingSuspended: null,
      targetEligibility: "ELIGIBLE",
      targetReasonCodes: [],
      tradeBlockedNow: false,
      tradeReasonCodes: [],
      requiresOrderRevalidation: false,
      stockPayload: { symbol: "SGOV", optional: undefined },
      warningsPayload: [],
      observedAt,
    });

    const createInput = createValidation.mock.calls[0]?.[0] as
      | {
          data: {
            catalogId: string;
            stockPayload: unknown;
            warningsPayload: unknown;
            stockPayloadSha256: string;
            warningsPayloadSha256: string;
            observedAt: Date;
          };
        }
      | undefined;
    expect(createInput?.data).toMatchObject({
      catalogId: "catalog-1",
      stockPayload: { symbol: "SGOV" },
      warningsPayload: [],
      stockPayloadSha256: createHash("sha256")
        .update(JSON.stringify({ symbol: "SGOV" }))
        .digest("hex"),
      warningsPayloadSha256: createHash("sha256").update(JSON.stringify([])).digest("hex"),
      observedAt,
    });
    expect(updateCatalog).toHaveBeenCalledWith({
      where: { id: "catalog-1" },
      data: { lastValidationId: "2bf2e437-c981-4dbd-842e-d0d9a11ac318" },
    });
  });
});

describe("PrismaPortfolioRepository collection evidence", () => {
  it("매수 가능 금액을 관리 현금과 분리된 append-only snapshot 자식으로 저장한다", async () => {
    const createSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ fencingToken: 1n }]),
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
      securitiesValueMinor: 3_142_919n,
      usdKrwRate: "1380",
      holdings: [],
      buyingPower: [
        { currency: "KRW", amount: "5000000", valueKrwMinor: 5_000_000n },
        { currency: "USD", amount: "10.5", valueKrwMinor: 14_490n },
      ],
      rawResponses: [],
      lease: {
        owner: "11111111-1111-4111-8111-111111111111",
        fencingToken: 1n,
      },
    });

    const snapshotInput = createSnapshot.mock.calls[0]?.[0] as
      | {
          data: {
            managedCashMinor: bigint | null;
            securitiesValueMinor: bigint;
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
      securitiesValueMinor: 3_142_919n,
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

  it("최종 fenced 트랜잭션에서 고정한 ACTIVE 정책으로 관리 현금과 총액을 함께 저장한다", async () => {
    const createSnapshot = vi.fn().mockResolvedValue({ id: "snapshot-1" });
    const findActive = vi.fn().mockResolvedValue({
      id: "target-1",
      cashPolicy: {
        mode: "FIXED_KRW",
        version: "CASH_V1",
        amountMinor: "100000",
      },
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ fencingToken: 1n }]),
      targetConfigVersion: { findFirst: findActive },
      rawBrokerResponse: {
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      portfolioSnapshot: { create: createSnapshot },
      collectionRun: {
        update: vi.fn().mockResolvedValue({ id: "run-1" }),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await repository.completeCollection({
      runId: "run-1",
      accountId: "account-1",
      observedAt: new Date("2026-07-16T03:00:00.000Z"),
      securitiesValueMinor: 900_000n,
      usdKrwRate: null,
      holdings: [],
      buyingPower: [],
      rawResponses: [],
      lease: {
        owner: "11111111-1111-4111-8111-111111111111",
        fencingToken: 1n,
      },
    });

    expect(findActive).toHaveBeenCalledWith({
      where: { config: { accountId: "account-1" }, status: "ACTIVE" },
      select: { id: true, cashPolicy: true },
    });
    const snapshotInput = createSnapshot.mock.calls[0]?.[0] as
      | {
          data: {
            targetConfigVersionId: string | null;
            securitiesValueMinor: bigint;
            managedCashMinor: bigint | null;
            totalValueMinor: bigint;
          };
        }
      | undefined;
    expect(snapshotInput?.data).toMatchObject({
      targetConfigVersionId: "target-1",
      securitiesValueMinor: 900_000n,
      managedCashMinor: 100_000n,
      totalValueMinor: 1_000_000n,
    });
  });

  it("최종 트랜잭션에서 fencing token이 일치하지 않으면 어떤 증거도 쓰지 않는다", async () => {
    const createMany = vi.fn();
    const createSnapshot = vi.fn();
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      targetConfigVersion: {
        findFirst: vi.fn(),
      },
      rawBrokerResponse: {
        createMany,
      },
      portfolioSnapshot: {
        create: createSnapshot,
      },
      collectionRun: {
        update: vi.fn(),
      },
    };
    const repository = repositoryWithTransaction(transaction);

    await expect(
      repository.completeCollection({
        runId: "run-1",
        accountId: "account-1",
        observedAt: new Date("2026-07-16T03:00:00.000Z"),
        securitiesValueMinor: 0n,
        usdKrwRate: null,
        holdings: [],
        buyingPower: [],
        rawResponses: [],
        lease: {
          owner: "11111111-1111-4111-8111-111111111111",
          fencingToken: 1n,
        },
      }),
    ).resolves.toBe(false);
    expect(createMany).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("취득·heartbeat·해제에서 owner와 fencing token을 함께 사용한다", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const database = {
      $queryRaw: vi.fn().mockResolvedValue([{ fencingToken: 7n }]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      runtimeLease: { deleteMany },
    } as unknown as DatabaseClient;
    const repository = new PrismaPortfolioRepository(database);
    const owner = "11111111-1111-4111-8111-111111111111";

    const lease = await repository.acquireCollectionLease(owner);

    expect(lease).toEqual({ owner, fencingToken: 7n });
    await expect(
      repository.heartbeatCollectionLease(lease as NonNullable<typeof lease>),
    ).resolves.toBe(true);
    await repository.releaseCollectionLease(lease as NonNullable<typeof lease>);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        key: "toss-portfolio-collection",
        owner,
        fencingToken: 7n,
      },
    });
  });
});

describe("PrismaPortfolioRepository account scope", () => {
  it("dashboard는 최신 수집 계좌의 snapshot만 조회한다", async () => {
    const findSnapshot = vi.fn().mockResolvedValue(null);
    const database = {
      collectionRun: {
        findFirst: vi.fn().mockResolvedValue({ accountId: "account-2" }),
      },
      portfolioSnapshot: {
        findFirst: findSnapshot,
      },
    } as unknown as DatabaseClient;
    const repository = new PrismaPortfolioRepository(database);

    await expect(repository.latestDashboardState()).resolves.toEqual({
      snapshot: null,
      activeTargetVersionId: null,
    });
    expect(findSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "account-2" } }),
    );
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
