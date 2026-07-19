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
      totalManagedAssetsMinor: null,
      snapshotObservedAt: null,
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [],
      holdings: [],
      guidedRecommendations: guidedPortfolioRecommendations([]),
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
  const holdings = snapshot.holdings.map((holding) => ({
    instrumentKey: `${holding.marketCountry}:${holding.symbol}`,
    label: holding.name,
    description: `${holding.marketCountry} · ${holding.currency} · ${holding.quantity}주`,
    currentBasisPointHundredths:
      total === 0n ? 0 : Number((holding.marketValueKrwMinor * 1_000_000n) / total),
  }));
  return TargetSettingsSnapshotSchema.parse({
    state: activeVersion ? "CONFIGURED" : "NOT_CONFIGURED",
    accountLabel: snapshot.account.maskedNumber,
    totalManagedAssetsMinor: snapshot.totalValueMinor.toString(),
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
    holdings,
    guidedRecommendations: guidedPortfolioRecommendations(holdings),
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
  });
}

export function unavailableConsoleRecords(): ConsoleRecordsSnapshotContract {
  return ConsoleRecordsSnapshotSchema.parse({
    state: "UNAVAILABLE",
    records: [],
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
      readonly validationId: string | null;
      readonly marketCountry: string;
      readonly listingMarket: string | null;
      readonly symbol: string;
      readonly name: string;
      readonly englishName: string | null;
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
        validationId: instrument.validationId,
        marketCountry: instrument.marketCountry,
        listingMarket: instrument.listingMarket,
        symbol: instrument.symbol,
        name: instrument.name,
        englishName: instrument.englishName,
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

const approvedGuidedUniverse = [
  {
    instrumentKey: "KR:114260",
    name: "KODEX 국고채3년",
    assetClass: "SAFE" as const,
    role: "가격 변동을 낮추는 국내 국고채",
  },
  {
    instrumentKey: "KR:069500",
    name: "KODEX 200",
    assetClass: "CORE" as const,
    role: "한국 대표 기업에 분산 투자",
  },
  {
    instrumentKey: "KR:379800",
    name: "KODEX 미국S&P500",
    assetClass: "CORE" as const,
    role: "미국 대형주 전반에 분산 투자",
  },
  {
    instrumentKey: "KR:379810",
    name: "KODEX 미국나스닥100",
    assetClass: "CORE" as const,
    role: "미국 성장기업에 분산 투자",
  },
];

function guidedPortfolioRecommendations(
  holdings: readonly {
    readonly instrumentKey: string;
    readonly label: string;
    readonly description: string;
    readonly currentBasisPointHundredths: number;
  }[],
) {
  const modelKeys = new Set(approvedGuidedUniverse.map(({ instrumentKey }) => instrumentKey));
  const retiringHoldings = holdings.filter(({ instrumentKey }) => !modelKeys.has(instrumentKey));
  const memberships = [
    ...approvedGuidedUniverse.map(({ instrumentKey, assetClass }) => ({
      instrumentKey,
      assetClass,
    })),
    ...retiringHoldings.map(({ instrumentKey }) => ({
      instrumentKey,
      assetClass: "SATELLITE" as const,
    })),
  ];
  return [
    {
      profile: "STABLE" as const,
      title: "안정형",
      description: "손실 변동을 줄이는 것을 우선하고 국고채 비중을 높입니다.",
      safePercent: 60,
      corePercent: 40,
    },
    {
      profile: "BALANCED" as const,
      title: "균형형",
      description: "안정성과 장기 성장을 함께 고려하는 기본 추천입니다.",
      safePercent: 35,
      corePercent: 65,
    },
    {
      profile: "GROWTH" as const,
      title: "성장형",
      description: "장기 가격 변동을 감수하고 주식형 자산 비중을 높입니다.",
      safePercent: 15,
      corePercent: 85,
    },
  ].map((profile) => ({
    ...profile,
    instruments: approvedGuidedUniverse,
    memberships,
    retiringHoldings,
  }));
}
