import { describe, expect, it, vi } from "vitest";

import { TossRequestAuditContext } from "../infrastructure/broker/toss-request-audit.context";
import type { SealRebalancePlanInput } from "../infrastructure/persistence/prisma-portfolio.repository";
import {
  createAndStoreRebalancePlan,
  createAndStoreShadowPlan,
} from "./shadow-plan.use-case";

const accountId = "30000000-0000-4000-8000-000000000001";
const snapshotId = "30000000-0000-4000-8000-000000000002";
const targetId = "30000000-0000-4000-8000-000000000003";
const runId = "30000000-0000-4000-8000-000000000004";
const now = new Date("2026-07-16T01:00:00.000Z");

describe("createAndStoreShadowPlan", () => {
  it("지원하지 않는 미국 종목은 broker preflight 없이 BLOCKED 계획으로 봉인한다", async () => {
    const snapshot = planningSnapshot("US_BLOCKED");
    const repository = repositoryMock(snapshot);
    const source = sourceMock();

    await createAndStoreShadowPlan({
      repository: repository as never,
      source,
      requestAuditContext: new TossRequestAuditContext(),
      selectedAccountSeq: undefined,
      now: () => now,
    });

    expect(source.listAccounts).not.toHaveBeenCalled();
    expect(repository.sealRebalancePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "SHADOW",
        runId,
        status: "BLOCKED",
        reasonCodes: ["UNSUPPORTED_MARKET"],
        orders: [],
      }),
    );
  });

  it("현재 비중이 범위 안이면 외부 주문 사전조회 없이 NO_ACTION을 저장한다", async () => {
    const snapshot = planningSnapshot("KR_NO_ACTION");
    const repository = repositoryMock(snapshot);
    const source = sourceMock();

    await createAndStoreShadowPlan({
      repository: repository as never,
      source,
      requestAuditContext: new TossRequestAuditContext(),
      selectedAccountSeq: undefined,
      now: () => now,
    });

    expect(source.listAccounts).not.toHaveBeenCalled();
    expect(repository.sealRebalancePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "NO_ACTION",
        reasonCodes: ["NO_REBALANCE_NEEDED"],
        totalValueMinor: 100_000n,
      }),
    );
  });

  it("오래된 가격은 토스 주문 사전조회 전에 QUOTE_STALE로 차단한다", async () => {
    const snapshot = planningSnapshot("KR_NO_ACTION");
    snapshot.prices[0]!.providerObservedAt = new Date("2026-07-16T00:50:00.000Z");
    snapshot.prices[0]!.receivedAt = new Date("2026-07-16T00:50:01.000Z");
    const repository = repositoryMock(snapshot);
    const source = sourceMock();

    await createAndStoreShadowPlan({
      repository: repository as never,
      source,
      requestAuditContext: new TossRequestAuditContext(),
      selectedAccountSeq: undefined,
      now: () => now,
    });

    expect(source.listAccounts).not.toHaveBeenCalled();
    expect(repository.sealRebalancePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "BLOCKED",
        reasonCodes: ["QUOTE_STALE"],
      }),
    );
  });

  it("매수 계획은 종목 제한·시장 세션·수수료를 확인한 뒤 주문 후보를 봉인한다", async () => {
    const snapshot = planningSnapshot("KR_BUY");
    const repository = repositoryMock(snapshot);
    const source = sourceMock({
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getStocks: vi.fn().mockResolvedValue({
        result: [
          {
            symbol: "114800",
            market: "KOSPI",
            name: "KODEX 인버스 아님",
            englishName: "Synthetic Safe ETF",
            isinCode: "KR7000000000",
            currency: "KRW",
            securityType: "ETF",
            isCommonShare: false,
            status: "ACTIVE",
            listDate: "2020-01-01",
            delistDate: null,
            sharesOutstanding: "1000000",
            leverageFactor: "1",
            koreanMarketDetail: {
              liquidationTrading: false,
              nxtSupported: true,
              krxTradingSuspended: false,
              nxtTradingSuspended: false,
            },
          },
        ],
      }),
      getStockWarnings: vi.fn().mockResolvedValue({ result: [] }),
      getCommissionSchedule: vi.fn().mockResolvedValue({
        value: {
          accountId,
          periods: [
            {
              marketCountry: "KR",
              commissionRatePercent: "0.015",
              startDate: null,
              endDate: null,
            },
          ],
        },
        metadata: {},
        redactedBody: {},
      }),
    });

    await createAndStoreShadowPlan({
      repository: repository as never,
      source,
      requestAuditContext: new TossRequestAuditContext(),
      selectedAccountSeq: 1,
      now: () => now,
    });

    expect(source.getStocks).toHaveBeenCalledWith(["114800"]);
    expect(source.getStockWarnings).toHaveBeenCalledWith("114800");
    expect(source.getCommissionSchedule).toHaveBeenCalled();
    expect(repository.recordInstrumentValidation).toHaveBeenCalled();
    expect(repository.sealRebalancePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "PLANNED",
        reasonCodes: ["BUY_PHASE_READY", "BUY_NEEDS_REMAIN"],
        orders: [
          expect.objectContaining({
            symbol: "114800",
            side: "BUY",
            quantity: 2n,
            notionalMinor: 20_000n,
          }),
        ],
      }),
    );
  });

  it("같은 snapshot의 봉인된 실행이 있으면 broker를 다시 호출하지 않는다", async () => {
    const snapshot = planningSnapshot("KR_NO_ACTION");
    const existing = storedRun("NO_ACTION");
    const repository = repositoryMock(snapshot, {
      startRebalanceRun: vi
        .fn()
        .mockResolvedValue({ created: false, runId, status: "NO_ACTION" }),
      rebalanceRunById: vi.fn().mockResolvedValue(existing),
    });
    const source = sourceMock();

    await expect(
      createAndStoreShadowPlan({
        repository: repository as never,
        source,
        requestAuditContext: new TossRequestAuditContext(),
        selectedAccountSeq: undefined,
        now: () => now,
      }),
    ).resolves.toBe(existing);

    expect(source.listAccounts).not.toHaveBeenCalled();
    expect(repository.sealRebalancePlan).not.toHaveBeenCalled();
  });

  it("같은 계산 경로로 PAPER 모드 계획을 별도 실행으로 저장한다", async () => {
    const snapshot = planningSnapshot("KR_NO_ACTION");
    const repository = repositoryMock(snapshot);

    await createAndStoreRebalancePlan({
      mode: "PAPER",
      repository: repository as never,
      source: sourceMock(),
      requestAuditContext: new TossRequestAuditContext(),
      selectedAccountSeq: undefined,
      now: () => now,
    });

    expect(repository.startRebalanceRun).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "PAPER" }),
    );
    expect(repository.sealRebalancePlan).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "PAPER", status: "NO_ACTION" }),
    );
  });
});

function repositoryMock(
  snapshot: ReturnType<typeof planningSnapshot>,
  overrides: Record<string, unknown> = {},
) {
  const sealRebalancePlan = vi
    .fn()
    .mockImplementation((input: SealRebalancePlanInput) =>
      Promise.resolve(storedRun(input.status, input, input.mode)),
    );
  return {
    latestDashboardState: vi.fn().mockResolvedValue({
      snapshot,
      activeTargetVersionId: targetId,
    }),
    startRebalanceRun: vi.fn().mockResolvedValue({ created: true, runId, status: "RUNNING" }),
    currentRebalanceIdentity: vi.fn().mockResolvedValue({
      snapshotId,
      snapshotDigest: snapshot.digest,
      targetConfigVersionId: targetId,
      snapshotTargetConfigVersionId: targetId,
    }),
    recordInstrumentValidation: vi.fn().mockResolvedValue({
      targetEligibility: "ELIGIBLE",
      tradeBlockedNow: false,
    }),
    sealRebalancePlan,
    failShadowRebalanceRun: vi.fn().mockResolvedValue(true),
    rebalanceRunById: vi.fn(),
    ...overrides,
  };
}

function sourceMock(overrides: Record<string, unknown> = {}) {
  return {
    listAccounts: vi.fn(),
    getHoldings: vi.fn(),
    getBuyingPower: vi.fn(),
    getPrices: vi.fn(),
    getOrderBook: vi.fn(),
    getPriceLimit: vi.fn(),
    getMarketCalendar: vi.fn(),
    getSellableQuantity: vi.fn(),
    getCommissionSchedule: vi.fn(),
    getUsdKrwRate: vi.fn(),
    getStocks: vi.fn(),
    getStockWarnings: vi.fn(),
    ...overrides,
  };
}

function planningSnapshot(mode: "US_BLOCKED" | "KR_NO_ACTION" | "KR_BUY") {
  const isUs = mode === "US_BLOCKED";
  const isBuy = mode === "KR_BUY";
  const symbol = isUs ? "AAPL" : "114800";
  const marketCountry = isUs ? "US" : "KR";
  const currency = isUs ? "USD" : "KRW";
  const holdingValue = isUs ? 100_000n : isBuy ? 50_000n : 90_000n;
  const managedCashMinor = isUs ? 0n : isBuy ? 50_000n : 10_000n;
  const securityTarget = isUs ? 10_000 : isBuy ? 8_000 : 9_000;
  const cashTarget = 10_000 - securityTarget;
  return {
    id: snapshotId,
    collectionRunId: "30000000-0000-4000-8000-000000000005",
    accountId,
    targetConfigVersionId: targetId,
    observedAt: now,
    persistedAt: now,
    validationStatus: "VERIFIED" as const,
    baseCurrency: "KRW",
    managedCashMinor,
    securitiesValueMinor: holdingValue,
    totalValueMinor: holdingValue + managedCashMinor,
    usdKrwRate: isUs ? "1000" : null,
    digest: "a".repeat(64),
    account: {
      id: accountId,
      broker: "toss",
      externalRefHmac: "b".repeat(64),
      maskedNumber: "***-test",
      accountTypeRaw: "BROKERAGE",
      firstSeenAt: now,
      lastSeenAt: now,
    },
    holdings: [
      {
        id: "30000000-0000-4000-8000-000000000006",
        snapshotId,
        marketCountry,
        symbol,
        name: symbol,
        currency,
        quantity: isUs ? "1" : isBuy ? "5" : "9",
        lastPrice: isUs ? "100" : "10000",
        averagePurchasePrice: isUs ? "100" : "10000",
        marketValue: holdingValue.toString(),
        marketValueKrwMinor: holdingValue,
        rawPayload: {},
      },
    ],
    buyingPower: [],
    prices: [
      {
        id: "30000000-0000-4000-8000-000000000007",
        snapshotId,
        requestAttemptId: "30000000-0000-4000-8000-000000000008",
        marketCountry,
        symbol,
        currency,
        lastPrice: isUs ? "100" : "10000",
        providerObservedAt: now,
        receivedAt: now,
      },
    ],
    marketCalendars: isUs
      ? []
      : [
          {
            id: "30000000-0000-4000-8000-000000000009",
            snapshotId,
            requestAttemptId: "30000000-0000-4000-8000-000000000010",
            marketCountry: "KR",
            requestedDate: new Date("2026-07-16T00:00:00.000Z"),
            calendar: {
              marketCountry: "KR",
              today: {
                date: "2026-07-16",
                sessions: [
                  {
                    kind: "REGULAR_MARKET",
                    startAt: "2026-07-16T00:00:00.000Z",
                    endAt: "2026-07-16T06:30:00.000Z",
                    auctionStartAt: "2026-07-16T06:20:00.000Z",
                    auctionEndAt: "2026-07-16T06:30:00.000Z",
                  },
                ],
              },
              previousBusinessDay: { date: "2026-07-15", sessions: [] },
              nextBusinessDay: { date: "2026-07-17", sessions: [] },
            },
            calendarSha256: "c".repeat(64),
            receivedAt: now,
          },
        ],
    targetConfigVersion: {
      id: targetId,
      configId: "30000000-0000-4000-8000-000000000011",
      version: 1,
      status: "ACTIVE" as const,
      contentHash: "d".repeat(64),
      appVersion: "0.1.0",
      source: {},
      cashPolicy:
        managedCashMinor === 0n
          ? { mode: "EXCLUDED", version: "CASH_V1" }
          : {
              mode: "FIXED_KRW",
              version: "CASH_V1",
              amountMinor: managedCashMinor.toString(),
            },
      createdAt: now,
      allocations: [
        allocation("SAFE", isUs ? 0 : securityTarget, isUs ? [] : [instrument()]),
        allocation("CORE", isUs ? securityTarget : 0, isUs ? [instrument()] : []),
        allocation("SATELLITE", 0, []),
        allocation("CASH", cashTarget, []),
      ],
    },
  };

  function instrument() {
    return {
      id: "30000000-0000-4000-8000-000000000012",
      allocationId: "30000000-0000-4000-8000-000000000013",
      configVersionId: targetId,
      validationId: null,
      marketCountry,
      listingMarket: isUs ? "NASDAQ" : "KOSPI",
      symbol,
      name: symbol,
      englishName: null,
      currency,
      withinAssetPoints: 10_000,
    };
  }
}

function allocation(assetKey: string, targetBasisPoints: number, instruments: unknown[]) {
  const drift = Math.min(500, Math.ceil(targetBasisPoints / 4));
  return {
    id: `30000000-0000-4000-8000-${assetKey.padEnd(12, "0")}`,
    configVersionId: targetId,
    assetKey,
    label: assetKey,
    targetBasisPoints,
    lowerBasisPoints: Math.max(0, targetBasisPoints - drift),
    upperBasisPoints: Math.min(10_000, targetBasisPoints + drift),
    bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
    compositionPolicy:
      assetKey === "CASH"
        ? { mode: "NONE", version: "CASH_V1" }
        : { mode: "PRESERVE_CURRENT", version: "PRESERVE_CURRENT_V1" },
    instruments,
  };
}

function storedRun(
  status: "NO_ACTION" | "PLANNED" | "BLOCKED",
  input?: SealRebalancePlanInput,
  mode: "SHADOW" | "PAPER" | "LIVE" = "SHADOW",
) {
  return {
    id: runId,
    accountId,
    snapshotId,
    snapshotDigest: "a".repeat(64),
    targetConfigVersionId: targetId,
    targetConfigContentHash: "d".repeat(64),
    mode,
    status,
    dedupeKey: "e".repeat(64),
    startedAt: now,
    completedAt: now,
    appVersion: "0.1.0",
    policyVersion: "SHADOW_PLAN_V1",
    errorCode: null,
    plan: {
      id: "30000000-0000-4000-8000-000000000014",
      runId,
      snapshotId,
      targetConfigVersionId: targetId,
      mode,
      status,
      canonicalVersion: "SHADOW_PLAN_V1",
      planHash: "f".repeat(64),
      returnPolicy: "BAND_EDGE",
      totalValueMinor: status === "BLOCKED" ? null : 100_000n,
      reasonCodes: input?.reasonCodes ?? ["NO_REBALANCE_NEEDED"],
      canonicalContent: "{}",
      assetDecisions: input?.assetDecisions ?? [],
      deferredBuyNeeds: input?.deferredBuyNeeds ?? [],
      projectedAllocations: input?.projectedAllocations ?? [],
      createdAt: now,
      orders: input?.orders ?? [],
    },
  };
}
