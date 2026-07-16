import {
  ConsoleRecordsSnapshotSchema,
  TargetSettingsSnapshotSchema,
  type ConsoleRecordsSnapshotContract,
  type TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";

export async function getTargetSettings(
  repository: PrismaPortfolioRepository,
): Promise<TargetSettingsSnapshotContract> {
  const { snapshot, activeVersion, draftVersion } = await repository.targetSettingsState();
  if (!snapshot) {
    return TargetSettingsSnapshotSchema.parse({
      state: "NO_SNAPSHOT",
      accountLabel: null,
      snapshotObservedAt: null,
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [],
      holdings: [],
      liveOrdersEnabled: false,
    });
  }

  const total = snapshot.totalValueMinor;
  const cash = snapshot.managedCashMinor ?? null;
  const editableVersion = draftVersion ?? activeVersion;
  const holdingValues = new Map(
    snapshot.holdings.map((holding) => [
      `${holding.marketCountry}:${holding.symbol}`,
      holding.marketValueKrwMinor,
    ]),
  );
  return TargetSettingsSnapshotSchema.parse({
    state: activeVersion ? "CONFIGURED" : "NOT_CONFIGURED",
    accountLabel: snapshot.account.maskedNumber,
    snapshotObservedAt: snapshot.observedAt.toISOString(),
    snapshotTargetVersion: snapshot.targetConfigVersion?.version ?? null,
    activeVersion: activeVersion ? presentVersion(activeVersion) : null,
    draftVersion: draftVersion ? presentVersion(draftVersion) : null,
    requiresCollection:
      activeVersion !== null && activeVersion.id !== snapshot.targetConfigVersionId,
    assets: targetClassAssets().map((asset) => {
      if (asset.assetKey === "CASH") {
        return {
          ...asset,
          description:
            cash === null
              ? "평가에 포함할 관리 현금을 아직 선택하지 않았습니다."
              : `현재 스냅샷 관리 현금 ${cash.toLocaleString("ko-KR")}원`,
          currentBasisPointHundredths:
            cash === null ? null : total === 0n ? 0 : Number((cash * 1_000_000n) / total),
        };
      }
      const configured = editableVersion?.allocations.find(
        ({ assetKey }) => assetKey === asset.assetKey,
      );
      if (!configured) return { ...asset, currentBasisPointHundredths: null };
      const valueMinor = configured.instruments.reduce(
        (sum, instrument) =>
          sum + (holdingValues.get(`${instrument.marketCountry}:${instrument.symbol}`) ?? 0n),
        0n,
      );
      return {
        ...asset,
        currentBasisPointHundredths: total === 0n ? 0 : Number((valueMinor * 1_000_000n) / total),
      };
    }),
    holdings: snapshot.holdings.map((holding) => ({
      instrumentKey: `${holding.marketCountry}:${holding.symbol}`,
      label: holding.name,
      description: `${holding.marketCountry} · ${holding.currency} · ${holding.quantity}주`,
      currentBasisPointHundredths:
        total === 0n ? 0 : Number((holding.marketValueKrwMinor * 1_000_000n) / total),
    })),
    liveOrdersEnabled: false,
  });
}

export async function getConsoleRecords(
  repository: PrismaPortfolioRepository,
): Promise<ConsoleRecordsSnapshotContract> {
  const accountId = await repository.latestCollectionAccountId();
  const records = accountId ? await repository.recentCollectionRecords(accountId, 20) : [];
  return ConsoleRecordsSnapshotSchema.parse({
    state: "READY",
    records: records.map((record) => ({
      id: record.id,
      type: "COLLECTION",
      status: record.status,
      startedAt: record.startedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      observedAt: record.snapshot?.observedAt.toISOString() ?? null,
      validationStatus: record.snapshot?.validationStatus ?? null,
      errorCode: record.errorCode,
      checks: record.snapshot?.checks ?? [],
    })),
    orderLedgerState: "NOT_IMPLEMENTED",
    liveOrdersEnabled: false,
  });
}

export function unavailableConsoleRecords(): ConsoleRecordsSnapshotContract {
  return ConsoleRecordsSnapshotSchema.parse({
    state: "UNAVAILABLE",
    records: [],
    orderLedgerState: "NOT_IMPLEMENTED",
    liveOrdersEnabled: false,
  });
}

function presentVersion(version: {
  readonly version: number;
  readonly status: "DRAFT" | "ACTIVE" | "RETIRED";
  readonly createdAt: Date;
  readonly cashPolicy: unknown;
  readonly allocations: readonly {
    readonly assetKey: string;
    readonly label: string;
    readonly targetBasisPoints: number;
    readonly lowerBasisPoints: number;
    readonly upperBasisPoints: number;
    readonly bandPolicy: unknown;
    readonly compositionPolicy: unknown;
    readonly instruments: readonly {
      readonly marketCountry: string;
      readonly listingMarket: string | null;
      readonly symbol: string;
      readonly currency: string;
      readonly withinAssetPoints: number;
    }[];
  }[];
}) {
  return {
    version: version.version,
    status: version.status,
    createdAt: version.createdAt.toISOString(),
    cashPolicy: version.cashPolicy,
    allocations: version.allocations.map((allocation) => ({
      assetKey: allocation.assetKey,
      label: allocation.label,
      targetBasisPoints: allocation.targetBasisPoints,
      lowerBasisPoints: allocation.lowerBasisPoints,
      upperBasisPoints: allocation.upperBasisPoints,
      bandPolicy: allocation.bandPolicy,
      compositionPolicy: allocation.compositionPolicy,
      instruments: allocation.instruments.map((instrument) => ({
        instrumentKey: `${instrument.marketCountry}:${instrument.symbol}`,
        marketCountry: instrument.marketCountry,
        listingMarket: instrument.listingMarket,
        symbol: instrument.symbol,
        currency: instrument.currency,
        withinAssetPoints: instrument.withinAssetPoints,
      })),
    })),
  };
}

function targetClassAssets() {
  return [
    {
      assetKey: "SAFE" as const,
      label: "안전자산",
      description: "채권·현금성 등 변동성 완충 자산",
    },
    {
      assetKey: "CORE" as const,
      label: "핵심 공격자산",
      description: "장기 성장을 담당하는 광범위 핵심 자산",
    },
    {
      assetKey: "SATELLITE" as const,
      label: "위성 공격자산",
      description: "개별주·테마 등 변동성이 큰 보조 자산",
    },
    {
      assetKey: "CASH" as const,
      label: "관리 현금",
      description: "리밸런싱에 포함할 관리 현금",
    },
  ];
}
