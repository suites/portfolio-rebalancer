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
      liveOrdersEnabled: false,
    });
  }

  const total = snapshot.totalValueMinor;
  return TargetSettingsSnapshotSchema.parse({
    state: activeVersion ? "CONFIGURED" : "NOT_CONFIGURED",
    accountLabel: snapshot.account.maskedNumber,
    snapshotObservedAt: snapshot.observedAt.toISOString(),
    snapshotTargetVersion: snapshot.targetConfigVersion?.version ?? null,
    activeVersion: activeVersion ? presentVersion(activeVersion) : null,
    draftVersion: draftVersion ? presentVersion(draftVersion) : null,
    requiresCollection:
      activeVersion !== null && activeVersion.id !== snapshot.targetConfigVersionId,
    assets: snapshot.holdings.map((holding) => ({
      assetKey: `${holding.market}:${holding.symbol}`,
      label: holding.name,
      description: `${holding.market} · ${holding.currency} · ${holding.quantity}주`,
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
  readonly allocations: readonly {
    readonly assetKey: string;
    readonly label: string;
    readonly targetBasisPoints: number;
    readonly lowerBasisPoints: number;
    readonly upperBasisPoints: number;
    readonly bandPolicy: unknown;
  }[];
}) {
  return {
    version: version.version,
    status: version.status,
    createdAt: version.createdAt.toISOString(),
    allocations: version.allocations.map((allocation) => ({
      assetKey: allocation.assetKey,
      label: allocation.label,
      targetBasisPoints: allocation.targetBasisPoints,
      lowerBasisPoints: allocation.lowerBasisPoints,
      upperBasisPoints: allocation.upperBasisPoints,
      bandPolicy: allocation.bandPolicy,
    })),
  };
}
