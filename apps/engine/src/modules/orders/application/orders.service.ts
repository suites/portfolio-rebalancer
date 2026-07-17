import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  issueLiveOrderCancelAuthorization,
  issueLiveOrderSubmitAuthorization,
  type AccountId,
  type BrokerOrderCancelRequest,
  type BrokerReadResult,
  type IsoDate,
  type IsoDateTime,
  type KrwLimitDayOrderRequest,
  type PriceQuote,
  type SymbolCode,
} from "@portfolio-rebalancer/broker";
import {
  CancelOrderInputSchema,
  CancelOrderReceiptSchema,
  CreateLivePlanApprovalInputSchema,
  ExecuteRebalancePlanInputSchema,
  ExecuteRebalancePlanReceiptSchema,
  KillSwitchCommandSchema,
  LivePlanApprovalReceiptSchema,
  OperationalConfigSchema,
  OrdersSnapshotSchema,
  RecoverUnknownOrderInputSchema,
  StoredOrderReceiptSchema,
  type CreateLivePlanApprovalInputContract,
  type CancelOrderInputContract,
  type CancelOrderReceiptContract,
  type ExecuteRebalancePlanInputContract,
  type ExecuteRebalancePlanReceiptContract,
  type KillSwitchCommandContract,
  type LivePlanApprovalReceiptContract,
  type OrdersSnapshotContract,
  type RecoverUnknownOrderInputContract,
  type StoredOrderReceiptContract,
} from "@portfolio-rebalancer/contracts";
import type { Prisma } from "@portfolio-rebalancer/database";
import {
  CLIENT_ORDER_ID_VERSION,
  PAPER_EXECUTION_FIXTURE_VERSION,
  createCancelOperatorAuthorizationCanonical,
  createCancelRequestDigest,
  composeLiveSubmitRiskDecision,
  createCanonicalOrderIntent,
  createCanonicalOrderIntentDigest,
  createManualLiveOrderApproval,
  createOrderDispatchClaimCanonical,
  createOrderCancelDispatchClaimCanonical,
  createOrderSubmissionAuthorizationCanonical,
  createTossClientOrderId,
  evaluateExecutionRiskGate,
  evaluateCancelRiskGate,
  evaluateAmbiguousOrderRecovery,
  evaluatePreSubmitOrderEvidence,
  simulatePaperLimitDayOrder,
  type CanonicalOrderIntent,
  type ExecutionOperationalConfig,
  type PlannedExecutionOrder,
} from "@portfolio-rebalancer/application";

import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import {
  operatorAuditActor,
  type EngineOperatorAuditContext,
} from "../../../common/audit/operator-audit-context";
import { assertVercelEgressConfigured, type EngineConfig } from "../../../config/engine.config";
import { createAccountReference } from "../../portfolio/application/collect-portfolio.use-case";
import {
  normalizeTossInstrumentValidation,
  selectExactStock,
} from "../../portfolio/application/instrument-catalog";
import { safeErrorMetadata } from "../../portfolio/application/safe-error-metadata";
import { redactTossResponseBody } from "../../portfolio/infrastructure/broker/toss-read-source.adapter";
import {
  TossRuntimeService,
  type TossRuntime,
} from "../../portfolio/infrastructure/broker/toss-runtime.service";
import { PrismaPortfolioRepository } from "../../portfolio/infrastructure/persistence/prisma-portfolio.repository";
import { PrismaOperationalConfigRepository } from "../../operational-config/infrastructure/persistence/prisma-operational-config.repository";
import { OrderExecutionError } from "../domain/order-execution.error";
import {
  PrismaOrderRepository,
  type CreatePaperOrderRecord,
  type StoredExecutionContext,
  type StoredLiveOrderContext,
  type StoredManualApproval,
  type StoredOrderReceipt,
} from "../infrastructure/persistence/prisma-order.repository";

const SERVICE_ACTOR = "engine-service-api";
const ORDER_RESERVATION_POLICY_VERSION = "ORDER_GROSS_RESERVATION_V1";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(PrismaOrderRepository)
    private readonly repository: PrismaOrderRepository,
    @Inject(PrismaOperationalConfigRepository)
    private readonly operationalConfigRepository: PrismaOperationalConfigRepository,
    @Inject(PrismaPortfolioRepository)
    private readonly portfolioRepository: PrismaPortfolioRepository,
    @Inject(TossRuntimeService)
    private readonly tossRuntime: TossRuntimeService,
  ) {}

  async snapshot(): Promise<OrdersSnapshotContract> {
    try {
      const [orders, operationalState] = await Promise.all([
        this.repository.ordersSnapshot(),
        this.operationalConfigRepository.currentState(),
      ]);
      return OrdersSnapshotSchema.parse({
        state: orders.length === 0 ? "EMPTY" : "READY",
        killSwitch: operationalState.killSwitch,
        orders: orders.map(presentOrder),
        liveOrdersEnabled: liveOrdersEnabled(operationalState),
      });
    } catch (error) {
      this.logger.warn({ event: "orders_snapshot_blocked", ...safeErrorMetadata(error) });
      return OrdersSnapshotSchema.parse({
        state: "UNAVAILABLE",
        killSwitch: "UNKNOWN",
        orders: [],
        liveOrdersEnabled: false,
      });
    }
  }

  async createLivePlanApproval(
    input: CreateLivePlanApprovalInputContract,
    operator: EngineOperatorAuditContext,
  ): Promise<LivePlanApprovalReceiptContract> {
    const parsed = CreateLivePlanApprovalInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "Live 계획 승인 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const context = await this.requiredExecutionContext(parsed.data.planId);
    if (
      context.plan.mode !== "LIVE" ||
      context.plan.status !== "PLANNED" ||
      context.plan.planHash !== parsed.data.planHash ||
      context.plan.orders.length === 0
    ) {
      throw new OrderExecutionError(
        "ORDER_APPROVAL_INVALID",
        "현재 저장된 실행 가능한 Live 계획과 확인한 계획 해시가 일치하지 않습니다.",
        "CONFLICT",
      );
    }
    const operational = parseOperationalConfig(context);
    const actor = operatorAuditActor(operator);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + operational.live.approvalTtlSeconds * 1_000);
    const records = context.plan.orders.map((order) => {
      const id = randomUUID();
      const approval = createManualLiveOrderApproval({
        accountId: context.account.id,
        planOrderId: order.id,
        planHash: context.plan.planHash,
        actor,
        createdAt: now,
        expiresAt,
      });
      return {
        id,
        planOrderId: order.id,
        accountId: context.account.id,
        approvalHash: approval.approvalHash,
        planHash: context.plan.planHash,
        actor,
        confirmationVersion: approval.confirmationVersion,
        canonicalContent: approval.canonicalContent,
        createdAt: now,
        expiresAt,
      };
    });
    const stored = await this.repository.createManualApprovals(
      context.plan.id,
      context.plan.planVersion,
      records,
    );
    if (!stored) {
      throw new OrderExecutionError(
        "ORDER_APPROVAL_STALE",
        "승인 저장 중 계획이 바뀌었거나 아직 유효한 승인 묶음이 있어 새 승인을 만들지 않았습니다.",
        "CONFLICT",
      );
    }
    return LivePlanApprovalReceiptSchema.parse({
      planId: context.plan.id,
      planHash: context.plan.planHash,
      approvals: stored.map((approval) => ({
        approvalId: approval.id,
        planOrderId: approval.planOrderId,
        planHash: approval.planHash,
        expiresAt: approval.expiresAt.toISOString(),
      })),
    });
  }

  async execute(
    input: ExecuteRebalancePlanInputContract,
    operator?: EngineOperatorAuditContext,
  ): Promise<ExecuteRebalancePlanReceiptContract> {
    const parsed = ExecuteRebalancePlanInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "주문 실행 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const context = await this.requiredExecutionContext(parsed.data.planId);
    if (parsed.data.mode === "LIVE") {
      if (!operator) {
        throw new OrderExecutionError(
          "ORDER_APPROVAL_INVALID",
          "Live 실행 감사 주체가 없어 안전하게 차단했습니다.",
          "BAD_REQUEST",
        );
      }
      return this.executeLive(context, parsed.data.approvalIds);
    }
    return this.executePaper(context);
  }

  async setKillSwitch(
    input: KillSwitchCommandContract,
    operator: EngineOperatorAuditContext,
  ): Promise<OrdersSnapshotContract> {
    const parsed = KillSwitchCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "킬 스위치 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const state = await this.operationalConfigRepository.currentState();
    if (!state.account) {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        "킬 스위치를 변경할 계좌가 없습니다. 먼저 포트폴리오를 새로고침하세요.",
        "CONFLICT",
      );
    }
    const result = await this.repository.appendKillSwitch({
      accountId: state.account.id,
      state: parsed.data.state,
      reason: parsed.data.reason,
      actor: operatorAuditActor(operator),
    });
    if (result === "NO_ACCOUNT") {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        "킬 스위치 변경 중 계좌가 사라져 안전하게 중단했습니다.",
        "CONFLICT",
      );
    }
    return this.snapshot();
  }

  async cancel(
    input: CancelOrderInputContract,
    operator: EngineOperatorAuditContext,
  ): Promise<CancelOrderReceiptContract> {
    const parsed = CancelOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "주문 취소 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    assertVercelEgressConfigured(this.config);
    const accountSeq = this.config.TOSSINVEST_ACCOUNT_SEQ;
    if (!accountSeq) {
      throw new OrderExecutionError(
        "BROKER_EXECUTION_UNAVAILABLE",
        "취소할 토스증권 계좌 순번이 설정되지 않았습니다.",
        "UNAVAILABLE",
      );
    }
    const context = await this.repository.liveOrderContext(parsed.data.orderId);
    if (
      !context ||
      !context.brokerOrderId ||
      (context.state !== "PENDING" && context.state !== "PARTIAL_FILLED")
    ) {
      throw new OrderExecutionError(
        "ORDER_CANCEL_BLOCKED",
        "현재 주문이 브로커 ID가 확인된 PENDING 또는 PARTIAL_FILLED 상태가 아니어서 취소를 차단했습니다.",
        "CONFLICT",
      );
    }
    const runtime = this.tossRuntime.get();
    await this.requireBoundBrokerAccount(
      runtime,
      accountSeq,
      context.accountId,
      context.accountExternalRefHmac,
      "LIVE_CANCEL_ACCOUNT_BINDING",
      context.orderId,
    );
    const brokerAccountReference = String(accountSeq);
    const request: BrokerOrderCancelRequest = {
      planId: context.planId,
      planOrderId: context.planOrderId,
      logicalOrderId: context.logicalOrderId,
      accountId: context.accountId as AccountId,
      brokerAccountReference,
      clientOrderId: context.clientOrderId,
      brokerOrderId: context.brokerOrderId,
      primaryLedgerState: context.state,
    };
    const originalOrder = {
      planId: context.planId,
      planOrderId: context.planOrderId,
      logicalOrderId: context.logicalOrderId,
      accountId: context.accountId as AccountId,
      brokerAccountReference,
      clientOrderId: context.clientOrderId,
      brokerOrderId: context.brokerOrderId,
      state: context.state,
    } as const;
    const operatorAuthorizationId = randomUUID();
    const authorizationId = randomUUID();
    const authorizedAt = new Date();
    const expiresAt = new Date(authorizedAt.getTime() + 30_000);
    const canonicalRequestDigest = createCancelRequestDigest(request);
    const actor = operatorAuditActor(operator);
    const unsignedAuthorization = {
      authorizationId,
      actor,
      action: "CANCEL",
      orderIdentity: originalOrder,
      canonicalRequestDigest,
      authorizedAt,
      expiresAt,
      evidenceReference: operatorAuthorizationId,
    } as const;
    const canonicalAuthorization =
      createCancelOperatorAuthorizationCanonical(unsignedAuthorization);
    await this.repository.createCancelOperatorAuthorization({
      id: operatorAuthorizationId,
      orderId: context.orderId,
      authorizationId,
      actor,
      action: "CANCEL",
      confirmationVersion: "CANCEL_ORDER_CONFIRMATION_V1",
      canonicalContent: canonicalAuthorization.canonicalContent,
      canonicalRequestDigest,
      authorizationDigest: canonicalAuthorization.authorizationDigest,
      authorizedAt,
      expiresAt,
    });
    const decision = evaluateCancelRiskGate({
      originalOrder,
      request,
      operatorAuthorization: {
        ...unsignedAuthorization,
        authorizationDigest: canonicalAuthorization.authorizationDigest,
        consumedAt: null,
      },
      now: new Date(),
    });
    if (!decision.canExecute) {
      throw new OrderExecutionError(
        "ORDER_CANCEL_BLOCKED",
        firstBlockedMessage(decision.checks),
        "CONFLICT",
      );
    }
    const cancelDispatchClaimId = randomUUID();
    let persistedClaimId: string | null = null;
    const authorization = issueLiveOrderCancelAuthorization({
      authorizationId,
      planId: context.planId,
      planOrderId: context.planOrderId,
      logicalOrderId: context.logicalOrderId,
      accountId: context.accountId as AccountId,
      brokerAccountReference,
      clientOrderId: context.clientOrderId,
      brokerOrderId: context.brokerOrderId,
      riskDecision: decision,
      issuedAt: authorizedAt,
      expiresAt,
      ledgerState: context.state,
      audit: async (intent) => {
        if (
          intent.action !== "CANCEL" ||
          intent.authorizationId !== authorizationId ||
          intent.canonicalRequestDigest !== canonicalRequestDigest
        ) {
          throw new Error("Live cancel audit intent가 봉인된 권한과 일치하지 않습니다.");
        }
        const claim = createOrderCancelDispatchClaimCanonical({
          cancelDispatchClaimId,
          cancelOperatorAuthorizationId: operatorAuthorizationId,
          authorizationId,
          planId: context.planId,
          planVersion: context.planVersion,
          planOrderId: context.planOrderId,
          logicalOrderId: context.logicalOrderId,
          accountId: context.accountId,
          clientOrderId: context.clientOrderId,
          canonicalIntentSha256: context.canonicalIntentSha256,
          authorizedRequestDigest: canonicalRequestDigest,
          brokerAccountReferenceHmac: context.accountExternalRefHmac,
          brokerOrderId: context.brokerOrderId!,
          ledgerState: context.state as "PENDING" | "PARTIAL_FILLED",
          operatorAuthorizationDigest: canonicalAuthorization.authorizationDigest,
          authorizationIssuedAt: authorizedAt,
          authorizationExpiresAt: expiresAt,
        });
        await this.repository.claimCancelDispatch({
          id: cancelDispatchClaimId,
          cancelOperatorAuthorizationId: operatorAuthorizationId,
          orderId: context.orderId,
          authorizationId,
          planId: context.planId,
          planVersion: context.planVersion,
          planOrderId: context.planOrderId,
          logicalOrderId: context.logicalOrderId,
          canonicalRequest: claim.canonicalRequest,
          claimEnvelopeDigest: claim.claimEnvelopeDigest,
          authorizedRequestDigest: canonicalRequestDigest,
          clientOrderId: context.clientOrderId,
          brokerAccountReferenceHmac: context.accountExternalRefHmac,
          brokerOrderId: context.brokerOrderId!,
          ledgerState: context.state as "PENDING" | "PARTIAL_FILLED",
          operatorAuthorizationDigest: canonicalAuthorization.authorizationDigest,
          authorizationIssuedAt: authorizedAt,
          authorizationExpiresAt: expiresAt,
          intentAuditedAt: new Date(),
          dispatchStartedAt: new Date(),
        });
        persistedClaimId = cancelDispatchClaimId;
        return cancelDispatchClaimId;
      },
    });
    const result = await runtime.requestAuditContext.run(
      { workflowType: "LIVE_ORDER_CANCEL", correlationId: context.orderId },
      () => runtime.liveOrders.cancelOrder(authorization, request),
    );
    if (persistedClaimId === null) {
      throw new OrderExecutionError(
        "ORDER_CANCEL_BLOCKED",
        "취소 요청 전 일회성 dispatch claim 저장에 실패해 브로커 취소 요청을 재전송하지 않습니다.",
        "UNAVAILABLE",
      );
    }
    const recorded = await this.repository.recordCancelOutcome({
      evidenceOrActionId: randomUUID(),
      orderId: context.orderId,
      cancelDispatchClaimId: persistedClaimId,
      authorizationId,
      canonicalRequestDigest,
      brokerOrderId: context.brokerOrderId,
      brokerActionOrderId: result.brokerActionOrderId,
      outcome: result.outcome,
      requestId: result.metadata.requestId,
      httpStatus: result.metadata.httpStatus,
      safeErrorCode: result.reasonCode,
      redactedBody: redactOrderPayload(result.rawPayload, this.config),
      observedAt: new Date(result.metadata.receivedAt),
    });
    let currentOrder = await this.requiredStoredOrder(context);
    if (result.outcome === "ACKNOWLEDGED" && recorded.kind === "ACTION") {
      const refreshed = await this.repository.liveOrderContext(context.orderId);
      if (refreshed) {
        currentOrder = await this.reconcileLiveOrder(refreshed, recorded.id, "RECONCILER");
      }
    }
    const currentState = currentOrder.timeline.at(-1)?.state ?? context.state;
    return CancelOrderReceiptSchema.parse({
      orderId: context.orderId,
      outcome:
        result.outcome === "ACKNOWLEDGED"
          ? "REQUEST_ACCEPTED"
          : result.outcome === "REJECTED"
            ? "REJECTED"
            : result.outcome === "AMBIGUOUS"
              ? "UNKNOWN"
              : "BLOCKED",
      currentState,
      brokerActionOrderId: result.brokerActionOrderId,
      message:
        result.outcome === "ACKNOWLEDGED"
          ? "취소 요청이 접수되었습니다. 최종 CANCELED 상태는 브로커 원 주문 조회로만 확정합니다."
          : "취소 요청이 거부되었거나 결과가 불명확해 원 주문을 재제출하지 않습니다.",
    });
  }

  async recoverUnknown(
    input: RecoverUnknownOrderInputContract,
    operator: EngineOperatorAuditContext,
  ): Promise<StoredOrderReceiptContract> {
    const parsed = RecoverUnknownOrderInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "UNKNOWN_BLOCKED 복구 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    assertVercelEgressConfigured(this.config);
    const context = await this.repository.liveOrderContext(parsed.data.orderId);
    if (
      !context ||
      context.state !== "UNKNOWN_BLOCKED" ||
      (context.brokerOrderId !== null && context.brokerOrderId !== parsed.data.brokerOrderId) ||
      (context.brokerOrderId === null && context.dispatchClaimId === null)
    ) {
      throw new OrderExecutionError(
        "ORDER_RECOVERY_BLOCKED",
        "복구 대상이 dispatch 증거가 있는 UNKNOWN_BLOCKED 주문과 정확히 일치하지 않습니다.",
        "CONFLICT",
      );
    }
    const recovered = await this.reconcileLiveOrder(context, null, "OPERATOR", {
      state: parsed.data.resolvedState,
      brokerOrderId: parsed.data.brokerOrderId,
      limitPriceMinor: BigInt(parsed.data.limitPriceMinor),
      filledQuantity: BigInt(parsed.data.filledQuantity),
      filledGrossMinor: BigInt(parsed.data.filledGrossMinor),
      feeMinor: BigInt(parsed.data.feeMinor),
      evidenceReference: [parsed.data.brokerEvidenceReference, operatorAuditActor(operator)].join(
        " | ",
      ),
    });
    return StoredOrderReceiptSchema.parse(presentOrder(recovered));
  }

  async reconcile(orderId: string): Promise<StoredOrderReceiptContract> {
    if (!isUuid(orderId)) {
      throw new OrderExecutionError(
        "ORDER_INPUT_INVALID",
        "조회할 주문 ID가 UUID 형식이 아닙니다.",
        "BAD_REQUEST",
      );
    }
    const context = await this.repository.liveOrderContext(orderId);
    if (!context) {
      throw new OrderExecutionError(
        "ORDER_NOT_FOUND",
        "조정할 Live 주문을 찾지 못했습니다.",
        "CONFLICT",
      );
    }
    if (["FILLED", "CANCELED", "REJECTED"].includes(context.state)) {
      return StoredOrderReceiptSchema.parse(presentOrder(await this.requiredStoredOrder(context)));
    }
    if (context.state === "PLANNED") {
      if (!context.reservationId) {
        throw new OrderExecutionError(
          "ORDER_RECOVERY_BLOCKED",
          "PLANNED Live 주문의 예약 증거를 확인하지 못해 임의 복구하지 않습니다.",
          "CONFLICT",
        );
      }
      try {
        const recovery = await this.repository.recoverPlannedOrderWithoutAuthorization({
          evidenceId: randomUUID(),
          orderId,
          reservationId: context.reservationId,
          actor: SERVICE_ACTOR,
        });
        return StoredOrderReceiptSchema.parse(presentOrder(recovery.order));
      } catch (error) {
        this.logger.warn({
          event: "live_order_pre_authorization_recovery_blocked",
          orderId,
          ...safeErrorMetadata(error),
        });
        throw new OrderExecutionError(
          "ORDER_RECOVERY_BLOCKED",
          "Live 원장과 예약 뒤 A 승인이 없었다는 증거를 확정하지 못해 주문을 재제출하거나 예약을 임의 해제하지 않습니다.",
          "CONFLICT",
        );
      }
    }
    if (context.brokerOrderId) {
      const cancelAction = await this.repository.latestAcceptedCancelAction(orderId);
      const reconciled = await this.reconcileLiveOrder(
        context,
        cancelAction?.id ?? null,
        "RECONCILER",
      );
      return StoredOrderReceiptSchema.parse(presentOrder(reconciled));
    }
    if (
      context.dispatchClaimId &&
      context.dispatchStartedAt &&
      (context.state === "SUBMITTING" || context.state === "UNKNOWN")
    ) {
      const decision = evaluateAmbiguousOrderRecovery({
        ambiguousSince: context.dispatchStartedAt,
        now: new Date(),
        reconciledBrokerState: null,
      });
      if (decision.action === "TRANSITION_UNKNOWN_BLOCKED") {
        const blocked = await this.repository.recordUnknownBlocked({
          evidenceId: randomUUID(),
          orderId,
          brokerOrderId: null,
          dispatchClaimId: context.state === "SUBMITTING" ? context.dispatchClaimId : null,
          safeErrorCode: decision.reasonCode,
          observedAt: new Date(),
          detail: {
            reason: decision.reasonCode,
            message:
              "dispatch claim 이후 불변 clientOrderId가 포함된 조회 증거로 브로커 주문을 자동 귀속할 수 없어 운영자 exact 복구가 필요합니다.",
            canResubmit: false,
            dispatchClaimId: context.dispatchClaimId,
          },
        });
        if (!blocked) {
          throw orderStoreUnavailable("dispatch 이후 주문을 UNKNOWN_BLOCKED로 잠그지 못했습니다.");
        }
        return StoredOrderReceiptSchema.parse(presentOrder(blocked));
      }
      return StoredOrderReceiptSchema.parse(presentOrder(await this.requiredStoredOrder(context)));
    }
    if (context.state === "SUBMITTING" && context.submissionAuthorizationId) {
      try {
        const recovery = await this.repository.recoverAuthorizedOrderWithoutDispatch({
          evidenceId: randomUUID(),
          submissionAuthorizationId: context.submissionAuthorizationId,
          orderId,
          actor: SERVICE_ACTOR,
        });
        return StoredOrderReceiptSchema.parse(presentOrder(recovery.order));
      } catch (error) {
        this.logger.warn({
          event: "live_order_non_dispatch_recovery_blocked",
          orderId,
          ...safeErrorMetadata(error),
        });
        throw new OrderExecutionError(
          "ORDER_RECOVERY_BLOCKED",
          "SUBMITTING 승인 뒤 실제 전송이 없었다는 증거를 확정하지 못했습니다. dispatch claim이 존재할 수 있으므로 주문을 재제출하지 않습니다.",
          "CONFLICT",
        );
      }
    }
    if (context.state === "UNKNOWN") {
      const decision = evaluateAmbiguousOrderRecovery({
        ambiguousSince: context.stateOccurredAt,
        now: new Date(),
        reconciledBrokerState: null,
      });
      if (decision.action === "TRANSITION_UNKNOWN_BLOCKED") {
        const blocked = await this.repository.recordUnknownBlocked({
          evidenceId: randomUUID(),
          orderId,
          brokerOrderId: null,
          dispatchClaimId: null,
          safeErrorCode: decision.reasonCode,
          observedAt: new Date(),
          detail: {
            reason: decision.reasonCode,
            message: decision.message,
            canResubmit: false,
          },
        });
        if (!blocked) {
          throw orderStoreUnavailable("불명확 주문을 UNKNOWN_BLOCKED로 잠그지 못했습니다.");
        }
        return StoredOrderReceiptSchema.parse(presentOrder(blocked));
      }
      return StoredOrderReceiptSchema.parse(presentOrder(await this.requiredStoredOrder(context)));
    }
    throw new OrderExecutionError(
      "ORDER_RECOVERY_BLOCKED",
      "브로커 주문 ID가 없는 PENDING 주문 또는 승인 증거가 누락된 SUBMITTING 주문은 자동 재제출하거나 임의 복구하지 않습니다.",
      "CONFLICT",
    );
  }

  private async executePaper(
    context: StoredExecutionContext,
  ): Promise<ExecuteRebalancePlanReceiptContract> {
    const prepared = prepareOrderIntents(context);
    const operational = parseOperationalConfig(context);
    const decision = evaluateExecutionRiskGate({
      operationalConfig: {
        status: "VALID",
        value: toExecutionConfig(
          operational,
          context.killSwitch !== "DISENGAGED" || operational.killSwitch,
        ),
      },
      requestedMode: "PAPER",
      now: new Date(),
      accountExternalRefHmac: context.account.externalRefHmac,
      plan: {
        planId: context.plan.id,
        planHash: context.plan.planHash,
        mode: requireExecutionMode(context.plan.mode),
        snapshotId: context.plan.snapshotId,
        snapshotDigest: context.plan.snapshotDigest,
        targetConfigVersionId: context.plan.targetConfigVersionId,
        targetConfigContentHash: context.plan.targetConfigContentHash,
        orders: prepared.map(({ planned }) => planned),
      },
      currentIdentity: requireCurrentIdentity(context),
      existingOrders: context.existingOrders,
      tradeDayFilledGrossMinor: context.tradeDayFilledGrossMinor,
      reservedPendingGrossMinor: context.reservedPendingGrossMinor,
      baselinePortfolioValueMinor: requiredPortfolioValue(context),
      projectedExposure: projectedExposure(context),
      manualApproval: null,
    });
    if (!decision.canExecute) {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        firstBlockedMessage(decision.checks),
        "CONFLICT",
      );
    }
    const records: CreatePaperOrderRecord[] = prepared.map(({ order, intent, logicalOrderId }) => ({
      id: randomUUID(),
      planId: context.plan.id,
      planOrderId: order.id,
      accountId: context.account.id,
      logicalOrderId,
      clientOrderId: createTossClientOrderId(intent),
      clientOrderIdVersion: CLIENT_ORDER_ID_VERSION,
      canonicalIntent: createCanonicalOrderIntent(intent),
      intentSha256: createCanonicalOrderIntentDigest(intent),
      planVersion: context.plan.planVersion,
      phase: order.phase,
      marketCountry: "KR",
      currency: "KRW",
      symbol: order.symbol,
      side: requireSide(order.side),
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: order.quantity,
      limitPriceMinor: order.limitPriceMinor,
      plannedGrossNotionalMinor: order.notionalMinor,
      reservedGrossMinor: order.notionalMinor,
      reservationBasisPriceMinor: order.limitPriceMinor,
      reservationPolicyVersion: ORDER_RESERVATION_POLICY_VERSION,
    }));
    const created = await this.repository.createPaperOrders({
      accountId: context.account.id,
      grossLimitMinor: BigInt(operational.limits.maxDailyGrossMinor),
      orders: records,
    });
    if (!created) {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        "Paper 주문 원장 생성 중 계획 또는 일일 한도가 변경되어 실행을 중단했습니다.",
        "CONFLICT",
      );
    }
    const pending: StoredOrderReceipt[] = [];
    for (const order of created.slice().reverse()) {
      const submitting = await this.repository.appendPaperState({
        orderId: order.id,
        state: "SUBMITTING",
        filledQuantity: 0n,
        filledGrossMinor: 0n,
        feeMinor: 0n,
        detail: {
          reason: "PAPER_SUBMISSION_STARTED",
          executionRiskChecks: decision.checks.map((check) => ({
            code: check.code,
            outcome: check.outcome,
            message: check.message,
            subjectKey: check.subjectKey,
          })),
        },
      });
      if (!submitting) {
        throw orderStoreUnavailable("Paper 주문을 SUBMITTING 상태로 기록하지 못했습니다.");
      }
      const replay = await this.replayPaperOrder(context, submitting, operational).catch(
        (error: unknown) => {
          this.logger.warn({
            event: "paper_order_replay_blocked",
            orderId: order.id,
            ...safeErrorMetadata(error),
          });
          return null;
        },
      );
      const accepted = await this.repository.appendPaperState({
        orderId: order.id,
        state: "PENDING",
        filledQuantity: 0n,
        filledGrossMinor: 0n,
        feeMinor: 0n,
        detail: {
          reason: replay ? replay.reasonCode : "PAPER_REPLAY_UNAVAILABLE",
          simulator: "PAPER_ORDERBOOK_REPLAY",
          broker: null,
          replay: replay?.detail ?? null,
        },
      });
      if (!accepted) {
        throw orderStoreUnavailable("Paper 주문을 PENDING 상태로 기록하지 못했습니다.");
      }
      if (replay?.transition) {
        const progressed = await this.repository.appendPaperState({
          orderId: order.id,
          state: replay.transition.state,
          filledQuantity: replay.transition.filledQuantity,
          filledGrossMinor: replay.transition.filledGrossMinor,
          feeMinor: replay.transition.feeMinor,
          detail: replay.detail,
        });
        if (!progressed) {
          throw orderStoreUnavailable("Paper 호가 재생 결과를 주문 원장에 기록하지 못했습니다.");
        }
        pending.push(progressed);
      } else {
        pending.push(accepted);
      }
    }
    return ExecuteRebalancePlanReceiptSchema.parse({
      planId: context.plan.id,
      mode: "PAPER",
      outcome: "PENDING",
      orderIds: pending.map(({ id }) => id),
      message:
        "Paper 주문을 주문 원장에 생성했습니다. 브로커 주문은 전송하지 않았으며 호가 증거로만 체결을 재생합니다.",
    });
  }

  private async replayPaperOrder(
    context: StoredExecutionContext,
    stored: StoredOrderReceipt,
    operational: ReturnType<typeof OperationalConfigSchema.parse>,
  ): Promise<{
    readonly reasonCode: string;
    readonly detail: Prisma.InputJsonValue;
    readonly transition: {
      readonly state: "PARTIAL_FILLED" | "FILLED";
      readonly filledQuantity: bigint;
      readonly filledGrossMinor: bigint;
      readonly feeMinor: bigint;
    } | null;
  }> {
    assertVercelEgressConfigured(this.config);
    const accountSeq = this.config.TOSSINVEST_ACCOUNT_SEQ;
    if (!accountSeq) throw new Error("PAPER_REPLAY_ACCOUNT_UNAVAILABLE");
    const planOrder = context.plan.orders.find(({ id }) => id === stored.planOrderId);
    const submitted = stored.timeline.at(-1);
    if (!planOrder || !submitted) throw new Error("PAPER_REPLAY_ORDER_CONTEXT_MISSING");
    const runtime = this.tossRuntime.get();
    await this.requireBoundBrokerAccount(
      runtime,
      accountSeq,
      context.account.id,
      context.account.externalRefHmac,
      "PAPER_REPLAY_ACCOUNT_BINDING",
      stored.id,
    );
    const instrument = {
      marketCountry: "KR" as const,
      symbol: planOrder.symbol as SymbolCode,
    };
    const reads = await runtime.requestAuditContext.run(
      { workflowType: "PAPER_ORDER_REPLAY", correlationId: stored.id },
      async () => {
        const [quotes, orderBook, commission] = await Promise.all([
          runtime.source.getPrices([instrument]),
          runtime.source.getOrderBook(instrument),
          runtime.source.getCommissionSchedule(
            { accountSeq, accountId: context.account.id as AccountId },
            ["KR"],
          ),
        ]);
        return { quotes, orderBook, commission };
      },
    );
    const quote = reads.quotes.value.find(
      (candidate) =>
        candidate.marketCountry === "KR" &&
        candidate.symbol === planOrder.symbol &&
        candidate.currency === "KRW",
    );
    const evaluatedAt = new Date();
    const result = simulatePaperLimitDayOrder({
      fixtureVersion: PAPER_EXECUTION_FIXTURE_VERSION,
      order: {
        logicalOrderId: stored.logicalOrderId,
        currentState: "PENDING",
        marketCountry: "KR",
        currency: "KRW",
        symbol: planOrder.symbol as SymbolCode,
        side: requireSide(planOrder.side),
        orderType: "LIMIT",
        timeInForce: "DAY",
        remainingQuantity: planOrder.quantity,
        limitPriceMinor: planOrder.limitPriceMinor,
        submittedAt: submitted.occurredAt.toISOString() as IsoDateTime,
        tradeDate: dateInSeoul(evaluatedAt),
      },
      evaluatedAt: evaluatedAt.toISOString() as IsoDateTime,
      freshnessPolicy: {
        maxEvidenceAgeMs: operational.freshness.quote.preSubmitMaxAgeSeconds * 1_000,
        futureToleranceMs: operational.freshness.quote.futureToleranceSeconds * 1_000,
      },
      partialFillPolicy: {
        enabled: true,
        bookParticipationBasisPoints: 1_000n,
      },
      quote: quote ? { value: quote, metadata: reads.quotes.metadata } : null,
      orderBook: reads.orderBook,
      commissionSchedule: reads.commission.value,
    });
    const detail = paperReplayDetail(result);
    const transitionState = result.normalizedTransition.to;
    if (
      result.normalizedTransition.applied &&
      transitionState !== "PARTIAL_FILLED" &&
      transitionState !== "FILLED"
    ) {
      throw new Error("PAPER_REPLAY_TRANSITION_INVALID");
    }
    return {
      reasonCode: result.reasonCode,
      detail,
      transition: result.normalizedTransition.applied
        ? {
            state: transitionState as "PARTIAL_FILLED" | "FILLED",
            filledQuantity: result.fill.quantity,
            filledGrossMinor: result.fill.grossNotionalMinor,
            feeMinor: result.fill.commissionMinor,
          }
        : null,
    };
  }

  private async executeLive(
    context: StoredExecutionContext,
    approvalIds: readonly string[],
  ): Promise<ExecuteRebalancePlanReceiptContract> {
    assertVercelEgressConfigured(this.config);
    const accountSeq = this.config.TOSSINVEST_ACCOUNT_SEQ;
    if (!accountSeq) {
      throw new OrderExecutionError(
        "BROKER_EXECUTION_UNAVAILABLE",
        "Live 주문에 사용할 토스증권 계좌 순번이 설정되지 않았습니다.",
        "UNAVAILABLE",
      );
    }
    const runtime = this.tossRuntime.get();
    const preSubmitEvidenceId = randomUUID();
    const accountBinding = await this.requireBoundBrokerAccount(
      runtime,
      accountSeq,
      context.account.id,
      context.account.externalRefHmac,
      "LIVE_PRE_SUBMIT_ACCOUNT_BINDING",
      preSubmitEvidenceId,
    );
    const prepared = prepareOrderIntents(context);
    const operational = parseOperationalConfig(context);
    if (
      context.plan.mode !== "LIVE" ||
      !context.operationalConfig ||
      context.promotion?.state !== "GRANTED" ||
      context.promotion.operationalConfigVersionId !== context.operationalConfig.id ||
      context.killSwitch !== "DISENGAGED"
    ) {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        "현재 ACTIVE LIVE 설정, 동일 설정의 Live 승격과 해제된 킬 스위치를 모두 확인하지 못했습니다.",
        "CONFLICT",
      );
    }
    const approvals = await this.repository.manualApprovals(approvalIds);
    const approvalByOrder = validateApprovalSet(context, approvalIds, approvals);
    const now = new Date();
    const firstApproval = approvalByOrder.get(prepared[0]!.order.id)!;
    const decision = evaluateExecutionRiskGate({
      operationalConfig: {
        status: "VALID",
        value: toExecutionConfig(operational, false),
      },
      requestedMode: "LIVE",
      now,
      accountExternalRefHmac: context.account.externalRefHmac,
      plan: {
        planId: context.plan.id,
        planHash: context.plan.planHash,
        mode: "LIVE",
        snapshotId: context.plan.snapshotId,
        snapshotDigest: context.plan.snapshotDigest,
        targetConfigVersionId: context.plan.targetConfigVersionId,
        targetConfigContentHash: context.plan.targetConfigContentHash,
        orders: prepared.map(({ planned }) => planned),
      },
      currentIdentity: requireCurrentIdentity(context),
      existingOrders: context.existingOrders,
      tradeDayFilledGrossMinor: context.tradeDayFilledGrossMinor,
      reservedPendingGrossMinor: context.reservedPendingGrossMinor,
      baselinePortfolioValueMinor: requiredPortfolioValue(context),
      projectedExposure: projectedExposure(context),
      manualApproval: {
        approvalId: firstApproval.id,
        approvalDigest: firstApproval.approvalHash,
        expectedApprovalDigest: firstApproval.approvalHash,
        approvedPlanHash: firstApproval.planHash,
        approvedAccountHmac: context.account.externalRefHmac,
        approvedAt: firstApproval.createdAt,
        consumedAt: firstApproval.consumedAt,
      },
    });
    if (!decision.canExecute) {
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        firstBlockedMessage(decision.checks),
        "CONFLICT",
      );
    }

    const approvalExpiry = Math.min(
      ...[...approvalByOrder.values()].map(({ expiresAt }) => expiresAt.getTime()),
    );
    const executionEvidenceExpiresAt = new Date(Math.min(now.getTime() + 30_000, approvalExpiry));
    if (executionEvidenceExpiresAt.getTime() <= now.getTime()) {
      throw new OrderExecutionError(
        "ORDER_APPROVAL_STALE",
        "Live 주문 승인이 실행 전에 만료되어 주문을 전송하지 않았습니다.",
        "CONFLICT",
      );
    }
    const executionRiskEvidenceId = randomUUID();
    await this.repository.appendExecutionRiskEvidence({
      id: executionRiskEvidenceId,
      planId: context.plan.id,
      planVersion: context.plan.planVersion,
      accountId: context.account.id,
      promotionEventId: context.promotion.id,
      operationalConfigVersionId: context.operationalConfig.id,
      operationalConfigCanonical: context.operationalConfig.canonicalContent,
      operationalConfigSha256: context.operationalConfig.contentHash,
      accountAllowlistHmac: context.account.externalRefHmac,
      checks: decision.checks.map((check) => ({
        code: check.code,
        outcome: check.outcome,
        message: check.message,
        subjectKey: check.subjectKey,
      })),
      evaluatedAt: now,
      expiresAt: executionEvidenceExpiresAt,
    });

    const selected = prepared[0]!;
    const approval = approvalByOrder.get(selected.order.id)!;
    const reads = await runtime.requestAuditContext.run(
      {
        workflowType: "LIVE_PRE_SUBMIT",
        correlationId: preSubmitEvidenceId,
      },
      async () => {
        const instrument = {
          marketCountry: "KR" as const,
          symbol: selected.order.symbol as SymbolCode,
        };
        const account = {
          accountSeq,
          accountId: context.account.id as AccountId,
        };
        const currentQuotes = await runtime.source.getPrices([instrument]);
        const currentQuote = currentQuotes.value.find(
          (quote) =>
            quote.marketCountry === "KR" &&
            quote.symbol === selected.order.symbol &&
            quote.currency === "KRW",
        );
        if (!currentQuote || currentQuotes.value.length !== 1) {
          throw new OrderExecutionError(
            "ORDER_PRETRADE_BLOCKED",
            "주문 직전 현재가가 정확히 한 종목과 일치하지 않아 Live 주문을 차단했습니다.",
            "CONFLICT",
          );
        }
        const priceLimit = await runtime.source.getPriceLimit(instrument);
        const calendar = await runtime.source.getMarketCalendar("KR");
        const buyingPower =
          selected.order.side === "BUY"
            ? await runtime.source.getBuyingPowerEvidence(account, "KRW")
            : null;
        const sellableQuantity =
          selected.order.side === "SELL"
            ? await runtime.source.getSellableQuantity(account, instrument)
            : null;
        const stocks = await runtime.source.getStocksEvidence([selected.order.symbol]);
        const warnings = await runtime.source.getStockWarningsEvidence(selected.order.symbol);
        const openOrders = await runtime.source.listOpenOrdersEvidence(account);
        const observedAt = new Date();
        const stock = selectExactStock(stocks.value.result, {
          requestedMarketCountry: "KR",
          symbol: selected.order.symbol,
        });
        const normalized = normalizeTossInstrumentValidation({
          request: { requestedMarketCountry: "KR", symbol: selected.order.symbol },
          stock,
          warnings: warnings.value.result,
          observedAt,
        });
        const instrumentValidation =
          await this.portfolioRepository.recordInstrumentValidation(normalized);
        return {
          currentQuotes,
          currentQuote,
          priceLimit,
          calendar,
          buyingPower,
          sellableQuantity,
          stocks,
          warnings,
          openOrders,
          instrumentValidation,
        };
      },
    );
    const evidenceNow = new Date();
    const plannedQuote = plannedQuoteResult(selected.order);
    const instrumentTradeEvidence = {
      value: {
        validationId: reads.instrumentValidation.id,
        marketCountry: "KR" as const,
        symbol: selected.order.symbol as SymbolCode,
        tradeBlockedNow: reads.instrumentValidation.tradeBlockedNow,
        requiresOrderRevalidation: reads.instrumentValidation.requiresOrderRevalidation,
        observedAt: reads.instrumentValidation.observedAt.toISOString() as IsoDateTime,
      },
      metadata: reads.warnings.metadata,
    };
    const feeBufferMinor = BigInt(operational.limits.feeBufferMinor);
    const preSubmitDecision = evaluatePreSubmitOrderEvidence({
      accountId: context.account.id as AccountId,
      order: {
        marketCountry: "KR",
        currency: "KRW",
        symbol: selected.order.symbol as SymbolCode,
        side: requireSide(selected.order.side),
        quantity: selected.order.quantity,
        limitPriceMinor: selected.order.limitPriceMinor,
      },
      plannedQuote,
      currentQuote: { value: reads.currentQuote, metadata: reads.currentQuotes.metadata },
      priceLimit: reads.priceLimit,
      calendar: reads.calendar,
      instrumentTradeEvidence,
      brokerOpenOrders: reads.openOrders,
      buyingPower: reads.buyingPower,
      sellableQuantity: reads.sellableQuantity,
      requiredBuyingPowerMinor:
        selected.order.side === "BUY" ? selected.order.notionalMinor + feeBufferMinor : null,
      now: evidenceNow,
      quoteMaxAgeMs: operational.freshness.quote.preSubmitMaxAgeSeconds * 1_000,
      calendarMaxAgeMs: operational.freshness.calendar.maxAgeSeconds * 1_000,
      pretradeMaxAgeMs: operational.freshness.quote.preSubmitMaxAgeSeconds * 1_000,
      futureToleranceMs:
        Math.min(
          operational.freshness.quote.futureToleranceSeconds,
          operational.freshness.calendar.futureToleranceSeconds,
        ) * 1_000,
      maxAbsolutePriceChangeBasisPoints: BigInt(
        operational.limits.maxAbsolutePriceChangeBasisPoints,
      ),
    });
    if (
      !preSubmitDecision.canSubmit ||
      preSubmitDecision.validUntil === null ||
      preSubmitDecision.reservation.reservedGrossMinor === null
    ) {
      throw new OrderExecutionError(
        "ORDER_PRETRADE_BLOCKED",
        firstBlockedMessage(preSubmitDecision.checks),
        "CONFLICT",
      );
    }
    const currentQuoteMinor = positiveWholeMinor(reads.currentQuote.price, "현재가");
    const lowerPriceLimitMinor = positiveWholeMinor(
      reads.priceLimit.value.lowerLimitPrice,
      "당일 하한가",
    );
    const upperPriceLimitMinor = positiveWholeMinor(
      reads.priceLimit.value.upperLimitPrice,
      "당일 상한가",
    );
    const reservationBasisPriceMinor =
      selected.order.side === "SELL" ? upperPriceLimitMinor : selected.order.limitPriceMinor;
    const orderId = randomUUID();
    const liveLedger = await this.repository.createLivePreSubmitEvidenceAndLedger({
      grossLimitMinor: BigInt(operational.live.maxDailyGrossMinor),
      preSubmitEvidence: {
        id: preSubmitEvidenceId,
        executionRiskEvidenceId,
        planOrderId: selected.order.id,
        accountId: context.account.id,
        accountResponseValidationId: accountBinding.responseValidationId,
        plannedPriceSnapshotId: selected.order.plannedPriceSnapshotId,
        quoteResponseValidationId: requiredValidationId(
          reads.currentQuotes.responseValidationId,
          "현재가",
        ),
        priceLimitResponseValidationId: requiredValidationId(
          reads.priceLimit.responseValidationId,
          "가격 제한",
        ),
        calendarResponseValidationId: requiredValidationId(
          reads.calendar.responseValidationId,
          "시장 캘린더",
        ),
        capacityResponseValidationId: requiredValidationId(
          reads.buyingPower?.responseValidationId ??
            reads.sellableQuantity?.responseValidationId ??
            null,
          selected.order.side === "BUY" ? "매수 가능 금액" : "매도 가능 수량",
        ),
        instrumentResponseValidationId: requiredValidationId(
          reads.stocks.responseValidationId,
          "종목 기본 정보",
        ),
        warningsResponseValidationId: requiredValidationId(
          reads.warnings.responseValidationId,
          "종목 유의사항",
        ),
        openOrdersResponseValidationId: requiredValidationId(
          reads.openOrders.responseValidationId,
          "미체결 주문",
        ),
        plannedQuotePriceMinor: selected.order.plannedQuotePriceMinor,
        currentQuotePriceMinor: currentQuoteMinor,
        lowerPriceLimitMinor,
        upperPriceLimitMinor,
        reservationBasisPriceMinor,
        reservedGrossMinor: preSubmitDecision.reservation.reservedGrossMinor,
        checks: preSubmitDecision.checks.map((check) => ({
          code: check.code,
          outcome: check.outcome,
          message: check.message,
        })),
        evaluatedAt: preSubmitDecision.evaluatedAt,
        expiresAt: preSubmitDecision.validUntil,
      },
      order: {
        id: orderId,
        planId: context.plan.id,
        planOrderId: selected.order.id,
        accountId: context.account.id,
        logicalOrderId: selected.logicalOrderId,
        clientOrderId: createTossClientOrderId(selected.intent),
        clientOrderIdVersion: CLIENT_ORDER_ID_VERSION,
        canonicalIntent: createCanonicalOrderIntent(selected.intent),
        intentSha256: createCanonicalOrderIntentDigest(selected.intent),
        planVersion: context.plan.planVersion,
        phase: selected.order.phase,
        marketCountry: "KR",
        currency: "KRW",
        symbol: selected.order.symbol,
        side: requireSide(selected.order.side),
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: selected.order.quantity,
        limitPriceMinor: selected.order.limitPriceMinor,
        plannedGrossNotionalMinor: selected.order.notionalMinor,
        reservedGrossMinor: preSubmitDecision.reservation.reservedGrossMinor,
        reservationBasisPriceMinor,
        reservationPolicyVersion: ORDER_RESERVATION_POLICY_VERSION,
      },
    });
    if (!liveLedger) {
      throw new OrderExecutionError(
        "ORDER_PRETRADE_BLOCKED",
        "Live 예약과 주문 원장을 원자적으로 만들지 못해 브로커 전송을 차단했습니다.",
        "CONFLICT",
      );
    }

    const submissionAuthorizationId = randomUUID();
    const request = liveOrderRequest(context, selected, accountSeq);
    const binding = {
      action: "SUBMIT" as const,
      planId: request.planId,
      planOrderId: request.planOrderId,
      logicalOrderId: request.logicalOrderId,
      accountId: request.accountId,
      brokerAccountReference: request.brokerAccountReference,
      clientOrderId: request.clientOrderId,
      brokerOrderId: null,
      economicTerms: {
        marketCountry: request.marketCountry,
        currency: request.currency,
        symbol: request.symbol,
        side: request.side,
        orderType: request.orderType,
        timeInForce: request.timeInForce,
        quantity: request.quantity.toString(),
        limitPriceMinor: request.limitPriceMinor.toString(),
      },
    };
    const submitDecision = composeLiveSubmitRiskDecision({
      binding,
      executionDecision: decision,
      executionEvaluatedAt: now,
      executionEvidenceValidUntil: executionEvidenceExpiresAt,
      preSubmitDecision,
      evidence: {
        executionRiskEvidenceId,
        preSubmitEvidenceId,
        reservationId: liveLedger.reservationId,
        approvalId: approval.id,
        submissionAuthorizationId,
      },
      now: new Date(),
    });
    if (!submitDecision.canExecute) {
      throw new OrderExecutionError("ORDER_DISPATCH_BLOCKED", submitDecision.message, "CONFLICT");
    }
    const authorizationExpiresAt = new Date(
      Math.min(Date.now() + 30_000, Date.parse(submitDecision.validUntil)),
    );
    const preparation = createOrderSubmissionAuthorizationCanonical({
      submissionAuthorizationId,
      planId: context.plan.id,
      planVersion: context.plan.planVersion,
      planOrderId: selected.order.id,
      logicalOrderId: selected.logicalOrderId,
      accountId: context.account.id,
      clientOrderId: request.clientOrderId,
      canonicalIntentSha256: createCanonicalOrderIntentDigest(selected.intent),
      authorizedRequestDigest: submitDecision.canonicalRequestDigest,
      brokerAccountReferenceHmac: context.account.externalRefHmac,
      executionRiskEvidenceId,
      preSubmitEvidenceId,
      reservationId: liveLedger.reservationId,
      approvalId: approval.id,
      expiresAt: authorizationExpiresAt,
    });
    const storedAuthorization = await this.repository.prepareLiveSubmission({
      id: submissionAuthorizationId,
      orderId,
      logicalOrderId: selected.logicalOrderId,
      planId: context.plan.id,
      planVersion: context.plan.planVersion,
      planOrderId: selected.order.id,
      canonicalPreparation: preparation.canonicalPreparation,
      canonicalPreparationDigest: preparation.canonicalPreparationDigest,
      authorizedRequestDigest: submitDecision.canonicalRequestDigest,
      clientOrderId: request.clientOrderId,
      brokerAccountReferenceHmac: context.account.externalRefHmac,
      executionRiskEvidenceId,
      preSubmitEvidenceId,
      reservationId: liveLedger.reservationId,
      approvalId: approval.id,
      expiresAt: authorizationExpiresAt,
    });
    const authorizationId = randomUUID();
    const dispatchClaimId = randomUUID();
    const issuedAt = new Date(Math.max(Date.now(), storedAuthorization.preparedAt.getTime()));
    const expiresAt = new Date(
      Math.min(authorizationExpiresAt.getTime(), issuedAt.getTime() + 30_000),
    );
    let persistedDispatchClaimId: string | null = null;
    const authorization = issueLiveOrderSubmitAuthorization({
      authorizationId,
      planId: context.plan.id,
      planOrderId: selected.order.id,
      logicalOrderId: selected.logicalOrderId,
      accountId: context.account.id as AccountId,
      brokerAccountReference: String(accountSeq),
      clientOrderId: request.clientOrderId,
      riskDecision: submitDecision,
      issuedAt,
      expiresAt,
      ledgerState: "SUBMITTING",
      economicTerms: binding.economicTerms,
      audit: async (intent) => {
        if (
          intent.action !== "SUBMIT" ||
          intent.authorizationId !== authorizationId ||
          intent.canonicalRequestDigest !== submitDecision.canonicalRequestDigest
        ) {
          throw new Error("Live submit audit intent가 봉인된 권한과 일치하지 않습니다.");
        }
        const claim = createOrderDispatchClaimCanonical({
          dispatchClaimId,
          submissionAuthorizationId,
          authorizationId,
          planId: context.plan.id,
          planVersion: context.plan.planVersion,
          planOrderId: selected.order.id,
          logicalOrderId: selected.logicalOrderId,
          accountId: context.account.id,
          clientOrderId: request.clientOrderId,
          canonicalIntentSha256: createCanonicalOrderIntentDigest(selected.intent),
          authorizedRequestDigest: submitDecision.canonicalRequestDigest,
          brokerAccountReferenceHmac: context.account.externalRefHmac,
          executionRiskEvidenceId,
          preSubmitEvidenceId,
          reservationId: liveLedger.reservationId,
          approvalId: approval.id,
          authorizationIssuedAt: issuedAt,
          authorizationExpiresAt: expiresAt,
        });
        await this.repository.claimLiveDispatch({
          id: dispatchClaimId,
          submissionAuthorizationId,
          orderId,
          logicalOrderId: selected.logicalOrderId,
          authorizationId,
          planId: context.plan.id,
          planVersion: context.plan.planVersion,
          planOrderId: selected.order.id,
          canonicalRequest: claim.canonicalRequest,
          claimEnvelopeDigest: claim.claimEnvelopeDigest,
          authorizedRequestDigest: submitDecision.canonicalRequestDigest,
          clientOrderId: request.clientOrderId,
          brokerAccountReferenceHmac: context.account.externalRefHmac,
          authorizationIssuedAt: issuedAt,
          authorizationExpiresAt: expiresAt,
          intentAuditedAt: new Date(),
          dispatchStartedAt: new Date(),
        });
        persistedDispatchClaimId = dispatchClaimId;
        return dispatchClaimId;
      },
    });
    const result = await runtime.requestAuditContext.run(
      { workflowType: "LIVE_ORDER_SUBMIT", correlationId: orderId },
      () => runtime.liveOrders.submitOrder(authorization, request),
    );
    if (persistedDispatchClaimId === null) {
      throw new OrderExecutionError(
        "ORDER_DISPATCH_BLOCKED",
        "브로커 요청 전 dispatch claim을 저장하지 못해 SUBMITTING 주문을 자동 재전송하지 않습니다.",
        "UNAVAILABLE",
      );
    }
    let stored = await this.repository.recordSubmitOutcome({
      evidenceId: randomUUID(),
      orderId,
      dispatchClaimId: persistedDispatchClaimId,
      brokerOrderId: result.brokerOrderId,
      brokerStatusRaw: result.outcome,
      validatedState: result.normalizedState,
      requestId: result.metadata.requestId,
      httpStatus: result.metadata.httpStatus,
      safeErrorCode: result.outcome === "ACKNOWLEDGED" ? null : result.reasonCode,
      redactedBody: redactOrderPayload(result.rawPayload, this.config),
      observedAt: new Date(result.metadata.receivedAt),
    });
    if (!stored) {
      throw orderStoreUnavailable(
        "브로커 결과를 주문 원장에 원자적으로 기록하지 못했습니다. 같은 주문을 재전송하지 마세요.",
      );
    }
    if (result.brokerOrderId) {
      const liveContext = await this.repository.liveOrderContext(orderId);
      if (liveContext) {
        stored = await this.reconcileLiveOrder(liveContext, null, "RECONCILER");
      }
    }
    return ExecuteRebalancePlanReceiptSchema.parse({
      planId: context.plan.id,
      mode: "LIVE",
      outcome:
        stored.timeline.at(-1)?.state === "PENDING"
          ? "PENDING"
          : stored.timeline.at(-1)?.state === "REJECTED"
            ? "BLOCKED"
            : "BLOCKED",
      orderIds: [stored.id],
      message:
        stored.timeline.at(-1)?.state === "PENDING"
          ? "Live 주문 1건을 일회성 dispatch claim과 함께 전송했습니다. 체결 확인 전 다음 주문은 차단됩니다."
          : "Live 주문 결과가 거부 또는 불명확 상태여서 추가 주문을 차단했습니다.",
    });
  }

  private isObservationInDispatchWindow(
    context: StoredLiveOrderContext,
    orderedAt: string,
  ): boolean {
    if (!context.dispatchStartedAt) return false;
    const observed = Date.parse(orderedAt);
    if (!Number.isFinite(observed)) return false;
    const dispatch = context.dispatchStartedAt.getTime();
    return observed >= dispatch - 60_000 && observed <= dispatch + 300_000;
  }

  private async reconcileLiveOrder(
    context: StoredLiveOrderContext,
    brokerActionId: string | null,
    actor: "RECONCILER" | "OPERATOR",
    expected?: {
      readonly state: "PENDING" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED";
      readonly brokerOrderId: string;
      readonly limitPriceMinor: bigint;
      readonly filledQuantity: bigint;
      readonly filledGrossMinor: bigint;
      readonly feeMinor: bigint;
      readonly evidenceReference: string;
    },
  ): Promise<StoredOrderReceipt> {
    const lookupBrokerOrderId = context.brokerOrderId ?? expected?.brokerOrderId ?? null;
    if (!lookupBrokerOrderId || !this.config.TOSSINVEST_ACCOUNT_SEQ) {
      return this.requiredStoredOrder(context);
    }
    const runtime = this.tossRuntime.get();
    await this.requireBoundBrokerAccount(
      runtime,
      this.config.TOSSINVEST_ACCOUNT_SEQ,
      context.accountId,
      context.accountExternalRefHmac,
      "LIVE_RECONCILE_ACCOUNT_BINDING",
      context.orderId,
    );
    const result = await runtime.requestAuditContext.run(
      { workflowType: "LIVE_ORDER_RECONCILE", correlationId: randomUUID() },
      () =>
        runtime.liveOrders.getOrder({
          accountId: context.accountId as AccountId,
          brokerAccountReference: String(this.config.TOSSINVEST_ACCOUNT_SEQ),
          brokerOrderId: lookupBrokerOrderId,
        }),
    );
    if (
      result.outcome !== "OBSERVED" ||
      result.value.primaryState === null ||
      !result.value.mayOverwritePrimary
    ) {
      if (expected) {
        throw new OrderExecutionError(
          "ORDER_RECOVERY_BLOCKED",
          "브로커에서 원 주문의 확정 상태를 다시 조회하지 못해 UNKNOWN_BLOCKED 복구를 중단했습니다.",
          "CONFLICT",
        );
      }
      return this.requiredStoredOrder(context);
    }
    const observation = result.value;
    const primaryState = observation.primaryState;
    if (primaryState === null) return this.requiredStoredOrder(context);
    if (
      observation.brokerOrderId !== lookupBrokerOrderId ||
      (context.brokerOrderId !== null && observation.brokerOrderId !== context.brokerOrderId) ||
      observation.marketCountry !== "KR" ||
      observation.currency !== "KRW" ||
      observation.symbol !== context.symbol ||
      observation.side !== context.side ||
      observation.orderType !== context.orderType ||
      observation.timeInForce !== context.timeInForce ||
      observation.quantity !== context.quantity ||
      observation.limitPriceMinor !== context.limitPriceMinor
    ) {
      throw new OrderExecutionError(
        "ORDER_RECOVERY_BLOCKED",
        "브로커 주문 조회 결과가 원 주문의 종목·방향·수량·지정가와 일치하지 않아 상태 갱신을 차단했습니다.",
        "CONFLICT",
      );
    }
    const filledGrossMinor =
      observation.filledGrossNotionalMinor ?? (observation.filledQuantity === 0n ? 0n : null);
    if (filledGrossMinor === null) {
      throw new OrderExecutionError(
        "ORDER_RECOVERY_BLOCKED",
        "체결 수량이 있지만 누적 체결금액을 확인하지 못해 상태 갱신을 차단했습니다.",
        "CONFLICT",
      );
    }
    const observedFeeMinor = (observation.feeMinor ?? 0n) + (observation.taxMinor ?? 0n);
    if (!this.isObservationInDispatchWindow(context, observation.orderedAt)) {
      throw new OrderExecutionError(
        "ORDER_RECOVERY_BLOCKED",
        "브로커 주문 시각이 봉인된 dispatch 시각과 안전한 복구 범위 안에 있지 않아 상태 갱신을 차단했습니다.",
        "CONFLICT",
      );
    }
    if (
      expected &&
      (primaryState !== expected.state ||
        observation.brokerOrderId !== expected.brokerOrderId ||
        observation.limitPriceMinor !== expected.limitPriceMinor ||
        observation.filledQuantity !== expected.filledQuantity ||
        filledGrossMinor !== expected.filledGrossMinor ||
        observedFeeMinor !== expected.feeMinor)
    ) {
      throw new OrderExecutionError(
        "ORDER_RECOVERY_BLOCKED",
        "운영자가 입력한 복구 상태·누적 체결값이 방금 조회한 브로커 증거와 일치하지 않습니다.",
        "CONFLICT",
      );
    }
    const stored = await this.repository.recordReconciliation({
      evidenceId: randomUUID(),
      orderId: context.orderId,
      brokerOrderId: observation.brokerOrderId,
      brokerStatusRaw: observation.brokerStatusRaw,
      validatedState: primaryState,
      requestId: result.metadata.requestId,
      httpStatus: result.metadata.httpStatus ?? 200,
      redactedBody: redactOrderPayload(result.rawPayload, this.config),
      observedAt: new Date(result.metadata.receivedAt),
      filledQuantity: observation.filledQuantity,
      filledGrossMinor,
      feeMinor: observedFeeMinor,
      actor,
      ...(brokerActionId ? { brokerActionId } : {}),
      detail: {
        reason: result.reasonCode,
        cancelLifecycle: observation.cancelLifecycle,
        auxiliaryStatus: observation.auxiliaryStatus,
        operatorEvidenceReference: expected?.evidenceReference ?? null,
      },
    });
    if (!stored) {
      throw orderStoreUnavailable("브로커 조회 결과를 주문 원장에 원자적으로 반영하지 못했습니다.");
    }
    return stored;
  }

  private async requireBoundBrokerAccount(
    runtime: TossRuntime,
    accountSeq: number,
    accountId: string,
    expectedAccountHmac: string,
    workflowType: string,
    correlationId: string,
  ): Promise<{ readonly responseValidationId: string }> {
    const accounts = await runtime.requestAuditContext.run({ workflowType, correlationId }, () =>
      runtime.source.listAccountsEvidence(),
    );
    const matches = accounts.value.filter((account) => account.accountSeq === accountSeq);
    if (matches.length !== 1 || !accounts.responseValidationId) {
      throw new OrderExecutionError(
        "BROKER_EXECUTION_UNAVAILABLE",
        "주문에 사용할 토스 계좌 순번을 검증된 계좌 목록에서 정확히 하나로 확인하지 못했습니다.",
        "UNAVAILABLE",
      );
    }
    const accountHmac = createAccountReference(matches[0]!.accountNo, runtime.accountReferenceKey);
    if (accountHmac !== expectedAccountHmac) {
      this.logger.error({
        event: "broker_account_binding_mismatch",
        accountId,
        accountSeq,
      });
      throw new OrderExecutionError(
        "ORDER_EXECUTION_BLOCKED",
        "환경변수의 토스 계좌 순번이 현재 계획과 운영 설정에 봉인된 계좌와 일치하지 않아 모든 브로커 작업을 차단했습니다.",
        "CONFLICT",
      );
    }
    return { responseValidationId: accounts.responseValidationId };
  }

  private async requiredStoredOrder(context: StoredLiveOrderContext): Promise<StoredOrderReceipt> {
    const orders = await this.repository.ordersSnapshot({ planId: context.planId });
    const order = orders.find(({ id }) => id === context.orderId);
    if (!order) {
      throw orderStoreUnavailable("현재 주문 상태를 다시 읽지 못했습니다.");
    }
    return order;
  }

  private async requiredExecutionContext(planId: string): Promise<StoredExecutionContext> {
    try {
      const context = await this.repository.loadExecutionContext(planId);
      if (!context) {
        throw new OrderExecutionError(
          "ORDER_PLAN_NOT_FOUND",
          "실행할 저장 계획을 찾지 못했습니다.",
          "CONFLICT",
        );
      }
      if (context.plan.status !== "PLANNED" || context.plan.orders.length === 0) {
        throw new OrderExecutionError(
          "ORDER_PLAN_NOT_EXECUTABLE",
          "저장 계획이 PLANNED 상태가 아니거나 실행 주문이 없습니다.",
          "CONFLICT",
        );
      }
      return context;
    } catch (error) {
      if (error instanceof OrderExecutionError) throw error;
      throw orderStoreUnavailable("주문 실행 계획과 현재 상태를 안전하게 읽지 못했습니다.", error);
    }
  }
}

function prepareOrderIntents(context: StoredExecutionContext) {
  return context.plan.orders
    .slice()
    .sort(
      (left, right) =>
        phaseRank(left.phase) - phaseRank(right.phase) ||
        left.ordinal - right.ordinal ||
        left.id.localeCompare(right.id),
    )
    .map((order) => {
      if (
        order.marketCountry !== "KR" ||
        order.currency !== "KRW" ||
        order.orderType !== "LIMIT" ||
        order.timeInForce !== "DAY" ||
        (order.side !== "BUY" && order.side !== "SELL") ||
        order.quantity <= 0n ||
        order.limitPriceMinor <= 0n ||
        order.notionalMinor !== order.quantity * order.limitPriceMinor
      ) {
        throw new OrderExecutionError(
          "ORDER_PLAN_NOT_EXECUTABLE",
          `${order.instrumentKey} 주문이 지원하는 KRW 지정가 DAY 형태가 아닙니다.`,
          "CONFLICT",
        );
      }
      const logicalOrderId = randomUUID();
      const intent: CanonicalOrderIntent = {
        logicalOrderId,
        rebalanceRunId: context.plan.runId,
        planId: context.plan.id,
        planVersion: context.plan.planVersion,
        planHash: context.plan.planHash,
        phase: order.phase,
        marketCountry: "KR",
        symbol: order.symbol,
        side: order.side,
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: order.quantity.toString(),
        price: order.limitPriceMinor.toString(),
      };
      return {
        order,
        logicalOrderId,
        intent,
        planned: {
          logicalOrderId,
          grossNotionalMinor: order.notionalMinor,
          marketCountry: "KR",
          orderType: "LIMIT",
          timeInForce: "DAY",
        } satisfies PlannedExecutionOrder,
      };
    });
}

function validateApprovalSet(
  context: StoredExecutionContext,
  requestedIds: readonly string[],
  approvals: readonly StoredManualApproval[],
): ReadonlyMap<string, StoredManualApproval> {
  const expectedOrderIds = new Set(context.plan.orders.map(({ id }) => id));
  const requestedSet = new Set(requestedIds);
  const now = Date.now();
  if (
    requestedSet.size !== requestedIds.length ||
    requestedIds.length !== expectedOrderIds.size ||
    approvals.length !== expectedOrderIds.size
  ) {
    throw new OrderExecutionError(
      "ORDER_APPROVAL_INVALID",
      "Live 계획의 모든 주문에 정확히 하나씩 승인 ID를 제출해야 합니다.",
      "CONFLICT",
    );
  }
  const byOrder = new Map<string, StoredManualApproval>();
  for (const approval of approvals) {
    if (
      !requestedSet.has(approval.id) ||
      !expectedOrderIds.has(approval.planOrderId) ||
      approval.accountId !== context.account.id ||
      approval.planHash !== context.plan.planHash ||
      approval.consumedAt !== null ||
      approval.createdAt.getTime() > now ||
      approval.expiresAt.getTime() <= now ||
      byOrder.has(approval.planOrderId)
    ) {
      throw new OrderExecutionError(
        "ORDER_APPROVAL_INVALID",
        "승인이 계획·계좌·주문과 일치하지 않거나 만료·소비되어 Live 실행을 차단했습니다.",
        "CONFLICT",
      );
    }
    byOrder.set(approval.planOrderId, approval);
  }
  return byOrder;
}

function plannedQuoteResult(
  order: StoredExecutionContext["plan"]["orders"][number],
): BrokerReadResult<PriceQuote> {
  return {
    value: {
      marketCountry: "KR",
      symbol: order.symbol as SymbolCode,
      currency: "KRW",
      price: order.plannedQuotePriceMinor.toString() as PriceQuote["price"],
      observedAt: order.plannedQuoteObservedAt
        ? (order.plannedQuoteObservedAt.toISOString() as IsoDateTime)
        : null,
    },
    metadata: {
      brokerId: "toss" as BrokerReadResult<PriceQuote>["metadata"]["brokerId"],
      operationId: "getPrices",
      requestId: null,
      httpStatus: 200,
      rateLimitGroup: null,
      receivedAt: order.plannedQuoteReceivedAt.toISOString() as IsoDateTime,
      auditReference: order.plannedQuoteAuditReference,
    },
  };
}

function liveOrderRequest(
  context: StoredExecutionContext,
  selected: ReturnType<typeof prepareOrderIntents>[number],
  accountSeq: number,
): KrwLimitDayOrderRequest {
  return {
    planId: context.plan.id,
    planOrderId: selected.order.id,
    logicalOrderId: selected.logicalOrderId,
    accountId: context.account.id as AccountId,
    brokerAccountReference: String(accountSeq),
    clientOrderId: createTossClientOrderId(selected.intent),
    marketCountry: "KR",
    currency: "KRW",
    symbol: selected.order.symbol as SymbolCode,
    side: requireSide(selected.order.side),
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: selected.order.quantity,
    limitPriceMinor: selected.order.limitPriceMinor,
  };
}

function positiveWholeMinor(value: string | null, label: string): bigint {
  if (value === null || !/^[1-9]\d*$/.test(value)) {
    throw new OrderExecutionError(
      "ORDER_PRETRADE_BLOCKED",
      `${label}를 원화 정수 단위로 안전하게 해석하지 못했습니다.`,
      "CONFLICT",
    );
  }
  return BigInt(value);
}

function requiredValidationId(value: string | null, label: string): string {
  if (!value) {
    throw new OrderExecutionError(
      "ORDER_PRETRADE_BLOCKED",
      `${label} 응답 검증 ID가 없어 Live 주문을 차단했습니다.`,
      "CONFLICT",
    );
  }
  return value;
}

function redactOrderPayload(value: unknown, config: EngineConfig): Prisma.InputJsonValue {
  const redacted = toPrismaJson(
    redactTossResponseBody(
      value,
      [
        config.TOSSINVEST_CLIENT_ID,
        config.TOSSINVEST_CLIENT_SECRET,
        config.ACCOUNT_REFERENCE_KEY,
      ].filter((candidate): candidate is string => Boolean(candidate)),
    ),
  );
  if (redacted === null || typeof redacted !== "object") {
    return { unavailable: true };
  }
  return redacted;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => toPrismaJson(item));
  }
  if (typeof value === "object") {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = toPrismaJson(child);
    }
    return output;
  }
  return "[UNSUPPORTED]";
}

function paperReplayDetail(
  result: ReturnType<typeof simulatePaperLimitDayOrder>,
): Prisma.InputJsonValue {
  return {
    reason: result.reasonCode,
    policyVersion: result.policyVersion,
    decision: result.decision,
    transition: {
      from: result.normalizedTransition.from,
      to: result.normalizedTransition.to,
      applied: result.normalizedTransition.applied,
    },
    fill: {
      quantity: result.fill.quantity.toString(),
      remainingQuantity: result.fill.remainingQuantity.toString(),
      grossNotionalMinor: result.fill.grossNotionalMinor.toString(),
      commissionMinor: result.fill.commissionMinor.toString(),
      netCashDeltaMinor: result.fill.netCashDeltaMinor.toString(),
      executions: result.fill.executions.map((execution) => ({
        priceMinor: execution.priceMinor.toString(),
        quantity: execution.quantity.toString(),
        notionalMinor: execution.notionalMinor.toString(),
      })),
    },
    evidence: {
      quoteObservedAt: result.evidence.quoteObservedAt,
      orderBookObservedAt: result.evidence.orderBookObservedAt,
      quotePriceMinor: result.evidence.quotePriceMinor?.toString() ?? null,
      bestRelevantBookPriceMinor: result.evidence.bestRelevantBookPriceMinor?.toString() ?? null,
      qualifyingBookQuantity: result.evidence.qualifyingBookQuantity.toString(),
      simulatedAvailableQuantity: result.evidence.simulatedAvailableQuantity.toString(),
      quoteAuditReference: result.evidence.quoteAuditReference,
      orderBookAuditReference: result.evidence.orderBookAuditReference,
      limitations: [...result.evidence.limitations],
    },
    rawState: result.rawState,
  };
}

function dateInSeoul(value: Date): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("PAPER_REPLAY_TRADE_DATE_INVALID");
  return `${year}-${month}-${day}` as IsoDate;
}

function phaseRank(value: "SELL" | "BUY"): number {
  return value === "SELL" ? 0 : 1;
}

function parseOperationalConfig(context: StoredExecutionContext) {
  const result = OperationalConfigSchema.safeParse(context.operationalConfig?.payload);
  if (!result.success || !context.operationalConfig) {
    throw new OrderExecutionError(
      "ORDER_EXECUTION_BLOCKED",
      "활성 운영 설정을 계약대로 확인하지 못해 주문 실행을 차단했습니다.",
      "CONFLICT",
    );
  }
  return result.data;
}

function toExecutionConfig(
  config: ReturnType<typeof OperationalConfigSchema.parse>,
  effectiveKillSwitch: boolean,
): ExecutionOperationalConfig {
  return {
    mode: config.mode,
    killSwitch: effectiveKillSwitch,
    limits: {
      minimumOrderGrossMinor: config.limits.minimumOrderGrossMinor,
      maxSingleOrderGrossMinor: config.limits.maxSingleOrderGrossMinor,
      maxDailyGrossMinor: config.limits.maxDailyGrossMinor,
      maxDailyTurnoverBasisPoints: config.limits.maxDailyTurnoverBasisPoints,
      maxInstrumentWeightBasisPoints: config.limits.maxInstrumentWeightBasisPoints,
      maxAssetClassWeightBasisPoints: config.limits.maxAssetClassWeightBasisPoints,
      maxRiskyWeightBasisPoints: config.limits.maxRiskyWeightBasisPoints,
    },
    live: {
      enabled: config.live.enabled,
      accountAllowlistHmacs: config.live.accountAllowlistHmacs,
      approvalTtlSeconds: config.live.approvalTtlSeconds,
      maxSingleOrderGrossMinor: config.live.maxSingleOrderGrossMinor,
      maxDailyGrossMinor: config.live.maxDailyGrossMinor,
      tinyLiveMaxGrossMinor: config.live.tinyLiveMaxGrossMinor,
    },
  };
}

function requireCurrentIdentity(context: StoredExecutionContext) {
  const identity = context.currentIdentity;
  if (
    !identity.snapshotId ||
    !identity.snapshotDigest ||
    !identity.targetConfigVersionId ||
    !identity.targetConfigContentHash
  ) {
    throw new OrderExecutionError(
      "ORDER_PLAN_STALE",
      "최신 계좌 스냅샷과 활성 목표 설정을 확인하지 못해 계획 실행을 차단했습니다.",
      "CONFLICT",
    );
  }
  return {
    snapshotId: identity.snapshotId,
    snapshotDigest: identity.snapshotDigest,
    targetConfigVersionId: identity.targetConfigVersionId,
    targetConfigContentHash: identity.targetConfigContentHash,
  };
}

function requiredPortfolioValue(context: StoredExecutionContext): bigint {
  if (context.plan.totalValueMinor === null || context.plan.totalValueMinor <= 0n) {
    throw new OrderExecutionError(
      "ORDER_EXECUTION_BLOCKED",
      "계획의 기준 포트폴리오 평가액을 확인하지 못해 주문 실행을 차단했습니다.",
      "CONFLICT",
    );
  }
  return context.plan.totalValueMinor;
}

function projectedExposure(context: StoredExecutionContext) {
  const projected = requireRecordArray(context.plan.projectedAllocations, "예상 자산군 비중");
  const decisions = requireRecordArray(context.plan.assetDecisions, "자산군 결정");
  const assetClasses = projected.map((allocation) => ({
    key: requiredString(allocation.id, "자산군 ID"),
    valueMinor: requiredBigIntString(allocation.valueMinor, "자산군 예상 평가액"),
  }));
  const orderDelta = new Map<string, bigint>();
  for (const order of context.plan.orders) {
    orderDelta.set(
      order.instrumentKey,
      (orderDelta.get(order.instrumentKey) ?? 0n) +
        (order.side === "BUY" ? order.notionalMinor : -order.notionalMinor),
    );
  }
  const instruments = decisions.flatMap((asset) => {
    const members = requireRecordArray(asset.instruments, "자산군 종목 결정");
    return members.map((instrument) => {
      const key = requiredString(instrument.instrumentKey, "종목 키");
      const value =
        requiredBigIntString(instrument.currentValueMinor, "종목 현재 평가액") +
        (orderDelta.get(key) ?? 0n);
      if (value < 0n) {
        throw new OrderExecutionError(
          "ORDER_EXECUTION_BLOCKED",
          `${key} 예상 평가액이 음수가 되어 실행을 차단했습니다.`,
          "CONFLICT",
        );
      }
      return { key, valueMinor: value };
    });
  });
  const portfolioValueMinor = assetClasses.reduce((sum, item) => sum + item.valueMinor, 0n);
  const riskyAssetValueMinor = assetClasses
    .filter(({ key }) => key === "CORE" || key === "SATELLITE")
    .reduce((sum, item) => sum + item.valueMinor, 0n);
  return { portfolioValueMinor, instruments, assetClasses, riskyAssetValueMinor };
}

function requireRecordArray(value: unknown, label: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => item === null || typeof item !== "object")) {
    throw new OrderExecutionError(
      "ORDER_EXECUTION_BLOCKED",
      `${label}을 안전하게 해석하지 못했습니다.`,
      "CONFLICT",
    );
  }
  return value as readonly Record<string, unknown>[];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OrderExecutionError(
      "ORDER_EXECUTION_BLOCKED",
      `${label}을 안전하게 해석하지 못했습니다.`,
      "CONFLICT",
    );
  }
  return value;
}

function requiredBigIntString(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new OrderExecutionError(
      "ORDER_EXECUTION_BLOCKED",
      `${label}을 안전하게 해석하지 못했습니다.`,
      "CONFLICT",
    );
  }
  return BigInt(value);
}

function presentOrder(order: StoredOrderReceipt) {
  const current = order.timeline.at(-1);
  if (!current) throw new Error("주문 상태 이력이 없습니다.");
  return {
    orderId: order.id,
    logicalOrderId: order.logicalOrderId,
    planId: order.planId,
    planOrderId: order.planOrderId,
    mode: order.mode,
    symbol: order.symbol,
    instrumentKey: order.instrumentKey,
    side: order.side,
    quantity: order.quantity.toString(),
    limitPriceMinor: order.limitPriceMinor.toString(),
    plannedGrossMinor: order.plannedGrossMinor.toString(),
    reservedGrossMinor: order.reservedGrossMinor.toString(),
    clientOrderId: order.clientOrderId,
    currentState: current.state,
    createdAt: order.createdAt.toISOString(),
    timeline: order.timeline.map((entry) => ({
      sequence: entry.sequence,
      state: entry.state,
      brokerStatusRaw: entry.brokerStatusRaw,
      brokerOrderId: entry.brokerOrderId,
      brokerActionOrderId: entry.brokerActionOrderId,
      filledQuantity: entry.filledQuantity.toString(),
      filledGrossMinor: entry.filledGrossMinor.toString(),
      feeMinor: entry.feeMinor.toString(),
      occurredAt: entry.occurredAt.toISOString(),
      message: timelineMessage(entry.state, entry.detail),
    })),
  };
}

function timelineMessage(state: string, detail: unknown): string {
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const reason = (detail as Record<string, unknown>).reason;
    if (typeof reason === "string" && reason.length > 0) {
      const messages: Record<string, string> = {
        PAPER_SUBMISSION_STARTED: "Paper 주문의 모의 전송 준비를 시작했습니다.",
        PAPER_REPLAY_UNAVAILABLE:
          "Paper 체결 재생에 필요한 호가 증거를 확인하지 못해 미체결 상태로 유지합니다.",
        PAPER_LIMIT_FULL_FILL: "Paper 지정가가 호가를 통과해 전량 모의 체결했습니다.",
        PAPER_LIMIT_PARTIAL_FILL:
          "Paper 지정가가 호가를 통과했지만 보수적 잔량 정책에 따라 일부만 모의 체결했습니다.",
        PAPER_LIMIT_NOT_CROSSED:
          "Paper 지정가가 현재 호가를 통과하지 않아 미체결 상태로 유지합니다.",
        PAPER_LIQUIDITY_INSUFFICIENT:
          "Paper 호가 잔량이 부족해 주문을 미체결 또는 부분체결 상태로 유지합니다.",
        LIMIT_FULLY_FILLED: "Paper 지정가 주문을 전량 모의 체결했습니다.",
        LIMIT_PARTIALLY_FILLED: "Paper 지정가 주문을 일부 모의 체결했습니다.",
        LIVE_SUBMISSION_AUTHORIZED:
          "주문별 승인과 위험 증거를 봉인하고 브로커 전송 직전 상태로 전환했습니다.",
        AUTHORIZATION_NOT_DISPATCHED:
          "브로커 전송 기록이 전혀 없음을 DB가 증명해 주문을 미전송 거부 상태로 종료했습니다.",
        TOSS_ORDER_REQUEST_ACKNOWLEDGED: "토스증권이 주문 요청을 접수했습니다.",
        ORDER_OBSERVED: "토스증권 주문 조회로 현재 상태를 다시 확인했습니다.",
      };
      return messages[reason] ?? `주문 상태 근거를 기록했습니다: ${reason}`;
    }
  }
  const labels: Record<string, string> = {
    PLANNED: "주문 계획을 원장에 저장했습니다.",
    SUBMITTING: "주문 전송 직전 안전 증거를 확인하고 있습니다.",
    PENDING: "주문이 접수되어 체결을 기다리고 있습니다.",
    PARTIAL_FILLED: "주문이 일부 체결되었습니다.",
    FILLED: "주문이 모두 체결되었습니다.",
    CANCELED: "주문 취소를 확인했습니다.",
    REJECTED: "주문이 거부되었거나 전송되지 않았음을 확인했습니다.",
    UNKNOWN: "브로커 결과가 불명확해 새 주문을 차단했습니다.",
    UNKNOWN_BLOCKED: "자동 복구 범위를 넘어 운영자 확인이 필요합니다.",
  };
  return labels[state] ?? "주문 상태 변경을 원장에 기록했습니다.";
}

function liveOrdersEnabled(
  state: Awaited<ReturnType<PrismaOperationalConfigRepository["currentState"]>>,
): boolean {
  const parsed = OperationalConfigSchema.safeParse(state.activeVersion?.payload);
  return Boolean(
    parsed.success &&
    state.activeVersion &&
    parsed.data.mode === "LIVE" &&
    parsed.data.live.enabled &&
    parsed.data.live.accountAllowlistHmacs.includes(state.account?.externalRefHmac ?? "") &&
    state.killSwitch === "DISENGAGED" &&
    state.livePromotion === "GRANTED" &&
    state.livePromotionConfigVersionId === state.activeVersion.id,
  );
}

function firstBlockedMessage(
  checks: readonly { readonly outcome: "PASSED" | "BLOCKED"; readonly message: string }[],
): string {
  return (
    checks.find(({ outcome }) => outcome === "BLOCKED")?.message ??
    "주문 위험검사를 통과하지 못했습니다."
  );
}

function requireExecutionMode(value: string): "PAPER" | "LIVE" {
  if (value === "PAPER" || value === "LIVE") return value;
  throw new OrderExecutionError(
    "ORDER_PLAN_NOT_EXECUTABLE",
    "SHADOW 계획은 주문 실행할 수 없습니다. PAPER 또는 LIVE 계획을 새로 만드세요.",
    "CONFLICT",
  );
}

function requireSide(value: string): "BUY" | "SELL" {
  if (value === "BUY" || value === "SELL") return value;
  throw new OrderExecutionError(
    "ORDER_PLAN_NOT_EXECUTABLE",
    "저장 주문 방향이 BUY 또는 SELL이 아닙니다.",
    "CONFLICT",
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function orderStoreUnavailable(message: string, cause?: unknown): OrderExecutionError {
  return new OrderExecutionError(
    "ORDER_STORE_UNAVAILABLE",
    message,
    "UNAVAILABLE",
    cause === undefined ? undefined : { cause },
  );
}
