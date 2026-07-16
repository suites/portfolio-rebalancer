import { createHash } from "node:crypto";

import {
  CheckOutcome,
  CollectionRunStatus,
  type Prisma,
  SnapshotValidationStatus,
  type DatabaseClient,
} from "@portfolio-rebalancer/database";
import { TargetStoredCashPolicySchema } from "@portfolio-rebalancer/contracts";

export interface StoredHoldingInput {
  readonly marketCountry: string;
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

export type StoredBrokerRequestAttemptInput = {
  readonly workflowType: string;
  readonly correlationId: string;
  readonly collectionRunId: string | null;
  readonly operationId: string;
  readonly ordinal: number;
  readonly attempt: number;
  readonly rateLimitGroup: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly requestId: string | null;
  readonly rateLimitLimit: number | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetSeconds: number | null;
  readonly retryAfterSeconds: number | null;
  readonly redactedRequestSummary: Prisma.InputJsonObject;
} & (
  | {
      readonly outcome: "SUCCEEDED";
      readonly httpStatus: number;
      readonly safeErrorCode: null;
    }
  | {
      readonly outcome: "HTTP_ERROR";
      readonly httpStatus: number;
      readonly safeErrorCode: string;
    }
  | {
      readonly outcome: "TIMEOUT" | "NETWORK_ERROR";
      readonly httpStatus: null;
      readonly safeErrorCode: string;
    }
  | {
      readonly outcome: "SCHEMA_ERROR";
      readonly httpStatus: number;
      readonly safeErrorCode: string;
    }
);

export interface StoredBuyingPowerInput {
  readonly currency: "KRW" | "USD";
  readonly amount: string;
  readonly valueKrwMinor: bigint;
}

export interface StoredInstrumentValidationInput {
  readonly requestedMarketCountry: "KR" | "US";
  readonly requestedSymbol: string;
  readonly providerApiVersion: string;
  readonly marketCountry: "KR" | "US";
  readonly symbol: string;
  readonly listingMarket: string;
  readonly name: string;
  readonly englishName: string | null;
  readonly isinCode: string;
  readonly currency: "KRW" | "USD";
  readonly securityType: string;
  readonly isCommonShare: boolean;
  readonly listingStatus: string;
  readonly listDate: string | null;
  readonly delistDate: string | null;
  readonly sharesOutstanding: string;
  readonly leverageFactor: string | null;
  readonly liquidationTrading: boolean | null;
  readonly nxtSupported: boolean | null;
  readonly krxTradingSuspended: boolean | null;
  readonly nxtTradingSuspended: boolean | null;
  readonly targetEligibility: "ELIGIBLE" | "BLOCKED";
  readonly targetReasonCodes: readonly string[];
  readonly tradeBlockedNow: boolean;
  readonly tradeReasonCodes: readonly string[];
  readonly requiresOrderRevalidation: boolean;
  readonly stockPayload: unknown;
  readonly warningsPayload: unknown;
  readonly observedAt: Date;
}

export interface CollectionLease {
  readonly owner: string;
  readonly fencingToken: bigint;
}

export interface StoredTargetInstrumentInput {
  readonly validationId: string | null;
  readonly marketCountry: string;
  readonly listingMarket: string | null;
  readonly symbol: string;
  readonly name: string;
  readonly englishName: string | null;
  readonly currency: string;
  readonly withinAssetPoints: number;
}

export type StoredCashPolicy =
  | { readonly mode: "UNSET"; readonly version: string }
  | { readonly mode: "EXCLUDED"; readonly version: "CASH_V1" }
  | {
      readonly mode: "FIXED_KRW";
      readonly version: "CASH_V1";
      readonly amountMinor: string;
    };

export type StoredCompositionPolicy =
  | { readonly mode: "PRESERVE_CURRENT"; readonly version: "PRESERVE_CURRENT_V1" }
  | { readonly mode: "EQUAL"; readonly version: "EQUAL_V1" }
  | { readonly mode: "NONE"; readonly version: "CASH_V1" }
  | { readonly mode: "LEGACY_SINGLE"; readonly version: string };

export interface StoredTargetAllocationInput {
  readonly assetKey: string;
  readonly label: string;
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
  readonly compositionPolicy: StoredCompositionPolicy;
  readonly instruments: readonly StoredTargetInstrumentInput[];
}

export interface StoredTargetDraftInput {
  readonly accountId: string;
  readonly sourceSnapshotId: string;
  readonly sourceSnapshotDigest: string;
  readonly cashPolicy: StoredCashPolicy;
  readonly allocations: readonly StoredTargetAllocationInput[];
}

export interface ActivateTargetDraftInput {
  readonly accountId: string;
  readonly version: number;
}

export class PrismaPortfolioRepository {
  constructor(private readonly database: DatabaseClient) {}

  appendBrokerRequestAttempt(input: StoredBrokerRequestAttemptInput) {
    return this.database.brokerRequestAttempt.create({
      data: {
        workflowType: input.workflowType,
        correlationId: input.correlationId,
        collectionRunId: input.collectionRunId,
        operationId: input.operationId,
        ordinal: input.ordinal,
        attempt: input.attempt,
        rateLimitGroup: input.rateLimitGroup,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        outcome: input.outcome,
        httpStatus: input.httpStatus,
        requestId: input.requestId,
        rateLimitLimit: input.rateLimitLimit,
        rateLimitRemaining: input.rateLimitRemaining,
        rateLimitResetSeconds: input.rateLimitResetSeconds,
        retryAfterSeconds: input.retryAfterSeconds,
        safeErrorCode: input.safeErrorCode,
        redactedRequestSummary: normalizedJson(input.redactedRequestSummary),
      },
    });
  }

  recordInstrumentValidation(input: StoredInstrumentValidationInput) {
    return this.database.$transaction(async (transaction) => {
      const stockPayload = normalizedJson(input.stockPayload);
      const warningsPayload = normalizedJson(input.warningsPayload);
      const catalog = await transaction.instrumentCatalog.upsert({
        where: {
          broker_marketCountry_symbol: {
            broker: "toss",
            marketCountry: input.marketCountry,
            symbol: input.symbol,
          },
        },
        create: {
          broker: "toss",
          marketCountry: input.marketCountry,
          symbol: input.symbol,
          listingMarket: input.listingMarket,
          name: input.name,
          englishName: input.englishName,
          isinCode: input.isinCode,
          currency: input.currency,
          securityType: input.securityType,
          listingStatus: input.listingStatus,
        },
        update: {
          listingMarket: input.listingMarket,
          name: input.name,
          englishName: input.englishName,
          isinCode: input.isinCode,
          currency: input.currency,
          securityType: input.securityType,
          listingStatus: input.listingStatus,
        },
      });
      const stockPayloadSha256 = createHash("sha256")
        .update(JSON.stringify(stockPayload))
        .digest("hex");
      const warningsPayloadSha256 = createHash("sha256")
        .update(JSON.stringify(warningsPayload))
        .digest("hex");
      const validation = await transaction.instrumentValidation.create({
        data: {
          catalogId: catalog.id,
          requestedMarketCountry: input.requestedMarketCountry,
          requestedSymbol: input.requestedSymbol,
          providerApiVersion: input.providerApiVersion,
          marketCountry: input.marketCountry,
          symbol: input.symbol,
          listingMarket: input.listingMarket,
          name: input.name,
          englishName: input.englishName,
          isinCode: input.isinCode,
          currency: input.currency,
          securityType: input.securityType,
          isCommonShare: input.isCommonShare,
          listingStatus: input.listingStatus,
          listDate: input.listDate,
          delistDate: input.delistDate,
          sharesOutstanding: input.sharesOutstanding,
          leverageFactor: input.leverageFactor,
          liquidationTrading: input.liquidationTrading,
          nxtSupported: input.nxtSupported,
          krxTradingSuspended: input.krxTradingSuspended,
          nxtTradingSuspended: input.nxtTradingSuspended,
          targetEligibility: input.targetEligibility,
          targetReasonCodes: [...input.targetReasonCodes],
          tradeBlockedNow: input.tradeBlockedNow,
          tradeReasonCodes: [...input.tradeReasonCodes],
          requiresOrderRevalidation: input.requiresOrderRevalidation,
          stockPayload,
          warningsPayload,
          stockPayloadSha256,
          warningsPayloadSha256,
          observedAt: input.observedAt,
        },
      });
      await transaction.instrumentCatalog.update({
        where: { id: catalog.id },
        data: { lastValidationId: validation.id },
      });
      return validation;
    });
  }

  searchInstrumentCatalog(query: string, limit: number) {
    return this.database.instrumentCatalog.findMany({
      where: {
        OR: [
          { symbol: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { englishName: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }],
      take: limit,
      include: { lastValidation: true },
    });
  }

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
    readonly securitiesValueMinor: bigint;
    readonly usdKrwRate: string | null;
    readonly holdings: readonly StoredHoldingInput[];
    readonly buyingPower: readonly StoredBuyingPowerInput[];
    readonly rawResponses: readonly RedactedResponseInput[];
    readonly lease: CollectionLease;
  }): Promise<boolean> {
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
        select: { id: true, cashPolicy: true },
      });
      const managedCashMinor = resolveManagedCashMinor(activeTarget?.cashPolicy);
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            observedAt: input.observedAt.toISOString(),
            targetConfigVersionId: activeTarget?.id ?? null,
            holdings: input.holdings.map(({ rawPayload: _rawPayload, ...holding }) => ({
              ...holding,
              marketValueKrwMinor: holding.marketValueKrwMinor.toString(),
            })),
            buyingPower: input.buyingPower.map((item) => ({
              ...item,
              valueKrwMinor: item.valueKrwMinor.toString(),
            })),
            managedCashMinor: managedCashMinor?.toString() ?? null,
            securitiesValueMinor: input.securitiesValueMinor.toString(),
          }),
        )
        .digest("hex");
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
          managedCashMinor,
          securitiesValueMinor: input.securitiesValueMinor,
          totalValueMinor: input.securitiesValueMinor + (managedCashMinor ?? 0n),
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
        holdings: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
        buyingPower: { orderBy: { currency: "asc" } },
        targetConfigVersion: {
          include: {
            allocations: {
              orderBy: { assetKey: "asc" },
              include: {
                instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
              },
            },
          },
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
        include: {
          allocations: {
            orderBy: { assetKey: "asc" },
            include: {
              instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
            },
          },
        },
      }),
      this.database.targetConfigVersion.findFirst({
        where: { config: { accountId: snapshot.accountId }, status: "DRAFT" },
        orderBy: { version: "desc" },
        include: {
          allocations: {
            orderBy: { assetKey: "asc" },
            include: {
              instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
            },
          },
        },
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
        targetBasisPoints: allocation.targetBasisPoints,
        lowerBasisPoints: allocation.lowerBasisPoints,
        upperBasisPoints: allocation.upperBasisPoints,
        bandPolicy: allocation.bandPolicy,
        compositionPolicy: allocation.compositionPolicy,
        instruments: [...allocation.instruments].sort((left, right) => {
          const leftKey = `${left.marketCountry}:${left.symbol}`;
          const rightKey = `${right.marketCountry}:${right.symbol}`;
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
      }));
    const source: Prisma.InputJsonObject = {
      version: 6,
      cashPolicy: { ...input.cashPolicy },
      sourceSnapshotId: input.sourceSnapshotId,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      allocations: canonical.map((allocation) => ({
        ...allocation,
        bandPolicy: { ...allocation.bandPolicy },
        compositionPolicy: { ...allocation.compositionPolicy },
        instruments: allocation.instruments.map((instrument) => ({ ...instrument })),
      })),
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
          include: {
            allocations: {
              orderBy: { assetKey: "asc" },
              include: {
                instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
              },
            },
          },
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
            include: {
              allocations: {
                orderBy: { assetKey: "asc" },
                include: {
                  instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
                },
              },
            },
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
            cashPolicy: input.cashPolicy,
            allocations: {
              create: canonical.map((allocation) => ({
                assetKey: allocation.assetKey,
                label: allocation.label,
                targetBasisPoints: allocation.targetBasisPoints,
                lowerBasisPoints: allocation.lowerBasisPoints,
                upperBasisPoints: allocation.upperBasisPoints,
                bandPolicy: { ...allocation.bandPolicy },
                compositionPolicy: { ...allocation.compositionPolicy },
                ...(allocation.instruments.length === 0
                  ? {}
                  : {
                      instruments: {
                        create: allocation.instruments.map((instrument) => ({ ...instrument })),
                      },
                    }),
              })),
            },
          },
          include: {
            allocations: {
              orderBy: { assetKey: "asc" },
              include: {
                instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
              },
            },
          },
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
          include: {
            allocations: {
              orderBy: { assetKey: "asc" },
              include: {
                instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
              },
            },
          },
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
          include: {
            allocations: {
              orderBy: { assetKey: "asc" },
              include: {
                instruments: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
              },
            },
          },
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

function resolveManagedCashMinor(cashPolicy: Prisma.JsonValue | undefined): bigint | null {
  const parsed = TargetStoredCashPolicySchema.parse(
    cashPolicy ?? { mode: "UNSET", version: "NO_ACTIVE_TARGET" },
  );
  switch (parsed.mode) {
    case "UNSET":
      return null;
    case "EXCLUDED":
      return 0n;
    case "FIXED_KRW":
      return BigInt(parsed.amountMinor);
  }
}

function normalizedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
