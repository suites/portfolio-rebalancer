import { createHash } from "node:crypto";

import {
  CheckOutcome,
  CollectionRunStatus,
  type Prisma,
  SnapshotValidationStatus,
  type DatabaseClient,
} from "@portfolio-rebalancer/database";
import { TargetStoredCashPolicySchema } from "@portfolio-rebalancer/contracts";
import type { MarketCalendar } from "@portfolio-rebalancer/broker";

import { CollectionError } from "../../domain/collection.error";

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
  readonly requestId?: string | null;
  readonly httpStatus?: number;
  readonly receivedAt: Date;
  readonly body: unknown;
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

export type StoredBrokerResponseValidationInput = {
  readonly requestAttemptId: string;
  readonly operationId: string;
  readonly redactedBody: unknown;
  readonly validatedAt: Date;
} & (
  | {
      readonly outcome: "PASSED";
      readonly safeErrorCode: null;
    }
  | {
      readonly outcome: "SCHEMA_ERROR";
      readonly safeErrorCode: string;
    }
);

export interface StoredBuyingPowerInput {
  readonly currency: "KRW" | "USD";
  readonly amount: string;
  readonly valueKrwMinor: bigint;
}

export interface StoredPriceSnapshotInput {
  readonly marketCountry: "KR" | "US";
  readonly symbol: string;
  readonly currency: "KRW" | "USD";
  readonly lastPrice: string;
  readonly providerObservedAt: Date | null;
  readonly receivedAt: Date;
  readonly requestAttemptId: string;
}

export interface StoredMarketCalendarSnapshotInput {
  readonly marketCountry: "KR" | "US";
  readonly requestedDate: string;
  readonly calendar: unknown;
  readonly receivedAt: Date;
  readonly requestAttemptId: string;
}

export interface CollectionTargetInstrument {
  readonly marketCountry: "KR" | "US";
  readonly symbol: string;
  readonly currency: "KRW" | "USD";
}

export interface CollectionTargetScope {
  readonly targetConfigVersionId: string | null;
  readonly instruments: readonly CollectionTargetInstrument[];
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

  appendBrokerResponseValidation(input: StoredBrokerResponseValidationInput) {
    const redactedBody = canonicalJsonForStorage(input.redactedBody);
    return this.database.brokerResponseValidation.create({
      data: {
        requestAttemptId: input.requestAttemptId,
        operationId: input.operationId,
        outcome: input.outcome,
        redactedBody,
        bodySha256: createHash("sha256").update(JSON.stringify(redactedBody)).digest("hex"),
        safeErrorCode: input.safeErrorCode,
        validatedAt: input.validatedAt,
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

  async collectionTargetScope(accountId: string): Promise<CollectionTargetScope> {
    const activeTarget = await this.database.targetConfigVersion.findFirst({
      where: { config: { accountId }, status: "ACTIVE" },
      select: {
        id: true,
        allocations: {
          select: {
            instruments: {
              select: {
                marketCountry: true,
                symbol: true,
                currency: true,
              },
            },
          },
        },
      },
    });
    if (!activeTarget) {
      return { targetConfigVersionId: null, instruments: [] };
    }
    const instruments = activeTarget.allocations
      .flatMap(({ instruments: allocationInstruments }) => allocationInstruments)
      .map(assertCollectionTargetInstrument)
      .sort(compareCollectionTargetInstruments);
    return {
      targetConfigVersionId: activeTarget.id,
      instruments,
    };
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
    readonly expectedTargetConfigVersionId: string | null;
    readonly observedAt: Date;
    readonly securitiesValueMinor: bigint;
    readonly usdKrwRate: string | null;
    readonly holdings: readonly StoredHoldingInput[];
    readonly buyingPower: readonly StoredBuyingPowerInput[];
    readonly prices: readonly StoredPriceSnapshotInput[];
    readonly marketCalendars: readonly StoredMarketCalendarSnapshotInput[];
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
        select: {
          id: true,
          cashPolicy: true,
          allocations: {
            select: {
              instruments: {
                select: {
                  marketCountry: true,
                  symbol: true,
                  currency: true,
                },
              },
            },
          },
        },
      });
      if ((activeTarget?.id ?? null) !== input.expectedTargetConfigVersionId) {
        throw new CollectionError(
          "TARGET_CONFIG_STALE",
          "수집 도중 활성 목표 설정이 변경되어 새 스냅샷을 저장하지 않았습니다.",
          "현재 목표 설정을 확인한 뒤 계좌 데이터를 다시 수집하세요.",
        );
      }
      const managedCashMinor = resolveManagedCashMinor(activeTarget?.cashPolicy);
      const targetInstruments =
        activeTarget?.allocations
          .flatMap(({ instruments }) => instruments)
          .map(assertCollectionTargetInstrument) ?? [];
      const holdings = canonicalHoldingSnapshots(input.holdings);
      const buyingPower = canonicalBuyingPowerSnapshots(input.buyingPower);
      const prices = canonicalPriceSnapshots(input.prices);
      const marketCalendars = canonicalMarketCalendarSnapshots(input.marketCalendars);
      assertCompleteMarketEvidence(holdings, targetInstruments, prices, marketCalendars);
      const hasCompletePriceObservationTimes = prices.every(
        ({ providerObservedAt }) => providerObservedAt !== null,
      );
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            observedAt: input.observedAt.toISOString(),
            targetConfigVersionId: activeTarget?.id ?? null,
            holdings: holdings.map(({ rawPayload: _rawPayload, ...holding }) => ({
              ...holding,
              marketValueKrwMinor: holding.marketValueKrwMinor.toString(),
            })),
            buyingPower: buyingPower.map((item) => ({
              ...item,
              valueKrwMinor: item.valueKrwMinor.toString(),
            })),
            prices: prices.map((price) => ({
              marketCountry: price.marketCountry,
              symbol: price.symbol,
              currency: price.currency,
              lastPrice: price.lastPrice,
              providerObservedAt: price.providerObservedAt?.toISOString() ?? null,
              receivedAt: price.receivedAt.toISOString(),
              requestAttemptId: price.requestAttemptId,
            })),
            marketCalendars: marketCalendars.map((calendar) => ({
              marketCountry: calendar.marketCountry,
              requestedDate: calendar.requestedDateIso,
              calendar: calendar.calendar,
              calendarSha256: calendar.calendarSha256,
              receivedAt: calendar.receivedAt.toISOString(),
              requestAttemptId: calendar.requestAttemptId,
            })),
            managedCashMinor: managedCashMinor?.toString() ?? null,
            securitiesValueMinor: input.securitiesValueMinor.toString(),
            usdKrwRate: input.usdKrwRate,
          }),
        )
        .digest("hex");
      await transaction.rawBrokerResponse.createMany({
        data: input.rawResponses.map((response) => {
          const canonicalBody = canonicalJsonForStorage(response.body);
          return {
            collectionRunId: input.runId,
            operationId: response.operationId,
            ordinal: response.ordinal,
            requestId: response.requestId ?? null,
            httpStatus: response.httpStatus ?? 200,
            receivedAt: response.receivedAt,
            redactedBody: canonicalBody,
            bodySha256: createHash("sha256").update(JSON.stringify(canonicalBody)).digest("hex"),
            redactionVersion: "v1",
          };
        }),
      });
      await transaction.portfolioSnapshot.create({
        data: {
          collectionRunId: input.runId,
          accountId: input.accountId,
          targetConfigVersionId: activeTarget?.id ?? null,
          observedAt: input.observedAt,
          validationStatus: hasCompletePriceObservationTimes
            ? SnapshotValidationStatus.VERIFIED
            : SnapshotValidationStatus.BLOCKED,
          baseCurrency: "KRW",
          managedCashMinor,
          securitiesValueMinor: input.securitiesValueMinor,
          totalValueMinor: input.securitiesValueMinor + (managedCashMinor ?? 0n),
          usdKrwRate: input.usdKrwRate,
          digest,
          holdings: { create: [...holdings] },
          buyingPower: {
            create: buyingPower.map((item) => ({
              ...item,
              observedAt: input.observedAt,
              valuationEligible: false,
            })),
          },
          prices: {
            create: prices.map((price) => ({
              marketCountry: price.marketCountry,
              symbol: price.symbol,
              currency: price.currency,
              lastPrice: price.lastPrice,
              providerObservedAt: price.providerObservedAt,
              receivedAt: price.receivedAt,
              requestAttempt: { connect: { id: price.requestAttemptId } },
            })),
          },
          marketCalendars: {
            create: marketCalendars.map((calendar) => ({
              marketCountry: calendar.marketCountry,
              requestedDate: calendar.requestedDate,
              calendar: calendar.calendar,
              calendarSha256: calendar.calendarSha256,
              receivedAt: calendar.receivedAt,
              requestAttempt: { connect: { id: calendar.requestAttemptId } },
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
              {
                ruleCode: "BROKER_RESPONSE_PROVENANCE",
                outcome: CheckOutcome.PASSED,
                detail: {
                  message:
                    "가격·시장 캘린더가 같은 수집 실행의 성공 요청과 통과한 응답 검증을 참조합니다.",
                },
                checkedAt: input.observedAt,
              },
              {
                ruleCode: "PRICE_OBSERVATION_TIME",
                outcome: hasCompletePriceObservationTimes
                  ? CheckOutcome.PASSED
                  : CheckOutcome.BLOCKED,
                detail: {
                  message: hasCompletePriceObservationTimes
                    ? "평가 대상 현재가의 제공자 관측시각을 모두 확인했습니다."
                    : "관측시각이 없는 현재가가 있어 계획과 주문을 차단합니다.",
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
        prices: { orderBy: [{ marketCountry: "asc" }, { symbol: "asc" }] },
        marketCalendars: { orderBy: { marketCountry: "asc" } },
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

function assertCollectionTargetInstrument(input: {
  readonly marketCountry: string;
  readonly symbol: string;
  readonly currency: string;
}): CollectionTargetInstrument {
  if (
    (input.marketCountry !== "KR" && input.marketCountry !== "US") ||
    (input.currency !== "KRW" && input.currency !== "USD") ||
    (input.marketCountry === "KR" && input.currency !== "KRW") ||
    (input.marketCountry === "US" && input.currency !== "USD") ||
    input.symbol.trim().length === 0
  ) {
    throw new CollectionError(
      "DATA_INVALID",
      "활성 목표 설정의 종목 시장·통화 식별자를 안전하게 해석할 수 없습니다.",
      "목표 설정의 종목 검증 상태를 확인한 뒤 다시 저장하세요.",
    );
  }
  return {
    marketCountry: input.marketCountry,
    symbol: input.symbol,
    currency: input.currency,
  };
}

function compareCollectionTargetInstruments(
  left: CollectionTargetInstrument,
  right: CollectionTargetInstrument,
): number {
  const leftKey = `${left.marketCountry}:${left.symbol}`;
  const rightKey = `${right.marketCountry}:${right.symbol}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function normalizedJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function canonicalJsonForStorage(value: unknown): Prisma.InputJsonValue {
  const canonical = canonicalJsonValue(value);
  return JSON.parse(JSON.stringify(canonical)) as Prisma.InputJsonValue;
}

function canonicalHoldingSnapshots(
  holdings: readonly StoredHoldingInput[],
): readonly StoredHoldingInput[] {
  const seen = new Set<string>();
  for (const holding of holdings) {
    const instrument = assertCollectionTargetInstrument(holding);
    const key = collectionInstrumentKey(instrument);
    if (seen.has(key)) {
      throw invalidMarketEvidence(`보유자산 증거에 중복 종목이 있습니다: ${key}`);
    }
    seen.add(key);
  }
  return [...holdings].sort((left, right) => {
    const leftKey = collectionInstrumentKey(left);
    const rightKey = collectionInstrumentKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function canonicalBuyingPowerSnapshots(
  buyingPower: readonly StoredBuyingPowerInput[],
): readonly StoredBuyingPowerInput[] {
  const seen = new Set<"KRW" | "USD">();
  for (const item of buyingPower) {
    if (seen.has(item.currency)) {
      throw new CollectionError(
        "DATA_INVALID",
        `${item.currency} 매수 가능 금액 증거가 중복되었습니다.`,
        "통화별 매수 가능 금액을 한 번씩 다시 조회하세요.",
      );
    }
    seen.add(item.currency);
  }
  return [...buyingPower].sort((left, right) =>
    left.currency < right.currency ? -1 : left.currency > right.currency ? 1 : 0,
  );
}

function canonicalPriceSnapshots(
  prices: readonly StoredPriceSnapshotInput[],
): readonly StoredPriceSnapshotInput[] {
  const seen = new Set<string>();
  for (const price of prices) {
    assertRequestAttemptId(price.requestAttemptId, "현재가");
    const instrument = assertCollectionTargetInstrument(price);
    const key = collectionInstrumentKey(instrument);
    if (seen.has(key)) {
      throw invalidMarketEvidence(`현재가 증거에 중복 종목이 있습니다: ${key}`);
    }
    seen.add(key);
    if (
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price.lastPrice) ||
      /^0(?:\.0+)?$/.test(price.lastPrice)
    ) {
      throw invalidMarketEvidence(`${key} 현재가 형식이 올바르지 않습니다.`);
    }
    if (
      price.providerObservedAt &&
      price.providerObservedAt.getTime() > price.receivedAt.getTime() + 60_000
    ) {
      throw invalidMarketEvidence(`${key} 현재가 관측시각이 허용 오차보다 미래입니다.`);
    }
  }
  return [...prices].sort((left, right) => {
    const leftKey = `${left.marketCountry}:${left.symbol}`;
    const rightKey = `${right.marketCountry}:${right.symbol}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function canonicalMarketCalendarSnapshots(
  calendars: readonly StoredMarketCalendarSnapshotInput[],
): readonly {
  readonly marketCountry: "KR" | "US";
  readonly requestedDate: Date;
  readonly requestedDateIso: string;
  readonly calendar: Prisma.InputJsonObject;
  readonly calendarSha256: string;
  readonly receivedAt: Date;
  readonly requestAttemptId: string;
}[] {
  const seenMarkets = new Set<"KR" | "US">();
  return calendars
    .map((input) => {
      assertRequestAttemptId(input.requestAttemptId, "시장 캘린더");
      if (seenMarkets.has(input.marketCountry)) {
        throw invalidMarketEvidence(`${input.marketCountry} 시장 캘린더 증거가 중복되었습니다.`);
      }
      seenMarkets.add(input.marketCountry);
      const requestedDateIso = normalizeIsoDate(input.requestedDate);
      assertMarketCalendarShape(input.calendar, input.marketCountry, requestedDateIso);
      const calendar = canonicalJsonObject(input.calendar);
      if (
        calendar.marketCountry !== input.marketCountry ||
        !isJsonObject(calendar.today) ||
        calendar.today.date !== requestedDateIso
      ) {
        throw invalidMarketEvidence(
          `${input.marketCountry} 시장 캘린더 식별자와 payload가 일치하지 않습니다.`,
        );
      }
      return {
        marketCountry: input.marketCountry,
        requestedDate: new Date(`${requestedDateIso}T00:00:00.000Z`),
        requestedDateIso,
        calendar,
        calendarSha256: createHash("sha256").update(JSON.stringify(calendar)).digest("hex"),
        receivedAt: input.receivedAt,
        requestAttemptId: input.requestAttemptId,
      };
    })
    .sort((left, right) => (left.marketCountry < right.marketCountry ? -1 : 1));
}

function assertRequestAttemptId(value: string, subject: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw invalidMarketEvidence(`${subject} 요청 감사 ID가 올바른 UUID가 아닙니다.`);
  }
}

function normalizeIsoDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("시장 캘린더 요청일은 YYYY-MM-DD 형식이어야 합니다.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("시장 캘린더 요청일이 올바른 날짜가 아닙니다.");
  }
  return value;
}

function assertMarketCalendarShape(
  value: unknown,
  expectedMarket: "KR" | "US",
  expectedToday: string,
): asserts value is MarketCalendar {
  if (!isUnknownObject(value) || value.marketCountry !== expectedMarket) {
    throw invalidMarketEvidence(`${expectedMarket} 시장 캘린더 국가가 일치하지 않습니다.`);
  }
  const dayKeys = ["previousBusinessDay", "today", "nextBusinessDay"] as const;
  const parsedDays = dayKeys.map((key) => {
    const day = value[key];
    if (!isUnknownObject(day) || typeof day.date !== "string" || !Array.isArray(day.sessions)) {
      throw invalidMarketEvidence(`${expectedMarket} 시장 캘린더 ${key} 구조가 올바르지 않습니다.`);
    }
    const date = normalizeIsoDate(day.date);
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const session of day.sessions) {
      if (
        !isUnknownObject(session) ||
        !["DAY_MARKET", "PRE_MARKET", "REGULAR_MARKET", "AFTER_MARKET"].includes(
          String(session.kind),
        ) ||
        typeof session.startAt !== "string" ||
        typeof session.endAt !== "string"
      ) {
        throw invalidMarketEvidence(
          `${expectedMarket} 시장 캘린더 ${date} 세션 구조가 올바르지 않습니다.`,
        );
      }
      const startAt = parseExplicitIsoDateTime(session.startAt);
      const endAt = parseExplicitIsoDateTime(session.endAt);
      if (startAt >= endAt || startAt < previousEnd) {
        throw invalidMarketEvidence(
          `${expectedMarket} 시장 캘린더 ${date} 세션 구간이 겹치거나 역전되었습니다.`,
        );
      }
      previousEnd = endAt;
      const auctionStartAt = session.auctionStartAt;
      const auctionEndAt = session.auctionEndAt;
      if (
        (auctionStartAt !== null && typeof auctionStartAt !== "string") ||
        (auctionEndAt !== null && typeof auctionEndAt !== "string")
      ) {
        throw invalidMarketEvidence(
          `${expectedMarket} 시장 캘린더 ${date} 단일가 시각 형식이 올바르지 않습니다.`,
        );
      }
      const auctionStart =
        typeof auctionStartAt === "string" ? parseExplicitIsoDateTime(auctionStartAt) : null;
      const auctionEnd =
        typeof auctionEndAt === "string" ? parseExplicitIsoDateTime(auctionEndAt) : null;
      if (
        (auctionStart !== null && (auctionStart < startAt || auctionStart > endAt)) ||
        (auctionEnd !== null && (auctionEnd < startAt || auctionEnd > endAt))
      ) {
        throw invalidMarketEvidence(
          `${expectedMarket} 시장 캘린더 ${date} 단일가 경계가 세션 밖에 있습니다.`,
        );
      }
      if (auctionStart !== null && auctionEnd !== null) {
        if (auctionStart >= auctionEnd) {
          throw invalidMarketEvidence(
            `${expectedMarket} 시장 캘린더 ${date} 단일가 구간이 역전되었습니다.`,
          );
        }
      }
    }
    return date;
  });
  const previousDay = parsedDays[0];
  const today = parsedDays[1];
  const nextDay = parsedDays[2];
  if (
    previousDay === undefined ||
    today === undefined ||
    nextDay === undefined ||
    previousDay >= today ||
    today >= nextDay ||
    today !== expectedToday
  ) {
    throw invalidMarketEvidence(
      `${expectedMarket} 시장 캘린더의 전일·당일·익일 순서가 올바르지 않습니다.`,
    );
  }
}

function parseExplicitIsoDateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw invalidMarketEvidence("시장 캘린더 세션 시각에 명시적인 시간대가 없습니다.");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw invalidMarketEvidence("시장 캘린더 세션 시각을 해석할 수 없습니다.");
  }
  return milliseconds;
}

function isUnknownObject(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function canonicalJsonObject(value: unknown): Prisma.InputJsonObject {
  const canonical = canonicalJsonValue(value);
  if (canonical === null || Array.isArray(canonical) || typeof canonical !== "object") {
    throw new Error("시장 캘린더 증거는 JSON object여야 합니다.");
  }
  return canonical as Prisma.InputJsonObject;
}

function assertCompleteMarketEvidence(
  holdings: readonly StoredHoldingInput[],
  targetInstruments: readonly CollectionTargetInstrument[],
  prices: readonly StoredPriceSnapshotInput[],
  calendars: readonly {
    readonly marketCountry: "KR" | "US";
  }[],
): void {
  const expected = new Map<string, "KRW" | "USD">();
  const expectedMarkets = new Set<"KR" | "US">();
  for (const input of [
    ...holdings.map(({ marketCountry, symbol, currency }) => ({
      marketCountry,
      symbol,
      currency,
    })),
    ...targetInstruments,
  ]) {
    const instrument = assertCollectionTargetInstrument(input);
    const key = collectionInstrumentKey(instrument);
    const previousCurrency = expected.get(key);
    if (previousCurrency && previousCurrency !== instrument.currency) {
      throw invalidMarketEvidence(`${key} 평가 대상 통화가 서로 일치하지 않습니다.`);
    }
    expected.set(key, instrument.currency);
    expectedMarkets.add(instrument.marketCountry);
  }

  const actual = new Map(
    prices.map((price) => [collectionInstrumentKey(price), price.currency] as const),
  );
  if (
    actual.size !== expected.size ||
    [...expected].some(([key, currency]) => actual.get(key) !== currency)
  ) {
    throw invalidMarketEvidence(
      "보유자산과 활성 목표 종목 전체의 현재가 증거가 완전하지 않습니다.",
    );
  }

  const actualMarkets = new Set(calendars.map(({ marketCountry }) => marketCountry));
  if (
    actualMarkets.size !== expectedMarkets.size ||
    [...expectedMarkets].some((marketCountry) => !actualMarkets.has(marketCountry))
  ) {
    throw invalidMarketEvidence("평가 대상 시장 전체의 캘린더 증거가 완전하지 않습니다.");
  }
}

function collectionInstrumentKey(input: {
  readonly marketCountry: string;
  readonly symbol: string;
}): string {
  return `${input.marketCountry}:${input.symbol}`;
}

function invalidMarketEvidence(problem: string): CollectionError {
  return new CollectionError(
    "DATA_INVALID",
    problem,
    "현재가와 시장 캘린더를 다시 조회한 뒤 새 스냅샷을 생성하세요.",
  );
}

function isJsonObject(
  value: Prisma.InputJsonValue | null | undefined,
): value is Prisma.InputJsonObject {
  return (
    value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object"
  );
}

function canonicalJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("시장 캘린더 JSON에 유한하지 않은 숫자가 있습니다.");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item));
  if (value instanceof Date) {
    throw new Error("시장 캘린더 JSON에는 Date 객체 대신 ISO 문자열을 사용해야 합니다.");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalJsonValue(item)] as const);
    return Object.fromEntries(entries);
  }
  throw new Error("시장 캘린더 JSON에 저장할 수 없는 값이 있습니다.");
}
