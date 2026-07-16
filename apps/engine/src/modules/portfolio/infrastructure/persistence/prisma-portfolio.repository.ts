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

export class PrismaPortfolioRepository {
  constructor(private readonly database: DatabaseClient) {}

  async acquireCollectionLease(owner: string): Promise<boolean> {
    const acquired = await this.database.$executeRaw`
      INSERT INTO "runtime_lease" ("key", "owner", "acquired_at", "expires_at", "fencing_token")
      VALUES ('toss-portfolio-collection', ${owner}::uuid, NOW(), NOW() + INTERVAL '2 minutes', 1)
      ON CONFLICT ("key") DO UPDATE
      SET "owner" = EXCLUDED."owner",
          "acquired_at" = EXCLUDED."acquired_at",
          "expires_at" = EXCLUDED."expires_at",
          "fencing_token" = "runtime_lease"."fencing_token" + 1
      WHERE "runtime_lease"."expires_at" <= NOW()
    `;
    return acquired === 1;
  }

  async releaseCollectionLease(owner: string): Promise<void> {
    await this.database.runtimeLease.deleteMany({
      where: { key: "toss-portfolio-collection", owner },
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
    readonly rawResponses: readonly RedactedResponseInput[];
  }): Promise<void> {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          observedAt: input.observedAt.toISOString(),
          holdings: input.holdings.map(({ rawPayload: _rawPayload, ...holding }) => ({
            ...holding,
            marketValueKrwMinor: holding.marketValueKrwMinor.toString(),
          })),
        }),
      )
      .digest("hex");

    await this.database.$transaction(async (transaction) => {
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
          checks: {
            create: [
              {
                ruleCode: "BROKER_DATA_SCHEMA",
                outcome: CheckOutcome.PASSED,
                detail: { message: "토스 계좌·보유 응답의 런타임 스키마를 검증했습니다." },
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
    });
  }

  latestSnapshot() {
    return this.database.portfolioSnapshot.findFirst({
      orderBy: { observedAt: "desc" },
      include: { account: true, holdings: { orderBy: [{ market: "asc" }, { symbol: "asc" }] } },
    });
  }
}
