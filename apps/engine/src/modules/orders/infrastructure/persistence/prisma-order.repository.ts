import type { DatabaseClient } from "@portfolio-rebalancer/database";
import type { Prisma } from "@portfolio-rebalancer/database";

type TransactionClient = Parameters<Parameters<DatabaseClient["$transaction"]>[0]>[0];

export interface StoredExecutionPlanOrder {
  readonly id: string;
  readonly candidateId: string;
  readonly phase: "SELL" | "BUY";
  readonly ordinal: number;
  readonly assetClassId: string;
  readonly instrumentKey: string;
  readonly marketCountry: string;
  readonly currency: string;
  readonly symbol: string;
  readonly side: string;
  readonly orderType: string;
  readonly timeInForce: string;
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly notionalMinor: bigint;
  readonly plannedPriceSnapshotId: string;
  readonly plannedQuotePriceMinor: bigint;
  readonly plannedQuoteObservedAt: Date | null;
  readonly plannedQuoteReceivedAt: Date;
  readonly plannedQuoteAuditReference: string;
}

export interface StoredExecutionContext {
  readonly plan: {
    readonly id: string;
    readonly runId: string;
    readonly planVersion: number;
    readonly planHash: string;
    readonly mode: "SHADOW" | "PAPER" | "LIVE";
    readonly status: "NO_ACTION" | "PLANNED" | "BLOCKED";
    readonly snapshotId: string;
    readonly snapshotDigest: string;
    readonly targetConfigVersionId: string;
    readonly targetConfigContentHash: string;
    readonly totalValueMinor: bigint | null;
    readonly assetDecisions: unknown;
    readonly projectedAllocations: unknown;
    readonly orders: readonly StoredExecutionPlanOrder[];
  };
  readonly account: {
    readonly id: string;
    readonly externalRefHmac: string;
  };
  readonly currentIdentity: {
    readonly snapshotId: string | null;
    readonly snapshotDigest: string | null;
    readonly targetConfigVersionId: string | null;
    readonly targetConfigContentHash: string | null;
  };
  readonly operationalConfig: {
    readonly id: string;
    readonly canonicalContent: string;
    readonly contentHash: string;
    readonly payload: unknown;
  } | null;
  readonly promotion: {
    readonly id: string;
    readonly state: "GRANTED" | "REVOKED";
    readonly operationalConfigVersionId: string | null;
  } | null;
  readonly killSwitch: "ENGAGED" | "DISENGAGED" | null;
  readonly existingOrders: readonly {
    readonly logicalOrderId: string;
    readonly state: StoredOrderState;
  }[];
  readonly tradeDayFilledGrossMinor: bigint;
  readonly reservedPendingGrossMinor: bigint;
}

export interface StoredManualApproval {
  readonly id: string;
  readonly planOrderId: string;
  readonly accountId: string;
  readonly approvalHash: string;
  readonly planHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface CreateManualApprovalRecord {
  readonly id: string;
  readonly planOrderId: string;
  readonly accountId: string;
  readonly approvalHash: string;
  readonly planHash: string;
  readonly actor: string;
  readonly confirmationVersion: string;
  readonly canonicalContent: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface CreatePaperOrderRecord {
  readonly id: string;
  readonly planId: string;
  readonly planOrderId: string;
  readonly accountId: string;
  readonly logicalOrderId: string;
  readonly clientOrderId: string;
  readonly clientOrderIdVersion: string;
  readonly canonicalIntent: string;
  readonly intentSha256: string;
  readonly planVersion: number;
  readonly phase: "SELL" | "BUY";
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: string;
  readonly side: "SELL" | "BUY";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly plannedGrossNotionalMinor: bigint;
  readonly reservedGrossMinor: bigint;
  readonly reservationBasisPriceMinor: bigint;
  readonly reservationPolicyVersion: string;
}

export type CreateLiveOrderRecord = CreatePaperOrderRecord;

export interface StoredExecutionRiskEvidenceInput {
  readonly id: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly accountId: string;
  readonly promotionEventId: string;
  readonly operationalConfigVersionId: string;
  readonly operationalConfigCanonical: string;
  readonly operationalConfigSha256: string;
  readonly accountAllowlistHmac: string;
  readonly checks: Prisma.InputJsonValue;
  readonly evaluatedAt: Date;
  readonly expiresAt: Date;
}

export interface StoredPreSubmitEvidenceInput {
  readonly id: string;
  readonly executionRiskEvidenceId: string;
  readonly planOrderId: string;
  readonly accountId: string;
  readonly accountResponseValidationId: string;
  readonly plannedPriceSnapshotId: string;
  readonly quoteResponseValidationId: string;
  readonly priceLimitResponseValidationId: string;
  readonly calendarResponseValidationId: string;
  readonly capacityResponseValidationId: string;
  readonly instrumentResponseValidationId: string;
  readonly warningsResponseValidationId: string;
  readonly openOrdersResponseValidationId: string;
  readonly plannedQuotePriceMinor: bigint;
  readonly currentQuotePriceMinor: bigint;
  readonly lowerPriceLimitMinor: bigint;
  readonly upperPriceLimitMinor: bigint;
  readonly reservationBasisPriceMinor: bigint;
  readonly reservedGrossMinor: bigint;
  readonly checks: Prisma.InputJsonValue;
  readonly evaluatedAt: Date;
  readonly expiresAt: Date;
}

export interface StoredLiveLedger {
  readonly order: StoredOrderReceipt;
  readonly preSubmitEvidenceId: string;
  readonly reservationId: string;
}

export interface PrepareLiveSubmissionInput {
  readonly id: string;
  readonly orderId: string;
  readonly logicalOrderId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planOrderId: string;
  readonly canonicalPreparation: string;
  readonly canonicalPreparationDigest: string;
  readonly authorizedRequestDigest: string;
  readonly clientOrderId: string;
  readonly brokerAccountReferenceHmac: string;
  readonly executionRiskEvidenceId: string;
  readonly preSubmitEvidenceId: string;
  readonly reservationId: string;
  readonly approvalId: string;
  readonly expiresAt: Date;
}

export interface ClaimLiveDispatchInput {
  readonly id: string;
  readonly submissionAuthorizationId: string;
  readonly orderId: string;
  readonly logicalOrderId: string;
  readonly authorizationId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planOrderId: string;
  readonly canonicalRequest: string;
  readonly claimEnvelopeDigest: string;
  readonly authorizedRequestDigest: string;
  readonly clientOrderId: string;
  readonly brokerAccountReferenceHmac: string;
  readonly authorizationIssuedAt: Date;
  readonly authorizationExpiresAt: Date;
  readonly intentAuditedAt: Date;
  readonly dispatchStartedAt: Date;
}

export interface RecordNonDispatchRecoveryInput {
  readonly evidenceId: string;
  readonly submissionAuthorizationId: string;
  readonly orderId: string;
  readonly actor: string;
}

export interface RecordPreAuthorizationNonDispatchRecoveryInput {
  readonly evidenceId: string;
  readonly orderId: string;
  readonly reservationId: string;
  readonly actor: string;
}

export interface StoredNonDispatchRecovery {
  readonly evidenceId: string;
  readonly recordedAt: Date;
  readonly proofSha256: string;
  readonly order: StoredOrderReceipt;
}

export interface StoredPreAuthorizationNonDispatchRecovery {
  readonly evidenceId: string;
  readonly recordedAt: Date;
  readonly proofSha256: string;
  readonly order: StoredOrderReceipt;
}

export interface RecordSubmitOutcomeInput {
  readonly evidenceId: string;
  readonly orderId: string;
  readonly dispatchClaimId: string;
  readonly brokerOrderId: string | null;
  readonly brokerStatusRaw: "ACKNOWLEDGED" | "REJECTED" | "AMBIGUOUS" | "INTEGRITY_BLOCKED";
  readonly validatedState: "PENDING" | "REJECTED" | "UNKNOWN" | "UNKNOWN_BLOCKED";
  readonly requestId: string | null;
  readonly httpStatus: number | null;
  readonly safeErrorCode: string | null;
  readonly redactedBody: Prisma.InputJsonValue;
  readonly observedAt: Date;
}

export interface StoredLiveOrderContext {
  readonly orderId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: string;
  readonly accountExternalRefHmac: string;
  readonly clientOrderId: string;
  readonly canonicalIntentSha256: string;
  readonly brokerOrderId: string | null;
  readonly submissionAuthorizationId: string | null;
  readonly dispatchClaimId: string | null;
  readonly dispatchStartedAt: Date | null;
  readonly reservationId: string | null;
  readonly state: StoredOrderState;
  readonly stateOccurredAt: Date;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly orderType: string;
  readonly timeInForce: string;
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly filledQuantity: bigint;
  readonly filledGrossMinor: bigint;
  readonly feeMinor: bigint;
}

export interface RecordReconciliationInput {
  readonly evidenceId: string;
  readonly orderId: string;
  readonly brokerOrderId: string;
  readonly brokerStatusRaw: string;
  readonly validatedState:
    "PENDING" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN_BLOCKED";
  readonly requestId: string | null;
  readonly httpStatus: number;
  readonly redactedBody: Prisma.InputJsonValue;
  readonly observedAt: Date;
  readonly filledQuantity: bigint;
  readonly filledGrossMinor: bigint;
  readonly feeMinor: bigint;
  readonly actor: "RECONCILER" | "OPERATOR";
  readonly brokerActionId?: string;
  readonly detail: Prisma.InputJsonValue;
}

export interface CreateCancelOperatorAuthorizationInput {
  readonly id: string;
  readonly orderId: string;
  readonly authorizationId: string;
  readonly actor: string;
  readonly action: "CANCEL";
  readonly confirmationVersion: "CANCEL_ORDER_CONFIRMATION_V1";
  readonly canonicalContent: string;
  readonly canonicalRequestDigest: string;
  readonly authorizationDigest: string;
  readonly authorizedAt: Date;
  readonly expiresAt: Date;
}

export interface ClaimCancelDispatchInput {
  readonly id: string;
  readonly cancelOperatorAuthorizationId: string;
  readonly orderId: string;
  readonly authorizationId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly canonicalRequest: string;
  readonly claimEnvelopeDigest: string;
  readonly authorizedRequestDigest: string;
  readonly clientOrderId: string;
  readonly brokerAccountReferenceHmac: string;
  readonly brokerOrderId: string;
  readonly ledgerState: "PENDING" | "PARTIAL_FILLED";
  readonly operatorAuthorizationDigest: string;
  readonly authorizationIssuedAt: Date;
  readonly authorizationExpiresAt: Date;
  readonly intentAuditedAt: Date;
  readonly dispatchStartedAt: Date;
}

export interface RecordCancelOutcomeInput {
  readonly evidenceOrActionId: string;
  readonly orderId: string;
  readonly cancelDispatchClaimId: string;
  readonly authorizationId: string;
  readonly canonicalRequestDigest: string;
  readonly brokerOrderId: string;
  readonly brokerActionOrderId: string | null;
  readonly outcome: "ACKNOWLEDGED" | "REJECTED" | "AMBIGUOUS" | "INTEGRITY_BLOCKED";
  readonly requestId: string | null;
  readonly httpStatus: number | null;
  readonly safeErrorCode: string;
  readonly redactedBody: Prisma.InputJsonValue;
  readonly observedAt: Date;
}

export type StoredOrderState =
  | "PLANNED"
  | "SUBMITTING"
  | "PENDING"
  | "PARTIAL_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "UNKNOWN"
  | "UNKNOWN_BLOCKED";

export interface AppendPaperStateInput {
  readonly orderId: string;
  readonly state: StoredOrderState;
  readonly filledQuantity: bigint;
  readonly filledGrossMinor: bigint;
  readonly feeMinor: bigint;
  readonly detail: Prisma.InputJsonValue;
}

export interface StoredOrderTimelineEntry {
  readonly sequence: number;
  readonly state: StoredOrderState;
  readonly brokerStatusRaw: string | null;
  readonly brokerOrderId: string | null;
  readonly brokerActionOrderId: string | null;
  readonly filledQuantity: bigint;
  readonly filledGrossMinor: bigint;
  readonly feeMinor: bigint;
  readonly occurredAt: Date;
  readonly detail: unknown;
}

export interface StoredOrderReceipt {
  readonly id: string;
  readonly logicalOrderId: string;
  readonly planId: string;
  readonly planOrderId: string;
  readonly mode: "PAPER" | "LIVE";
  readonly instrumentKey: string;
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly plannedGrossMinor: bigint;
  readonly reservedGrossMinor: bigint;
  readonly clientOrderId: string;
  readonly createdAt: Date;
  readonly timeline: readonly StoredOrderTimelineEntry[];
}

interface CurrentConfigRow {
  readonly operational_config_version_id: string;
  readonly canonical_content: string;
  readonly content_hash: string;
  readonly payload: unknown;
}

interface CurrentOrderRow {
  readonly logical_order_id: string;
  readonly normalized_state: StoredOrderState;
}

interface DailyUsageRow {
  readonly filled_gross_minor: bigint;
  readonly reserved_pending_gross_minor: bigint;
}

interface CurrentStateLockRow {
  readonly sequence: number;
  readonly normalized_state: StoredOrderState;
  readonly filled_quantity: bigint;
  readonly filled_gross_notional_minor: bigint;
  readonly fee_minor: bigint;
}

const orderReceiptInclude = {
  planOrder: { select: { instrumentKey: true } },
  stateHistory: {
    orderBy: [{ sequence: "asc" as const }],
    include: {
      brokerAction: { select: { brokerActionOrderId: true } },
    },
  },
} satisfies Prisma.OrderLedgerInclude;

type OrderReceiptRecord = Prisma.OrderLedgerGetPayload<{
  include: typeof orderReceiptInclude;
}>;

export class PrismaOrderRepository {
  constructor(private readonly database: DatabaseClient) {}

  async loadExecutionContext(planId: string): Promise<StoredExecutionContext | null> {
    return this.database.$transaction(
      async (transaction) => {
        const plan = await transaction.rebalancePlan.findUnique({
          where: { id: planId },
          include: {
            run: {
              include: {
                account: { select: { id: true, externalRefHmac: true } },
              },
            },
            targetConfigVersion: { select: { contentHash: true } },
            snapshot: {
              include: {
                prices: {
                  select: {
                    id: true,
                    marketCountry: true,
                    symbol: true,
                    currency: true,
                    lastPrice: true,
                    providerObservedAt: true,
                    receivedAt: true,
                    requestAttemptId: true,
                  },
                },
              },
            },
            versions: {
              orderBy: [{ version: "desc" }],
              take: 1,
              include: {
                orders: { orderBy: [{ phase: "asc" }, { ordinal: "asc" }, { id: "asc" }] },
              },
            },
          },
        });
        const version = plan?.versions[0];
        if (!plan || !version) return null;

        const [latestSnapshot, activeTarget, currentConfigRows, promotion, killSwitch] =
          await Promise.all([
            transaction.portfolioSnapshot.findFirst({
              where: { accountId: plan.run.accountId },
              orderBy: [{ observedAt: "desc" }, { persistedAt: "desc" }, { id: "desc" }],
              select: { id: true, digest: true },
            }),
            transaction.targetConfigVersion.findFirst({
              where: { config: { accountId: plan.run.accountId }, status: "ACTIVE" },
              select: { id: true, contentHash: true },
            }),
            transaction.$queryRaw<CurrentConfigRow[]>`
              SELECT
                "operational_config_version_id",
                "canonical_content",
                "content_hash",
                "payload"
              FROM public."operational_config_current"
              WHERE "account_id" = ${plan.run.accountId}::uuid
              LIMIT 1
            `,
            transaction.livePromotionEvent.findFirst({
              where: { accountId: plan.run.accountId },
              orderBy: [{ version: "desc" }],
              select: { id: true, state: true, operationalConfigVersionId: true },
            }),
            transaction.killSwitchEvent.findFirst({
              where: { accountId: plan.run.accountId },
              orderBy: [{ version: "desc" }],
              select: { state: true },
            }),
          ]);
        const existingOrders = await transaction.$queryRaw<CurrentOrderRow[]>`
          SELECT "logical_order_id", "normalized_state"::text AS "normalized_state"
          FROM public."order_ledger_current_state"
          WHERE "account_id" = ${plan.run.accountId}::uuid
          ORDER BY "occurred_at", "order_id"
        `;
        const [usage] = await transaction.$queryRaw<DailyUsageRow[]>`
          SELECT
            COALESCE(SUM(reservation."filled_gross_minor"), 0)::bigint
              AS "filled_gross_minor",
            COALESCE(SUM(
              reservation."reserved_gross_minor"
              - reservation."filled_gross_minor"
              - reservation."released_gross_minor"
            ), 0)::bigint AS "reserved_pending_gross_minor"
          FROM public."daily_trade_limit" AS limit_row
          LEFT JOIN public."daily_trade_reservation" AS reservation
            ON reservation."daily_trade_limit_id" = limit_row."id"
          WHERE limit_row."account_id" = ${plan.run.accountId}::uuid
            AND limit_row."trade_day"
              = (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
            AND limit_row."market_country" = 'KR'
            AND limit_row."currency" = 'KRW'
            AND limit_row."mode" = ${version.mode}::public."RebalanceMode"
        `;
        const currentConfig = currentConfigRows[0];
        return {
          plan: {
            id: plan.id,
            runId: plan.runId,
            planVersion: version.version,
            planHash: version.planHash,
            mode: version.mode,
            status: version.status,
            snapshotId: version.snapshotId,
            snapshotDigest: plan.run.snapshotDigest,
            targetConfigVersionId: version.targetConfigVersionId,
            targetConfigContentHash: plan.targetConfigVersion.contentHash,
            totalValueMinor: plan.totalValueMinor,
            assetDecisions: plan.assetDecisions,
            projectedAllocations: plan.projectedAllocations,
            orders: version.orders.map((order) => {
              const plannedPrice = plan.snapshot.prices.find(
                (price) =>
                  price.marketCountry === order.marketCountry &&
                  price.symbol === order.symbol &&
                  price.currency === order.currency,
              );
              if (!plannedPrice || !/^[1-9]\d*$/.test(plannedPrice.lastPrice)) {
                throw new Error(`계획 시세 스냅샷을 찾을 수 없습니다: ${order.instrumentKey}`);
              }
              return {
                id: order.id,
                candidateId: order.candidateId,
                phase: requirePhase(order.phase),
                ordinal: order.ordinal,
                assetClassId: order.assetClassId,
                instrumentKey: order.instrumentKey,
                marketCountry: order.marketCountry,
                currency: order.currency,
                symbol: order.symbol,
                side: order.side,
                orderType: order.orderType,
                timeInForce: order.timeInForce,
                quantity: order.quantity,
                limitPriceMinor: order.limitPriceMinor,
                notionalMinor: order.notionalMinor,
                plannedPriceSnapshotId: plannedPrice.id,
                plannedQuotePriceMinor: BigInt(plannedPrice.lastPrice),
                plannedQuoteObservedAt: plannedPrice.providerObservedAt,
                plannedQuoteReceivedAt: plannedPrice.receivedAt,
                plannedQuoteAuditReference: plannedPrice.requestAttemptId,
              };
            }),
          },
          account: {
            id: plan.run.account.id,
            externalRefHmac: plan.run.account.externalRefHmac,
          },
          currentIdentity: {
            snapshotId: latestSnapshot?.id ?? null,
            snapshotDigest: latestSnapshot?.digest ?? null,
            targetConfigVersionId: activeTarget?.id ?? null,
            targetConfigContentHash: activeTarget?.contentHash ?? null,
          },
          operationalConfig: currentConfig
            ? {
                id: currentConfig.operational_config_version_id,
                canonicalContent: currentConfig.canonical_content,
                contentHash: currentConfig.content_hash,
                payload: currentConfig.payload,
              }
            : null,
          promotion: promotion
            ? {
                id: promotion.id,
                state: promotion.state,
                operationalConfigVersionId: promotion.operationalConfigVersionId,
              }
            : null,
          killSwitch: killSwitch?.state ?? null,
          existingOrders: existingOrders.map((order) => ({
            logicalOrderId: order.logical_order_id,
            state: order.normalized_state,
          })),
          tradeDayFilledGrossMinor: usage?.filled_gross_minor ?? 0n,
          reservedPendingGrossMinor: usage?.reserved_pending_gross_minor ?? 0n,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }

  manualApprovals(ids: readonly string[]): Promise<readonly StoredManualApproval[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.database.manualOrderApproval.findMany({
      where: { id: { in: [...ids] } },
      orderBy: [{ planOrderId: "asc" }, { id: "asc" }],
      select: {
        id: true,
        planOrderId: true,
        accountId: true,
        approvalHash: true,
        planHash: true,
        createdAt: true,
        expiresAt: true,
        consumedAt: true,
      },
    });
  }

  createManualApprovals(
    planId: string,
    planVersion: number,
    approvals: readonly CreateManualApprovalRecord[],
  ): Promise<readonly StoredManualApproval[] | null> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."rebalance_plan_version"
          WHERE "plan_id" = ${planId}::uuid
            AND "version" = ${planVersion}
          FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const planOrders = await transaction.rebalancePlanOrder.findMany({
          where: { planId, planVersion },
          select: { id: true },
        });
        const expected = new Set(planOrders.map(({ id }) => id));
        if (
          expected.size === 0 ||
          approvals.length !== expected.size ||
          approvals.some(({ planOrderId }) => !expected.has(planOrderId))
        ) {
          return null;
        }
        const active = await transaction.manualOrderApproval.count({
          where: {
            planOrderId: { in: [...expected] },
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        if (active > 0) return null;
        for (const approval of approvals) {
          await transaction.manualOrderApproval.create({ data: approval });
        }
        return transaction.manualOrderApproval.findMany({
          where: { id: { in: approvals.map(({ id }) => id) } },
          orderBy: [{ planOrderId: "asc" }, { id: "asc" }],
          select: {
            id: true,
            planOrderId: true,
            accountId: true,
            approvalHash: true,
            planHash: true,
            createdAt: true,
            expiresAt: true,
            consumedAt: true,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  createPaperOrders(input: {
    readonly accountId: string;
    readonly grossLimitMinor: bigint;
    readonly orders: readonly CreatePaperOrderRecord[];
  }): Promise<readonly StoredOrderReceipt[] | null> {
    if (input.orders.length === 0) return Promise.resolve(null);
    return this.database.$transaction(
      async (transaction) => {
        const dailyLimitId = await this.ensureDailyLimit(transaction, {
          accountId: input.accountId,
          mode: "PAPER",
          grossLimitMinor: input.grossLimitMinor,
        });
        if (!dailyLimitId) return null;
        for (const order of input.orders) {
          await transaction.orderLedger.create({
            data: {
              ...order,
              dailyTradeLimitId: dailyLimitId,
              mode: "PAPER",
              reservationEvidenceId: null,
            },
          });
        }
        return this.readOrders(transaction, { planId: input.orders[0]!.planId });
      },
      { isolationLevel: "Serializable" },
    );
  }

  appendExecutionRiskEvidence(input: StoredExecutionRiskEvidenceInput) {
    return this.database.executionRiskEvidence.create({ data: input });
  }

  createLivePreSubmitEvidenceAndLedger(input: {
    readonly grossLimitMinor: bigint;
    readonly preSubmitEvidence: StoredPreSubmitEvidenceInput;
    readonly order: CreateLiveOrderRecord;
  }): Promise<StoredLiveLedger | null> {
    return this.database.$transaction(
      async (transaction) => {
        await transaction.preSubmitEvidence.create({ data: input.preSubmitEvidence });
        const dailyLimitId = await this.ensureDailyLimit(transaction, {
          accountId: input.order.accountId,
          mode: "LIVE",
          grossLimitMinor: input.grossLimitMinor,
        });
        if (!dailyLimitId) return null;
        await transaction.orderLedger.create({
          data: {
            ...input.order,
            dailyTradeLimitId: dailyLimitId,
            mode: "LIVE",
            reservationEvidenceId: input.preSubmitEvidence.id,
          },
        });
        const reservation = await transaction.dailyTradeReservation.findUnique({
          where: { orderId: input.order.id },
          select: { id: true },
        });
        const order = await this.readOrder(transaction, input.order.id);
        if (!reservation || !order) return null;
        return {
          order,
          preSubmitEvidenceId: input.preSubmitEvidence.id,
          reservationId: reservation.id,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }

  prepareLiveSubmission(
    input: PrepareLiveSubmissionInput,
  ): Promise<{ readonly id: string; readonly preparedAt: Date; readonly expiresAt: Date }> {
    return this.database.$transaction(
      async (transaction) => {
        const authorization = await transaction.orderSubmissionAuthorization.create({
          data: input,
          select: { id: true, preparedAt: true, expiresAt: true },
        });
        return authorization;
      },
      { isolationLevel: "Serializable" },
    );
  }

  claimLiveDispatch(
    input: ClaimLiveDispatchInput,
  ): Promise<{ readonly id: string; readonly claimedAt: Date }> {
    return this.database.orderDispatchClaim.create({
      data: input,
      select: { id: true, claimedAt: true },
    });
  }

  recoverAuthorizedOrderWithoutDispatch(
    input: RecordNonDispatchRecoveryInput,
  ): Promise<StoredNonDispatchRecovery> {
    return this.database.$transaction(
      async (transaction) => {
        const evidence = await transaction.orderNonDispatchEvidence.create({
          data: {
            id: input.evidenceId,
            submissionAuthorizationId: input.submissionAuthorizationId,
            orderId: input.orderId,
            actor: input.actor,
          },
          select: { id: true, recordedAt: true, proofSha256: true },
        });
        const order = await this.readOrder(transaction, input.orderId);
        if (!order) {
          throw new Error("비전송 복구 증거가 가리키는 주문을 읽지 못했습니다.");
        }
        return {
          evidenceId: evidence.id,
          recordedAt: evidence.recordedAt,
          proofSha256: evidence.proofSha256,
          order,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }

  recoverPlannedOrderWithoutAuthorization(
    input: RecordPreAuthorizationNonDispatchRecoveryInput,
  ): Promise<StoredPreAuthorizationNonDispatchRecovery> {
    return this.database.$transaction(
      async (transaction) => {
        const evidence = await transaction.orderPreAuthorizationNonDispatchEvidence.create({
          data: {
            id: input.evidenceId,
            orderId: input.orderId,
            reservationId: input.reservationId,
            actor: input.actor,
          },
          select: { id: true, recordedAt: true, proofSha256: true },
        });
        const order = await this.readOrder(transaction, input.orderId);
        if (!order) {
          throw new Error("사전 승인 비전송 복구 증거가 가리키는 주문을 읽지 못했습니다.");
        }
        return {
          evidenceId: evidence.id,
          recordedAt: evidence.recordedAt,
          proofSha256: evidence.proofSha256,
          order,
        };
      },
      { isolationLevel: "Serializable" },
    );
  }

  recordSubmitOutcome(input: RecordSubmitOutcomeInput): Promise<StoredOrderReceipt | null> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."order_ledger"
          WHERE "id" = ${input.orderId}::uuid
            AND "mode" = 'LIVE'
          FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const [current] = await transaction.$queryRaw<CurrentStateLockRow[]>`
          SELECT
            "sequence",
            "normalized_state"::text AS "normalized_state",
            "filled_quantity",
            "filled_gross_notional_minor",
            "fee_minor"
          FROM public."order_state_history"
          WHERE "order_id" = ${input.orderId}::uuid
          ORDER BY "sequence" DESC
          LIMIT 1
        `;
        if (!current || current.normalized_state !== "SUBMITTING") return null;
        const evidence = await transaction.brokerOrderResponseEvidence.create({
          data: {
            id: input.evidenceId,
            orderId: input.orderId,
            evidenceKind: "SUBMIT",
            dispatchClaimId: input.dispatchClaimId,
            brokerOrderId: input.brokerOrderId,
            brokerStatusRaw: input.brokerStatusRaw,
            normalizationVersion: "TOSS_ORDER_NORMALIZATION_V1",
            validatedNormalizedState: input.validatedState,
            requestId: input.requestId,
            httpStatus: input.httpStatus,
            writeOutcome: input.brokerStatusRaw,
            safeErrorCode: input.safeErrorCode,
            redactedBody: input.redactedBody,
            redactionVersion: "TOSS_ORDER_REDACTION_V1",
            observedAt: input.observedAt,
          },
          select: { id: true },
        });
        await transaction.orderStateHistory.create({
          data: {
            orderId: input.orderId,
            sequence: current.sequence + 1,
            normalizedState: input.validatedState,
            actor: "EXECUTOR",
            brokerStatusRaw: input.brokerStatusRaw,
            brokerOrderId: input.brokerOrderId,
            brokerResponseEvidenceId: evidence.id,
            filledQuantity: 0n,
            filledGrossNotionalMinor: 0n,
            feeMinor: 0n,
            requestId: input.requestId,
            detail: {
              reason: input.safeErrorCode ?? "TOSS_ORDER_REQUEST_ACKNOWLEDGED",
              dispatchClaimId: input.dispatchClaimId,
            },
          },
        });
        return this.readOrder(transaction, input.orderId);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async liveOrderContext(orderId: string): Promise<StoredLiveOrderContext | null> {
    const order = await this.database.orderLedger.findUnique({
      where: { id: orderId },
      include: {
        account: { select: { externalRefHmac: true } },
        dispatchClaim: { select: { id: true, dispatchStartedAt: true } },
        reservation: { select: { id: true } },
        stateHistory: { orderBy: [{ sequence: "desc" }], take: 1 },
      },
    });
    const state = order?.stateHistory[0];
    if (!order || !state || order.mode !== "LIVE") return null;
    return {
      orderId: order.id,
      planId: order.planId,
      planVersion: order.planVersion,
      planOrderId: order.planOrderId,
      logicalOrderId: order.logicalOrderId,
      accountId: order.accountId,
      accountExternalRefHmac: order.account.externalRefHmac,
      clientOrderId: order.clientOrderId,
      canonicalIntentSha256: order.intentSha256,
      brokerOrderId: state.brokerOrderId,
      submissionAuthorizationId: state.submissionAuthorizationId,
      dispatchClaimId: order.dispatchClaim?.id ?? null,
      dispatchStartedAt: order.dispatchClaim?.dispatchStartedAt ?? null,
      reservationId: order.reservation?.id ?? null,
      state: state.normalizedState,
      stateOccurredAt: state.occurredAt,
      symbol: order.symbol,
      side: requireSide(order.side),
      orderType: order.orderType,
      timeInForce: order.timeInForce,
      quantity: order.quantity,
      limitPriceMinor: order.limitPriceMinor,
      filledQuantity: state.filledQuantity,
      filledGrossMinor: state.filledGrossNotionalMinor,
      feeMinor: state.feeMinor,
    };
  }

  latestAcceptedCancelAction(
    orderId: string,
  ): Promise<{ readonly id: string; readonly brokerActionOrderId: string } | null> {
    return this.database.brokerOrderAction.findFirst({
      where: { orderId, actionKind: "CANCEL", writeOutcome: "ACKNOWLEDGED" },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      select: { id: true, brokerActionOrderId: true },
    });
  }

  recordUnknownBlocked(input: {
    readonly evidenceId: string;
    readonly orderId: string;
    readonly brokerOrderId: string | null;
    readonly dispatchClaimId: string | null;
    readonly safeErrorCode: string;
    readonly observedAt: Date;
    readonly detail: Prisma.InputJsonValue;
  }): Promise<StoredOrderReceipt | null> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."order_ledger"
          WHERE "id" = ${input.orderId}::uuid
            AND "mode" = 'LIVE'
          FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const [current] = await transaction.$queryRaw<CurrentStateLockRow[]>`
          SELECT
            "sequence",
            "normalized_state"::text AS "normalized_state",
            "filled_quantity",
            "filled_gross_notional_minor",
            "fee_minor"
          FROM public."order_state_history"
          WHERE "order_id" = ${input.orderId}::uuid
          ORDER BY "sequence" DESC
          LIMIT 1
        `;
        if (
          !current ||
          (current.normalized_state !== "SUBMITTING" && current.normalized_state !== "UNKNOWN")
        ) {
          return null;
        }
        const evidence = await transaction.brokerOrderResponseEvidence.create({
          data: {
            id: input.evidenceId,
            orderId: input.orderId,
            evidenceKind: "RECONCILE",
            dispatchClaimId: input.dispatchClaimId,
            brokerOrderId: input.brokerOrderId,
            brokerStatusRaw: "INTEGRITY_BLOCKED",
            normalizationVersion: "TOSS_ORDER_NORMALIZATION_V1",
            validatedNormalizedState: "UNKNOWN_BLOCKED",
            requestId: null,
            httpStatus: null,
            writeOutcome: "INTEGRITY_BLOCKED",
            safeErrorCode: input.safeErrorCode,
            redactedBody: { unavailable: true },
            redactionVersion: "TOSS_ORDER_REDACTION_V1",
            observedAt: input.observedAt,
          },
          select: { id: true },
        });
        await transaction.orderStateHistory.create({
          data: {
            orderId: input.orderId,
            sequence: current.sequence + 1,
            normalizedState: "UNKNOWN_BLOCKED",
            actor: "RECONCILER",
            brokerStatusRaw: "INTEGRITY_BLOCKED",
            brokerOrderId: input.brokerOrderId,
            brokerResponseEvidenceId: evidence.id,
            filledQuantity: current.filled_quantity,
            filledGrossNotionalMinor: current.filled_gross_notional_minor,
            feeMinor: current.fee_minor,
            detail: input.detail,
          },
        });
        return this.readOrder(transaction, input.orderId);
      },
      { isolationLevel: "Serializable" },
    );
  }

  recordReconciliation(input: RecordReconciliationInput): Promise<StoredOrderReceipt | null> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."order_ledger"
          WHERE "id" = ${input.orderId}::uuid
            AND "mode" = 'LIVE'
          FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const [current] = await transaction.$queryRaw<CurrentStateLockRow[]>`
          SELECT
            "sequence",
            "normalized_state"::text AS "normalized_state",
            "filled_quantity",
            "filled_gross_notional_minor",
            "fee_minor"
          FROM public."order_state_history"
          WHERE "order_id" = ${input.orderId}::uuid
          ORDER BY "sequence" DESC
          LIMIT 1
        `;
        if (!current) return null;
        const evidence = await transaction.brokerOrderResponseEvidence.create({
          data: {
            id: input.evidenceId,
            orderId: input.orderId,
            evidenceKind: "RECONCILE",
            brokerOrderId: input.brokerOrderId,
            brokerStatusRaw: input.brokerStatusRaw,
            normalizationVersion: "TOSS_ORDER_NORMALIZATION_V1",
            validatedNormalizedState: input.validatedState,
            requestId: input.requestId,
            httpStatus: input.httpStatus,
            writeOutcome: "OBSERVED",
            safeErrorCode: null,
            redactedBody: input.redactedBody,
            redactionVersion: "TOSS_ORDER_REDACTION_V1",
            observedAt: input.observedAt,
          },
          select: { id: true },
        });
        const stateChanges =
          current.normalized_state !== input.validatedState ||
          (input.validatedState === "PARTIAL_FILLED" &&
            input.filledQuantity > current.filled_quantity);
        if (stateChanges) {
          await transaction.orderStateHistory.create({
            data: {
              orderId: input.orderId,
              sequence: current.sequence + 1,
              normalizedState: input.validatedState,
              actor: input.actor,
              brokerStatusRaw: input.brokerStatusRaw,
              brokerOrderId: input.brokerOrderId,
              brokerResponseEvidenceId: evidence.id,
              ...(input.brokerActionId ? { brokerActionId: input.brokerActionId } : {}),
              filledQuantity: input.filledQuantity,
              filledGrossNotionalMinor: input.filledGrossMinor,
              feeMinor: input.feeMinor,
              requestId: input.requestId,
              detail: input.detail,
            },
          });
        }
        return this.readOrder(transaction, input.orderId);
      },
      { isolationLevel: "Serializable" },
    );
  }

  createCancelOperatorAuthorization(input: CreateCancelOperatorAuthorizationInput) {
    return this.database.cancelOperatorAuthorization.create({
      data: input,
      select: {
        id: true,
        authorizationId: true,
        authorizationDigest: true,
        authorizedAt: true,
        expiresAt: true,
      },
    });
  }

  claimCancelDispatch(input: ClaimCancelDispatchInput) {
    return this.database.orderCancelDispatchClaim.create({
      data: input,
      select: { id: true, claimedAt: true },
    });
  }

  recordCancelOutcome(
    input: RecordCancelOutcomeInput,
  ): Promise<{ readonly kind: "ACTION" | "EVIDENCE"; readonly id: string }> {
    if (input.outcome === "ACKNOWLEDGED") {
      if (!input.brokerActionOrderId || input.httpStatus === null) {
        throw new Error("ACKNOWLEDGED cancel 결과에 child order ID 또는 HTTP status가 없습니다.");
      }
      return this.database.brokerOrderAction
        .create({
          data: {
            id: input.evidenceOrActionId,
            orderId: input.orderId,
            actionKind: "CANCEL",
            originalBrokerOrderId: input.brokerOrderId,
            brokerActionOrderId: input.brokerActionOrderId,
            brokerStatusRaw: "REQUEST_ACCEPTED",
            authorizationId: input.authorizationId,
            cancelDispatchClaimId: input.cancelDispatchClaimId,
            canonicalRequestDigest: input.canonicalRequestDigest,
            requestId: input.requestId,
            httpStatus: input.httpStatus,
            writeOutcome: "ACKNOWLEDGED",
            redactedBody: input.redactedBody,
            redactionVersion: "TOSS_ORDER_REDACTION_V1",
            observedAt: input.observedAt,
          },
          select: { id: true },
        })
        .then(({ id }) => ({ kind: "ACTION" as const, id }));
    }
    return this.database.brokerOrderResponseEvidence
      .create({
        data: {
          id: input.evidenceOrActionId,
          orderId: input.orderId,
          evidenceKind: "CANCEL_ATTEMPT",
          cancelDispatchClaimId: input.cancelDispatchClaimId,
          brokerOrderId: input.brokerOrderId,
          brokerStatusRaw: input.outcome,
          normalizationVersion: "TOSS_ORDER_NORMALIZATION_V1",
          validatedNormalizedState:
            input.outcome === "AMBIGUOUS"
              ? "UNKNOWN"
              : input.outcome === "INTEGRITY_BLOCKED"
                ? "UNKNOWN_BLOCKED"
                : null,
          requestId: input.requestId,
          httpStatus: input.httpStatus,
          writeOutcome: input.outcome,
          safeErrorCode: input.safeErrorCode,
          redactedBody: input.redactedBody,
          redactionVersion: "TOSS_ORDER_REDACTION_V1",
          observedAt: input.observedAt,
        },
        select: { id: true },
      })
      .then(({ id }) => ({ kind: "EVIDENCE" as const, id }));
  }

  appendPaperState(input: AppendPaperStateInput): Promise<StoredOrderReceipt | null> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."order_ledger"
          WHERE "id" = ${input.orderId}::uuid
            AND "mode" = 'PAPER'
          FOR UPDATE
        `;
        if (locked.length !== 1) return null;
        const [current] = await transaction.$queryRaw<CurrentStateLockRow[]>`
          SELECT
            "sequence",
            "normalized_state"::text AS "normalized_state",
            "filled_quantity",
            "filled_gross_notional_minor",
            "fee_minor"
          FROM public."order_state_history"
          WHERE "order_id" = ${input.orderId}::uuid
          ORDER BY "sequence" DESC
          LIMIT 1
        `;
        if (!current) return null;
        await transaction.orderStateHistory.create({
          data: {
            orderId: input.orderId,
            sequence: current.sequence + 1,
            normalizedState: input.state,
            actor: "EXECUTOR",
            filledQuantity: input.filledQuantity,
            filledGrossNotionalMinor: input.filledGrossMinor,
            feeMinor: input.feeMinor,
            detail: input.detail,
          },
        });
        return this.readOrder(transaction, input.orderId);
      },
      { isolationLevel: "Serializable" },
    );
  }

  ordersSnapshot(
    filter: { readonly planId?: string } = {},
  ): Promise<readonly StoredOrderReceipt[]> {
    return this.readOrders(this.database, filter);
  }

  appendKillSwitch(input: {
    readonly accountId: string;
    readonly state: "ENGAGED" | "DISENGAGED";
    readonly reason: string;
    readonly actor: string;
  }): Promise<"SAVED" | "UNCHANGED" | "NO_ACCOUNT"> {
    return this.database.$transaction(
      async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."broker_account"
          WHERE "id" = ${input.accountId}::uuid
          FOR UPDATE
        `;
        if (locked.length !== 1) return "NO_ACCOUNT";
        const current = await transaction.killSwitchEvent.findFirst({
          where: { accountId: input.accountId },
          orderBy: [{ version: "desc" }],
          select: { version: true, state: true },
        });
        if (current?.state === input.state) return "UNCHANGED";
        let version = (current?.version ?? 0) + 1;
        if (!current && input.state === "DISENGAGED") {
          await transaction.killSwitchEvent.create({
            data: {
              accountId: input.accountId,
              version,
              state: "ENGAGED",
              reason: "초기 킬 스위치를 안전하게 작동 상태로 설정합니다.",
              actor: "engine-safety-bootstrap",
            },
          });
          version += 1;
        }
        await transaction.killSwitchEvent.create({
          data: {
            accountId: input.accountId,
            version,
            state: input.state,
            reason: input.reason,
            actor: input.actor,
          },
        });
        return "SAVED";
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async ensureDailyLimit(
    transaction: TransactionClient,
    input: {
      readonly accountId: string;
      readonly mode: "PAPER" | "LIVE";
      readonly grossLimitMinor: bigint;
    },
  ): Promise<string | null> {
    await transaction.$executeRaw`
      INSERT INTO public."daily_trade_limit" (
        "account_id", "trade_day", "market_country", "currency", "mode", "gross_limit_minor"
      ) VALUES (
        ${input.accountId}::uuid,
        (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
        'KR',
        'KRW',
        ${input.mode}::public."RebalanceMode",
        ${input.grossLimitMinor}
      )
      ON CONFLICT ("account_id", "trade_day", "market_country", "mode") DO NOTHING
    `;
    const [limit] = await transaction.$queryRaw<Array<{ id: string; gross_limit_minor: bigint }>>`
      SELECT "id", "gross_limit_minor"
      FROM public."daily_trade_limit"
      WHERE "account_id" = ${input.accountId}::uuid
        AND "trade_day"
          = (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date
        AND "market_country" = 'KR'
        AND "currency" = 'KRW'
        AND "mode" = ${input.mode}::public."RebalanceMode"
      FOR UPDATE
    `;
    return limit?.gross_limit_minor === input.grossLimitMinor ? limit.id : null;
  }

  private async readOrders(
    client: Pick<DatabaseClient, "orderLedger">,
    filter: { readonly planId?: string },
  ): Promise<readonly StoredOrderReceipt[]> {
    const orders = await client.orderLedger.findMany({
      ...(filter.planId ? { where: { planId: filter.planId } } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: orderReceiptInclude,
    });
    return orders.map(toStoredOrderReceipt);
  }

  private async readOrder(
    client: Pick<DatabaseClient, "orderLedger">,
    orderId: string,
  ): Promise<StoredOrderReceipt | null> {
    const order = await client.orderLedger.findUnique({
      where: { id: orderId },
      include: orderReceiptInclude,
    });
    return order ? toStoredOrderReceipt(order) : null;
  }
}

function requirePhase(value: string): "SELL" | "BUY" {
  if (value === "SELL" || value === "BUY") return value;
  throw new Error("저장된 주문 phase가 SELL 또는 BUY가 아닙니다.");
}

function toStoredOrderReceipt(order: OrderReceiptRecord): StoredOrderReceipt {
  return {
    id: order.id,
    logicalOrderId: order.logicalOrderId,
    planId: order.planId,
    planOrderId: order.planOrderId,
    mode: requireExecutionMode(order.mode),
    instrumentKey: order.planOrder.instrumentKey,
    symbol: order.symbol,
    side: requireSide(order.side),
    quantity: order.quantity,
    limitPriceMinor: order.limitPriceMinor,
    plannedGrossMinor: order.plannedGrossNotionalMinor,
    reservedGrossMinor: order.reservedGrossMinor,
    clientOrderId: order.clientOrderId,
    createdAt: order.createdAt,
    timeline: order.stateHistory.map((entry) => ({
      sequence: entry.sequence,
      state: entry.normalizedState,
      brokerStatusRaw: entry.brokerStatusRaw,
      brokerOrderId: entry.brokerOrderId,
      brokerActionOrderId: entry.brokerAction?.brokerActionOrderId ?? null,
      filledQuantity: entry.filledQuantity,
      filledGrossMinor: entry.filledGrossNotionalMinor,
      feeMinor: entry.feeMinor,
      occurredAt: entry.occurredAt,
      detail: entry.detail,
    })),
  };
}

function requireExecutionMode(value: string): "PAPER" | "LIVE" {
  if (value === "PAPER" || value === "LIVE") return value;
  throw new Error("저장된 주문 실행 모드가 PAPER 또는 LIVE가 아닙니다.");
}

function requireSide(value: string): "BUY" | "SELL" {
  if (value === "BUY" || value === "SELL") return value;
  throw new Error("저장된 주문 방향이 BUY 또는 SELL이 아닙니다.");
}
