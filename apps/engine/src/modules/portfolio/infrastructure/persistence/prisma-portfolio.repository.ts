import { createHash } from "node:crypto";

import {
  CheckOutcome,
  CollectionRunStatus,
  type Prisma,
  SnapshotValidationStatus,
  type DatabaseClient,
} from "@portfolio-rebalancer/database";

export interface StoredHoldingInput {
  readonly market: string;
  readonly symbol: string;
  readonly name: string;
  readonly currency: string;
  readonly quantity: string;
  readonly lastPrice: string;
  readonly averagePurchasePrice: string;
  readonly marketValue: string;
  readonly marketValueKrwMinor: bigint;
  readonly rawPayload: Prisma.InputJsonValue;
}

export interface RedactedResponseInput {
  readonly operationId: string;
  readonly ordinal: number;
  readonly receivedAt: Date;
  readonly body: Prisma.InputJsonValue;
}

export interface StoredBuyingPowerInput {
  readonly currency: "KRW" | "USD";
  readonly amount: string;
  readonly valueKrwMinor: bigint;
}

export interface CollectionLease {
  readonly owner: string;
  readonly fencingToken: bigint;
}

export interface StoredTargetAllocationInput {
  readonly assetKey: string;
  readonly label: string;
  readonly market: string;
  readonly symbol: string;
  readonly currency: string;
  readonly targetBasisPoints: number;
  readonly lowerBasisPoints: number;
  readonly upperBasisPoints: number;
  readonly bandPolicy:
    | { readonly mode: "AUTO"; readonly version: "MIXED_V1" }
    | {
        readonly mode: "CUSTOM";
        readonly version: string;
        readonly lowerBasisPoints: number;
        readonly upperBasisPoints: number;
      };
}

export interface StoredTargetDraftInput {
  readonly accountId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotDigest: string;
  readonly allocations: readonly StoredTargetAllocationInput[];
}

export interface ActivateTargetDraftInput {
  readonly accountId: string;
  readonly version: number;
}

export class PrismaPortfolioRepository {
  constructor(private readonly database: DatabaseClient) {}

  async acquireCollectionLease(owner: string): Promise<CollectionLease | null> {
    const acquired = await this.database.$queryRaw<readonly { fencingToken: bigint }[]>`
      INSERT INTO "runtime_lease" ("key", "owner", "acquired_at", "expires_at", "fencing_token")
      VALUES ('toss-portfolio-collection', ${owner}::uuid, NOW(), NOW() + INTERVAL '2 minutes', 1)
      ON CONFLICT ("key") DO UPDATE
      SET "owner" = EXCLUDED."owner",
          "acquired_at" = EXCLUDED."acquired_at",
          "expires_at" = EXCLUDED."expires_at",
          "fencing_token" = "runtime_lease"."fencing_token" + 1
      WHERE "runtime_lease"."expires_at" <= NOW()
      RETURNING "fencing_token" AS "fencingToken"
    `;
    const row = acquired[0];
    return row ? { owner, fencingToken: row.fencingToken } : null;
  }

  async heartbeatCollectionLease(lease: CollectionLease): Promise<boolean> {
    const renewed = await this.database.$executeRaw`
      UPDATE "runtime_lease"
      SET "expires_at" = NOW() + INTERVAL '2 minutes'
      WHERE "key" = 'toss-portfolio-collection'
        AND "owner" = ${lease.owner}::uuid
        AND "fencing_token" = ${lease.fencingToken}
        AND "expires_at" > NOW()
    `;
    return renewed === 1;
  }

  async releaseCollectionLease(lease: CollectionLease): Promise<void> {
    await this.database.runtimeLease.deleteMany({
      where: {
        key: "toss-portfolio-collection",
        owner: lease.owner,
        fencingToken: lease.fencingToken,
      },
    });
  }

  async upsertAccount(input: {
    readonly externalRefHmac: string;
    readonly maskedNumber: string;
    readonly accountTypeRaw: string;
    readonly seenAt: Date;
  }) {
    return this.database.brokerAccount.upsert({
      where: {
        broker_externalRefHmac: { broker: "toss", externalRefHmac: input.externalRefHmac },
      },
      create: {
        broker: "toss",
        externalRefHmac: input.externalRefHmac,
        maskedNumber: input.maskedNumber,
        accountTypeRaw: input.accountTypeRaw,
        firstSeenAt: input.seenAt,
        lastSeenAt: input.seenAt,
      },
      update: {
        maskedNumber: input.maskedNumber,
        accountTypeRaw: input.accountTypeRaw,
        lastSeenAt: input.seenAt,
      },
    });
  }

  async startCollection(accountId: string, startedAt: Date, adapterVersion: string) {
    return this.database.collectionRun.create({
      data: {
        accountId,
        status: CollectionRunStatus.RUNNING,
        startedAt,
        appVersion: "0.1.0",
        adapterVersion,
      },
    });
  }

  async failCollection(runId: string, errorCode: string, completedAt: Date): Promise<void> {
    await this.database.collectionRun.update({
      where: { id: runId },
      data: { status: CollectionRunStatus.FAILED, errorCode, completedAt },
    });
  }

  async completeCollection(input: {
    readonly runId: string;
    readonly accountId: string;
    readonly observedAt: Date;
    readonly totalValueMinor: bigint;
    readonly usdKrwRate: string | null;
    readonly holdings: readonly StoredHoldingInput[];
    readonly buyingPower: readonly StoredBuyingPowerInput[];
    readonly rawResponses: readonly RedactedResponseInput[];
    readonly lease: CollectionLease;
  }): Promise<boolean> {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          observedAt: input.observedAt.toISOString(),
          holdings: input.holdings.map(({ rawPayload: _rawPayload, ...holding }) => ({
            ...holding,
            marketValueKrwMinor: holding.marketValueKrwMinor.toString(),
          })),
          buyingPower: input.buyingPower.map((item) => ({
            ...item,
            valueKrwMinor: item.valueKrwMinor.toString(),
          })),
        }),
      )
      .digest("hex");

    return this.database.$transaction(async (transaction) => {
      const activeLease = await transaction.$queryRaw<readonly { fencingToken: bigint }[]>`
        SELECT "fencing_token" AS "fencingToken"
        FROM "runtime_lease"
        WHERE "key" = 'toss-portfolio-collection'
          AND "owner" = ${input.lease.owner}::uuid
          AND "fencing_token" = ${input.lease.fencingToken}
          AND "expires_at" > NOW()
        FOR UPDATE
      `;
      if (activeLease.length !== 1) return false;

      const activeTarget = await transaction.targetConfigVersion.findFirst({
        where: { config: { accountId: input.accountId }, status: "ACTIVE" },
        select: { id: true },
      });
      await transaction.rawBrokerResponse.createMany({
        data: input.rawResponses.map((response) => ({
          collectionRunId: input.runId,
          operationId: response.operationId,
          ordinal: response.ordinal,
          requestId: null,
          httpStatus: 200,
          receivedAt: response.receivedAt,
          redactedBody: response.body,
          bodySha256: createHash("sha256").update(JSON.stringify(response.body)).digest("hex"),
          redactionVersion: "v1",
        })),
      });
      await transaction.portfolioSnapshot.create({
        data: {
          collectionRunId: input.runId,
          accountId: input.accountId,
          targetConfigVersionId: activeTarget?.id ?? null,
          observedAt: input.observedAt,
          validationStatus: SnapshotValidationStatus.VERIFIED,
          baseCurrency: "KRW",
          managedCashMinor: null,
          totalValueMinor: input.totalValueMinor,
          usdKrwRate: input.usdKrwRate,
          digest,
          holdings: { create: [...input.holdings] },
          buyingPower: {
            create: input.buyingPower.map((item) => ({
              ...item,
              observedAt: input.observedAt,
              valuationEligible: false,
            })),
          },
          checks: {
            create: [
              {
                ruleCode: "BROKER_DATA_SCHEMA",
                outcome: CheckOutcome.PASSED,
                detail: {
                  message: "토스 계좌·보유·매수 가능 금액 응답의 런타임 스키마를 검증했습니다.",
                },
                checkedAt: input.observedAt,
              },
            ],
          },
        },
      });
      await transaction.collectionRun.update({
        where: { id: input.runId },
        data: {
          status: CollectionRunStatus.SUCCEEDED,
          completedAt: input.observedAt,
          errorCode: null,
        },
      });
      return true;
    });
  }

  latestSnapshot(accountId: string) {
    return this.database.portfolioSnapshot.findFirst({
      where: { accountId },
      orderBy: { observedAt: "desc" },
      include: {
        account: true,
        holdings: { orderBy: [{ market: "asc" }, { symbol: "asc" }] },
        buyingPower: { orderBy: { currency: "asc" } },
        targetConfigVersion: {
          include: { allocations: { orderBy: { assetKey: "asc" } } },
        },
      },
    });
  }

  async latestDashboardState() {
    const accountId = await this.latestCollectionAccountId();
    if (!accountId) return { snapshot: null, activeTargetVersionId: null };
    const snapshot = await this.latestSnapshot(accountId);
    if (!snapshot) return { snapshot: null, activeTargetVersionId: null };
    const active = await this.database.targetConfigVersion.findFirst({
      where: { config: { accountId: snapshot.accountId }, status: "ACTIVE" },
      select: { id: true },
    });
    return { snapshot, activeTargetVersionId: active?.id ?? null };
  }

  async targetSettingsState() {
    const accountId = await this.latestCollectionAccountId();
    if (!accountId) return { snapshot: null, activeVersion: null, draftVersion: null };
    const snapshot = await this.latestSnapshot(accountId);
    if (!snapshot) return { snapshot: null, activeVersion: null, draftVersion: null };
    const [activeVersion, draftVersion] = await Promise.all([
      this.database.targetConfigVersion.findFirst({
        where: { config: { accountId: snapshot.accountId }, status: "ACTIVE" },
        orderBy: { version: "desc" },
        include: { allocations: { orderBy: { assetKey: "asc" } } },
      }),
      this.database.targetConfigVersion.findFirst({
        where: { config: { accountId: snapshot.accountId }, status: "DRAFT" },
        orderBy: { version: "desc" },
        include: { allocations: { orderBy: { assetKey: "asc" } } },
      }),
    ]);
    return { snapshot, activeVersion, draftVersion };
  }

  async createTargetDraft(input: StoredTargetDraftInput) {
    const canonical = [...input.allocations]
      .sort((left, right) =>
        left.assetKey < right.assetKey ? -1 : left.assetKey > right.assetKey ? 1 : 0,
      )
      .map((allocation) => ({
        assetKey: allocation.assetKey,
        label: allocation.label,
        market: allocation.market,
        symbol: allocation.symbol,
        currency: allocation.currency,
        targetBasisPoints: allocation.targetBasisPoints,
        lowerBasisPoints: allocation.lowerBasisPoints,
        upperBasisPoints: allocation.upperBasisPoints,
        bandPolicy: allocation.bandPolicy,
      }));
    const source = {
      version: 2,
      managedCashMinor: null,
      sourceSnapshotId: input.sourceSnapshotId,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      allocations: canonical,
    };
    const contentHash = createHash("sha256").update(JSON.stringify(source)).digest("hex");

    return this.database.$transaction(
      async (transaction) => {
        const latestSnapshot = await transaction.portfolioSnapshot.findFirst({
          where: { accountId: input.accountId },
          orderBy: { observedAt: "desc" },
          select: { id: true, digest: true },
        });
        if (
          !latestSnapshot ||
          latestSnapshot.id !== input.sourceSnapshotId ||
          latestSnapshot.digest !== input.sourceSnapshotDigest
        ) {
          return null;
        }
        const config = await transaction.targetConfig.upsert({
          where: { accountId: input.accountId },
          create: { accountId: input.accountId },
          update: {},
        });
        const existing = await transaction.targetConfigVersion.findUnique({
          where: { configId_contentHash: { configId: config.id, contentHash } },
          include: { allocations: { orderBy: { assetKey: "asc" } } },
        });
        await transaction.targetConfigVersion.updateMany({
          where: {
            configId: config.id,
            status: "DRAFT",
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { status: "RETIRED" },
        });
        if (existing) {
          if (existing.status === "ACTIVE" || existing.status === "DRAFT") return existing;
          return transaction.targetConfigVersion.update({
            where: { id: existing.id },
            data: { status: "DRAFT" },
            include: { allocations: { orderBy: { assetKey: "asc" } } },
          });
        }

        const latest = await transaction.targetConfigVersion.aggregate({
          where: { configId: config.id },
          _max: { version: true },
        });
        return transaction.targetConfigVersion.create({
          data: {
            configId: config.id,
            version: (latest._max.version ?? 0) + 1,
            status: "DRAFT",
            contentHash,
            appVersion: "0.1.0",
            source,
            allocations: {
              create: canonical.map((allocation) => ({
                assetKey: allocation.assetKey,
                label: allocation.label,
                targetBasisPoints: allocation.targetBasisPoints,
                lowerBasisPoints: allocation.lowerBasisPoints,
                upperBasisPoints: allocation.upperBasisPoints,
                bandPolicy: allocation.bandPolicy,
                instruments: {
                  create: {
                    market: allocation.market,
                    symbol: allocation.symbol,
                    currency: allocation.currency,
                    withinAssetPoints: 10_000,
                  },
                },
              })),
            },
          },
          include: { allocations: { orderBy: { assetKey: "asc" } } },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  activateTargetDraft(input: ActivateTargetDraftInput) {
    return this.database.$transaction(
      async (transaction) => {
        const latestSnapshot = await transaction.portfolioSnapshot.findFirst({
          where: { accountId: input.accountId },
          orderBy: { observedAt: "desc" },
          select: { id: true, digest: true },
        });
        const target = await transaction.targetConfigVersion.findFirst({
          where: { config: { accountId: input.accountId }, version: input.version },
          include: { allocations: { orderBy: { assetKey: "asc" } } },
        });
        if (
          !latestSnapshot ||
          !target ||
          (target.status !== "DRAFT" && target.status !== "ACTIVE")
        ) {
          return null;
        }
        if (!targetSourceMatchesSnapshot(target.source, latestSnapshot.id, latestSnapshot.digest)) {
          return null;
        }
        if (target.status === "ACTIVE") return target;

        await transaction.targetConfigVersion.updateMany({
          where: { configId: target.configId, status: "ACTIVE", id: { not: target.id } },
          data: { status: "RETIRED" },
        });
        return transaction.targetConfigVersion.update({
          where: { id: target.id },
          data: { status: "ACTIVE" },
          include: { allocations: { orderBy: { assetKey: "asc" } } },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async latestCollectionAccountId(): Promise<string | null> {
    const latest = await this.database.collectionRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { accountId: true },
    });
    return latest?.accountId ?? null;
  }

  recentCollectionRecords(accountId: string, limit: number) {
    return this.database.collectionRun.findMany({
      where: { accountId },
      take: limit,
      orderBy: { startedAt: "desc" },
      include: {
        snapshot: {
          select: {
            observedAt: true,
            validationStatus: true,
            checks: { select: { ruleCode: true, outcome: true }, orderBy: { ruleCode: "asc" } },
          },
        },
      },
    });
  }
}

function targetSourceMatchesSnapshot(
  source: Prisma.JsonValue,
  snapshotId: string,
  snapshotDigest: string,
): boolean {
  if (source === null || Array.isArray(source) || typeof source !== "object") return false;
  const record = source as Record<string, unknown>;
  return record.sourceSnapshotId === snapshotId && record.sourceSnapshotDigest === snapshotDigest;
}
