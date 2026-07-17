import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BrokerLiveOrderPort,
  BrokerOrderCancellationResult,
  BrokerOrderObservation,
  BrokerOrderReadResult,
  BrokerOrderSubmissionResult,
  BrokerReadResult,
  LiveOrderCancelAuthorization,
  LiveOrderSubmitAuthorization,
} from "@portfolio-rebalancer/broker";

import { loadEngineConfig } from "../../../config/engine.config";
import { createAccountReference } from "../../portfolio/application/collect-portfolio.use-case";
import type { PrismaOperationalConfigRepository } from "../../operational-config/infrastructure/persistence/prisma-operational-config.repository";
import type { PrismaPortfolioRepository } from "../../portfolio/infrastructure/persistence/prisma-portfolio.repository";
import type { TossRuntimeService } from "../../portfolio/infrastructure/broker/toss-runtime.service";
import type {
  AppendPaperStateInput,
  CreateCancelOperatorAuthorizationInput,
  CreateManualApprovalRecord,
  CreatePaperOrderRecord,
  StoredExecutionContext,
  StoredLiveOrderContext,
  StoredManualApproval,
  StoredOrderReceipt,
  PrismaOrderRepository,
} from "../infrastructure/persistence/prisma-order.repository";
import { OrdersService } from "./orders.service";

const NOW = new Date("2026-07-16T10:00:10+09:00");
const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const PLAN_ID = "10000000-0000-4000-8000-000000000002";
const RUN_ID = "10000000-0000-4000-8000-000000000003";
const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000004";
const TARGET_ID = "10000000-0000-4000-8000-000000000005";
const CONFIG_ID = "10000000-0000-4000-8000-000000000006";
const PROMOTION_ID = "10000000-0000-4000-8000-000000000007";
const PLAN_ORDER_1 = "10000000-0000-4000-8000-000000000008";
const PLAN_ORDER_2 = "10000000-0000-4000-8000-000000000009";
const APPROVAL_1 = "10000000-0000-4000-8000-000000000010";
const APPROVAL_2 = "10000000-0000-4000-8000-000000000011";
const BROKER_ORDER_ID = "broker-order-1";
const BROKER_ACTION_ID = "broker-cancel-1";
const ACCOUNT_NUMBER = "12345678901";
const ACCOUNT_REFERENCE_KEY = "synthetic-account-reference-key-01";
const ACCOUNT_HMAC = createAccountReference(ACCOUNT_NUMBER, ACCOUNT_REFERENCE_KEY);
const TOSS_CLIENT_ID = "synthetic-client-id";
const TOSS_CLIENT_SECRET = "synthetic-client-secret";
const PLAN_HASH = "b".repeat(64);
const CONFIG_HASH = "c".repeat(64);
const TEST_OPERATOR = {
  actor: "local-console",
} as const;
const RESPONSE_VALIDATION_IDS = Array.from(
  { length: 8 },
  (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

describe("OrdersService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snapshot 저장소 중 하나라도 실패하면 주문과 live 상태를 추정하지 않는다", async () => {
    const harness = serviceHarness();
    harness.repository.ordersSnapshot.mockRejectedValue(new Error("db unavailable"));

    await expect(harness.service.snapshot()).resolves.toEqual({
      state: "UNAVAILABLE",
      killSwitch: "UNKNOWN",
      orders: [],
      liveOrdersEnabled: false,
    });
  });

  it("Live 계획 승인은 현재 plan hash와 모든 plan order에 정확히 하나씩 묶는다", async () => {
    const context = executionContext("LIVE", 2);
    const harness = serviceHarness(context);
    harness.repository.createManualApprovals.mockImplementation(
      (_planId: string, _planVersion: number, records: CreateManualApprovalRecord[]) =>
        Promise.resolve(
          records.map((record) => ({
            id: record.id,
            planOrderId: record.planOrderId,
            accountId: record.accountId,
            approvalHash: record.approvalHash,
            planHash: record.planHash,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            consumedAt: null,
          })),
        ),
    );

    const receipt = await harness.service.createLivePlanApproval(
      {
        planId: PLAN_ID,
        planHash: PLAN_HASH,
        confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
      },
      TEST_OPERATOR,
    );

    expect(receipt.approvals).toHaveLength(2);
    expect(new Set(receipt.approvals.map(({ planOrderId }) => planOrderId))).toEqual(
      new Set([PLAN_ORDER_1, PLAN_ORDER_2]),
    );
    const approvalCall = harness.repository.createManualApprovals.mock.calls[0] as unknown as [
      string,
      number,
      Array<{ planOrderId: string; planHash: string; actor: string }>,
    ];
    expect(approvalCall[0]).toBe(PLAN_ID);
    expect(approvalCall[1]).toBe(1);
    expect(approvalCall[2]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planOrderId: PLAN_ORDER_1,
          planHash: PLAN_HASH,
        }),
        expect.objectContaining({ planOrderId: PLAN_ORDER_2, planHash: PLAN_HASH }),
      ]),
    );
    expect(approvalCall[2].find(({ planOrderId }) => planOrderId === PLAN_ORDER_1)?.actor).toBe(
      "local-console",
    );

    await expect(
      harness.service.createLivePlanApproval(
        {
          planId: PLAN_ID,
          planHash: "f".repeat(64),
          confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
        },
        TEST_OPERATOR,
      ),
    ).rejects.toMatchObject({ code: "ORDER_APPROVAL_INVALID" });
    expect(harness.repository.createManualApprovals).toHaveBeenCalledOnce();
  });

  it("Paper는 broker write 없이 원장을 만들고 호가 replay 결과만 상태 이력에 기록한다", async () => {
    const context = executionContext("PAPER", 1);
    const harness = serviceHarness(context);
    const receipts = new Map<string, StoredOrderReceipt>();
    harness.repository.createPaperOrders.mockImplementation(
      ({ orders }: { orders: CreatePaperOrderRecord[] }) =>
        Promise.resolve(
          orders.map((order) => {
            const stored = storedOrder({
              id: order.id,
              logicalOrderId: order.logicalOrderId,
              planOrderId: order.planOrderId,
              mode: "PAPER",
              state: "PLANNED",
            });
            receipts.set(stored.id, stored);
            return stored;
          }),
        ),
    );
    harness.repository.appendPaperState.mockImplementation((input: AppendPaperStateInput) => {
      const current = receipts.get(input.orderId);
      if (!current) return Promise.resolve(null);
      const updated = appendState(current, input);
      receipts.set(input.orderId, updated);
      return Promise.resolve(updated);
    });

    const receipt = await harness.service.execute({
      planId: PLAN_ID,
      mode: "PAPER",
      approvalIds: [],
    });

    expect(receipt).toMatchObject({ mode: "PAPER", outcome: "PENDING" });
    expect(harness.repository.createPaperOrders).toHaveBeenCalledOnce();
    expect(harness.repository.appendPaperState).toHaveBeenCalledWith(
      expect.objectContaining({ state: "SUBMITTING" }),
    );
    expect(harness.repository.appendPaperState).toHaveBeenCalledWith(
      expect.objectContaining({ state: "PENDING" }),
    );
    expect(harness.runtime.source.getOrderBook).toHaveBeenCalledOnce();
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
    expect(harness.runtime.liveOrders.cancelOrder).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "환경변수 accountSeq가 봉인 계좌와 불일치",
      mutate: (_context: StoredExecutionContext, harness: ReturnType<typeof serviceHarness>) => {
        harness.runtime.source.listAccountsEvidence.mockResolvedValue({
          ...neutralRead([
            { accountNo: "98765432109", accountSeq: 1, accountType: "BROKERAGE" as const },
          ]),
          responseValidationId: RESPONSE_VALIDATION_IDS[7],
          redactedBody: {},
        });
      },
      expectedCode: "ORDER_EXECUTION_BLOCKED",
    },
    {
      name: "승인 묶음 누락",
      mutate: (_context: StoredExecutionContext, harness: ReturnType<typeof serviceHarness>) => {
        harness.repository.manualApprovals.mockResolvedValue([]);
      },
      expectedCode: "ORDER_APPROVAL_INVALID",
    },
    {
      name: "운영 config mode 불일치",
      mutate: (context: StoredExecutionContext) => {
        mutableContext(context).operationalConfig = {
          id: CONFIG_ID,
          canonicalContent: JSON.stringify(paperOperationalConfig()),
          contentHash: CONFIG_HASH,
          payload: paperOperationalConfig(),
        };
      },
      expectedCode: "ORDER_EXECUTION_BLOCKED",
    },
    {
      name: "promotion 회수",
      mutate: (context: StoredExecutionContext) => {
        mutableContext(context).promotion = {
          id: PROMOTION_ID,
          state: "REVOKED",
          operationalConfigVersionId: CONFIG_ID,
        };
      },
      expectedCode: "ORDER_EXECUTION_BLOCKED",
    },
    {
      name: "kill switch 작동",
      mutate: (context: StoredExecutionContext) => {
        mutableContext(context).killSwitch = "ENGAGED";
      },
      expectedCode: "ORDER_EXECUTION_BLOCKED",
    },
    {
      name: "pretrade 현재가 검증 ID 누락",
      mutate: (_context: StoredExecutionContext, harness: ReturnType<typeof serviceHarness>) => {
        harness.runtime.source.getPrices.mockResolvedValue({
          ...neutralRead([priceQuote()]),
          responseValidationId: null,
          redactedBody: {},
        });
      },
      expectedCode: "ORDER_PRETRADE_BLOCKED",
    },
  ])("$name 하나만 실패해도 broker write는 0회다", async ({ mutate, expectedCode }) => {
    const context = executionContext("LIVE", 1);
    const harness = serviceHarness(context);
    mutate(context, harness);

    await expect(
      harness.service.execute(
        {
          planId: PLAN_ID,
          mode: "LIVE",
          approvalIds: [APPROVAL_1],
        },
        TEST_OPERATOR,
      ),
    ).rejects.toMatchObject({ code: expectedCode });
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
    expect(harness.repository.claimLiveDispatch).not.toHaveBeenCalled();
  });

  it("성공한 Live는 A 준비→B audit claim→submit 1회→즉시 reconcile 순서이며 한 주문만 전송한다", async () => {
    const events: string[] = [];
    const context = executionContext("LIVE", 2);
    const harness = serviceHarness(context, events);
    let liveLedgerOrder: StoredOrderReceipt | null = null;
    let liveLedgerOrderId = "";
    harness.repository.createLivePreSubmitEvidenceAndLedger.mockImplementation(
      (input: { order: CreatePaperOrderRecord; preSubmitEvidence: { id: string } }) => {
        liveLedgerOrder = storedOrder({
          id: input.order.id,
          logicalOrderId: input.order.logicalOrderId,
          planOrderId: input.order.planOrderId,
          mode: "LIVE",
          state: "PLANNED",
        });
        liveLedgerOrderId = liveLedgerOrder.id;
        return Promise.resolve({
          order: liveLedgerOrder,
          preSubmitEvidenceId: input.preSubmitEvidence.id,
          reservationId: "30000000-0000-4000-8000-000000000001",
        });
      },
    );
    harness.repository.prepareLiveSubmission.mockImplementation(() => {
      events.push("A");
      return Promise.resolve({
        id: "30000000-0000-4000-8000-000000000002",
        preparedAt: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
      });
    });
    harness.repository.claimLiveDispatch.mockImplementation((input: { id: string }) => {
      events.push("B");
      return Promise.resolve({ id: input.id, claimedAt: new Date() });
    });
    harness.runtime.liveOrders.submitOrder.mockImplementation(
      async (authorization: LiveOrderSubmitAuthorization, request: { clientOrderId: string }) => {
        await authorization.audit(submitAuditIntent(authorization));
        events.push("submit");
        return {
          ...acknowledgedSubmit(request.clientOrderId),
          rawPayload: {
            message: `Bearer abc.def.ghi client_secret=${TOSS_CLIENT_SECRET} accountNo=${ACCOUNT_NUMBER}`,
            nested: { secret: TOSS_CLIENT_SECRET },
            stringifiedJson: JSON.stringify({
              accountNo: ACCOUNT_NUMBER,
              refresh_token: "opaque-refresh-token",
            }),
          },
        };
      },
    );
    harness.repository.recordSubmitOutcome.mockImplementation(() => {
      events.push("record-submit");
      if (!liveLedgerOrder) throw new Error("ledger order missing");
      liveLedgerOrder = appendState(liveLedgerOrder, {
        state: "PENDING",
        filledQuantity: 0n,
        filledGrossMinor: 0n,
        feeMinor: 0n,
        detail: { reason: "ACKNOWLEDGED" },
        brokerOrderId: BROKER_ORDER_ID,
      });
      return Promise.resolve(liveLedgerOrder);
    });
    harness.repository.liveOrderContext.mockImplementation(() => {
      if (!liveLedgerOrder) return Promise.resolve(null);
      return Promise.resolve(liveContextFrom(liveLedgerOrder, "PENDING", BROKER_ORDER_ID));
    });
    harness.runtime.liveOrders.getOrder.mockImplementation(() => {
      events.push("getOrder");
      return Promise.resolve(observedOrder("PENDING"));
    });
    harness.repository.recordReconciliation.mockImplementation(() => {
      events.push("reconcile");
      return Promise.resolve(liveLedgerOrder);
    });

    const result = await harness.service.execute(
      {
        planId: PLAN_ID,
        mode: "LIVE",
        approvalIds: [APPROVAL_1, APPROVAL_2],
      },
      TEST_OPERATOR,
    );

    expect(result).toMatchObject({
      planId: PLAN_ID,
      mode: "LIVE",
      outcome: "PENDING",
      orderIds: [liveLedgerOrderId],
    });
    expect(harness.runtime.liveOrders.submitOrder).toHaveBeenCalledOnce();
    expect(harness.repository.createLivePreSubmitEvidenceAndLedger).toHaveBeenCalledOnce();
    const liveLedgerCall = harness.repository.createLivePreSubmitEvidenceAndLedger.mock
      .calls[0] as unknown as [
      {
        order: { planOrderId: string };
        preSubmitEvidence: { id: string };
      },
    ];
    expect(liveLedgerCall[0]).toMatchObject({
      order: { planOrderId: PLAN_ORDER_1 },
    });
    const auditCalls = harness.runtime.requestAuditContext.run.mock.calls as unknown as Array<
      [{ workflowType: string; correlationId: string }, () => Promise<unknown>]
    >;
    const accountBindingAudit = auditCalls.find(
      ([audit]) => audit.workflowType === "LIVE_PRE_SUBMIT_ACCOUNT_BINDING",
    )?.[0];
    const preSubmitAudit = auditCalls.find(
      ([audit]) => audit.workflowType === "LIVE_PRE_SUBMIT",
    )?.[0];
    expect(accountBindingAudit?.correlationId).toBe(liveLedgerCall[0].preSubmitEvidence.id);
    expect(preSubmitAudit?.correlationId).toBe(liveLedgerCall[0].preSubmitEvidence.id);
    expect(harness.runtime.liveOrders.getOrder).toHaveBeenCalledOnce();
    expect(harness.repository.recordReconciliation).toHaveBeenCalledOnce();
    const submitOutcomeCall = harness.repository.recordSubmitOutcome.mock.calls[0] as unknown as [
      { redactedBody: unknown },
    ];
    const submitEvidence = JSON.stringify(submitOutcomeCall[0].redactedBody);
    expect(submitEvidence).toContain("[REDACTED]");
    expect(submitEvidence).not.toContain(TOSS_CLIENT_SECRET);
    expect(submitEvidence).not.toContain(ACCOUNT_NUMBER);
    expect(submitEvidence).not.toContain("abc.def.ghi");
    expect(submitEvidence).not.toContain("opaque-refresh-token");
    expect(events).toEqual(["A", "B", "submit", "record-submit", "getOrder", "reconcile"]);
  });

  it("cancel은 operator authorization→cancel claim 뒤 1회만 호출하고 accepted action을 즉시 reconcile한다", async () => {
    const events: string[] = [];
    const harness = serviceHarness(undefined, events);
    const original = storedOrder({
      id: "40000000-0000-4000-8000-000000000001",
      logicalOrderId: "40000000-0000-4000-8000-000000000002",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "PENDING",
      brokerOrderId: BROKER_ORDER_ID,
    });
    const context = liveContextFrom(original, "PENDING", BROKER_ORDER_ID);
    harness.repository.liveOrderContext.mockResolvedValue(context);
    harness.repository.ordersSnapshot.mockResolvedValue([original]);
    harness.repository.createCancelOperatorAuthorization.mockImplementation(
      (input: CreateCancelOperatorAuthorizationInput) => {
        events.push("cancel-authorization");
        return Promise.resolve({
          id: input.id,
          authorizationId: input.authorizationId,
          authorizationDigest: input.authorizationDigest,
          authorizedAt: input.authorizedAt,
          expiresAt: input.expiresAt,
        });
      },
    );
    harness.repository.claimCancelDispatch.mockImplementation((input: { id: string }) => {
      events.push("cancel-claim");
      return Promise.resolve({ id: input.id, claimedAt: new Date() });
    });
    harness.runtime.liveOrders.cancelOrder.mockImplementation(
      async (authorization: LiveOrderCancelAuthorization) => {
        await authorization.audit(cancelAuditIntent(authorization));
        events.push("cancel");
        return acknowledgedCancel();
      },
    );
    harness.repository.recordCancelOutcome.mockImplementation(() => {
      events.push("accepted-action");
      return Promise.resolve({
        kind: "ACTION",
        id: "40000000-0000-4000-8000-000000000003",
      });
    });
    harness.runtime.liveOrders.getOrder.mockImplementation(() => {
      events.push("getOrder");
      return Promise.resolve(observedOrder("CANCELED"));
    });
    const canceled = appendState(original, {
      state: "CANCELED",
      filledQuantity: 0n,
      filledGrossMinor: 0n,
      feeMinor: 0n,
      detail: { reason: "ORDER_CANCELED" },
      brokerOrderId: BROKER_ORDER_ID,
      brokerActionOrderId: BROKER_ACTION_ID,
    });
    harness.repository.recordReconciliation.mockImplementation(() => {
      events.push("reconcile");
      return Promise.resolve(canceled);
    });

    const receipt = await harness.service.cancel(
      {
        orderId: original.id,
        reason: "사용자가 미체결 주문 취소를 요청했습니다.",
        confirmation: "미체결 주문 취소를 요청합니다",
      },
      TEST_OPERATOR,
    );

    expect(receipt).toMatchObject({
      orderId: original.id,
      outcome: "REQUEST_ACCEPTED",
      currentState: "CANCELED",
      brokerActionOrderId: BROKER_ACTION_ID,
    });
    expect(harness.runtime.liveOrders.cancelOrder).toHaveBeenCalledOnce();
    expect(harness.runtime.liveOrders.getOrder).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "cancel-authorization",
      "cancel-claim",
      "cancel",
      "accepted-action",
      "getOrder",
      "reconcile",
    ]);
  });

  it("Live 원장과 예약 뒤 A 전에 중단되면 DB 증명으로 REJECTED 전환하고 예약을 해제한다", async () => {
    const harness = serviceHarness();
    const planned = storedOrder({
      id: "50000000-0000-4000-8000-000000000022",
      logicalOrderId: "50000000-0000-4000-8000-000000000023",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "PLANNED",
    });
    const context = liveContextFrom(planned, "PLANNED", null);
    harness.repository.liveOrderContext.mockResolvedValue(context);
    const rejected = appendState(planned, {
      state: "REJECTED",
      filledQuantity: 0n,
      filledGrossMinor: 0n,
      feeMinor: 0n,
      detail: { reason: "PRE_AUTHORIZATION_NOT_COMPLETED" },
    });
    harness.repository.recoverPlannedOrderWithoutAuthorization.mockResolvedValue({
      evidenceId: "50000000-0000-4000-8000-000000000024",
      recordedAt: new Date(),
      proofSha256: "a".repeat(64),
      order: rejected,
    });

    const result = await harness.service.reconcile(planned.id);

    expect(result.currentState).toBe("REJECTED");
    expect(harness.repository.recoverPlannedOrderWithoutAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: planned.id,
        reservationId: context.reservationId,
      }),
    );
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
  });

  it("A 승인 뒤 B dispatch claim이 전혀 없으면 불변 비전송 증거로 REJECTED 복구한다", async () => {
    const harness = serviceHarness();
    const submitting = storedOrder({
      id: "50000000-0000-4000-8000-000000000001",
      logicalOrderId: "50000000-0000-4000-8000-000000000002",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "SUBMITTING",
    });
    const submissionAuthorizationId = "50000000-0000-4000-8000-000000000003";
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(submitting, "SUBMITTING", null, submissionAuthorizationId),
    );
    const rejected = appendState(submitting, {
      state: "REJECTED",
      filledQuantity: 0n,
      filledGrossMinor: 0n,
      feeMinor: 0n,
      detail: { reason: "AUTHORIZATION_NOT_DISPATCHED" },
    });
    harness.repository.recoverAuthorizedOrderWithoutDispatch.mockResolvedValue({
      evidenceId: "50000000-0000-4000-8000-000000000004",
      recordedAt: new Date(),
      proofSha256: "a".repeat(64),
      order: rejected,
    });

    const result = await harness.service.reconcile(submitting.id);

    expect(result.currentState).toBe("REJECTED");
    expect(harness.repository.recoverAuthorizedOrderWithoutDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionAuthorizationId,
        orderId: submitting.id,
      }),
    );
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
  });

  it("B 존재 가능성 때문에 비전송 증명을 만들 수 없으면 SUBMITTING을 유지하고 재제출하지 않는다", async () => {
    const harness = serviceHarness();
    const submitting = storedOrder({
      id: "50000000-0000-4000-8000-000000000005",
      logicalOrderId: "50000000-0000-4000-8000-000000000006",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "SUBMITTING",
    });
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(submitting, "SUBMITTING", null, "50000000-0000-4000-8000-000000000007"),
    );
    harness.repository.recoverAuthorizedOrderWithoutDispatch.mockRejectedValue(
      new Error("dispatch claim exists"),
    );

    await expect(harness.service.reconcile(submitting.id)).rejects.toMatchObject({
      code: "ORDER_RECOVERY_BLOCKED",
    });
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
  });

  it("B 이후 결과 저장 전 중단은 clientOrderId 없는 주문 후보를 자동 귀속하지 않는다", async () => {
    const harness = serviceHarness();
    const submitting = storedOrder({
      id: "50000000-0000-4000-8000-000000000010",
      logicalOrderId: "50000000-0000-4000-8000-000000000011",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "SUBMITTING",
    });
    const dispatch = {
      id: "50000000-0000-4000-8000-000000000012",
      startedAt: new Date("2026-07-16T09:59:30+09:00"),
    };
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(
        submitting,
        "SUBMITTING",
        null,
        "50000000-0000-4000-8000-000000000013",
        dispatch,
      ),
    );
    harness.repository.ordersSnapshot.mockResolvedValue([submitting]);
    harness.runtime.liveOrders.listOpenOrders.mockResolvedValue(
      observedOpenOrders([observedOrder("PENDING").value!]),
    );

    const result = await harness.service.reconcile(submitting.id);

    expect(result.currentState).toBe("SUBMITTING");
    expect(harness.runtime.liveOrders.listOpenOrders).not.toHaveBeenCalled();
    expect(harness.runtime.liveOrders.getOrder).not.toHaveBeenCalled();
    expect(harness.repository.recordReconciliation).not.toHaveBeenCalled();
    expect(harness.repository.recordUnknownBlocked).not.toHaveBeenCalled();
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
  });

  it("B 이후 후보를 10분 넘게 확정하지 못하면 broker ID 없이 UNKNOWN_BLOCKED로 잠근다", async () => {
    const harness = serviceHarness();
    const submitting = storedOrder({
      id: "50000000-0000-4000-8000-000000000014",
      logicalOrderId: "50000000-0000-4000-8000-000000000015",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "SUBMITTING",
    });
    const dispatch = {
      id: "50000000-0000-4000-8000-000000000016",
      startedAt: new Date(NOW.getTime() - 10 * 60_000 - 1),
    };
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(
        submitting,
        "SUBMITTING",
        null,
        "50000000-0000-4000-8000-000000000017",
        dispatch,
      ),
    );
    const blocked = appendState(submitting, {
      state: "UNKNOWN_BLOCKED",
      filledQuantity: 0n,
      filledGrossMinor: 0n,
      feeMinor: 0n,
      detail: { reason: "IDEMPOTENCY_WINDOW_EXPIRED" },
    });
    harness.repository.recordUnknownBlocked.mockResolvedValue(blocked);

    const result = await harness.service.reconcile(submitting.id);

    expect(result.currentState).toBe("UNKNOWN_BLOCKED");
    expect(harness.repository.recordUnknownBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: submitting.id,
        brokerOrderId: null,
        dispatchClaimId: dispatch.id,
      }),
    );
    expect(harness.runtime.liveOrders.submitOrder).not.toHaveBeenCalled();
  });

  it("UNKNOWN_BLOCKED는 방금 조회한 exact broker observation과 운영자 입력이 모두 일치할 때만 복구한다", async () => {
    const harness = serviceHarness();
    const blocked = storedOrder({
      id: "50000000-0000-4000-8000-000000000001",
      logicalOrderId: "50000000-0000-4000-8000-000000000002",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "UNKNOWN_BLOCKED",
      brokerOrderId: BROKER_ORDER_ID,
    });
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(blocked, "UNKNOWN_BLOCKED", BROKER_ORDER_ID),
    );
    harness.runtime.liveOrders.getOrder.mockResolvedValue(
      observedOrder("FILLED", {
        filledQuantity: 1n,
        filledGrossNotionalMinor: 10_000n,
        feeMinor: 15n,
      }),
    );
    const filled = appendState(blocked, {
      state: "FILLED",
      filledQuantity: 1n,
      filledGrossMinor: 10_000n,
      feeMinor: 15n,
      detail: { reason: "ORDER_FILLED" },
      brokerOrderId: BROKER_ORDER_ID,
    });
    harness.repository.recordReconciliation.mockResolvedValue(filled);

    const recovered = await harness.service.recoverUnknown(
      {
        orderId: blocked.id,
        resolvedState: "FILLED",
        brokerEvidenceReference: "operator-checked-broker-order-screen",
        brokerOrderId: BROKER_ORDER_ID,
        limitPriceMinor: "10000",
        filledQuantity: "1",
        filledGrossMinor: "10000",
        feeMinor: "15",
      },
      TEST_OPERATOR,
    );

    expect(recovered.currentState).toBe("FILLED");
    expect(harness.runtime.liveOrders.getOrder).toHaveBeenCalledOnce();
    const reconciliationCall = harness.repository.recordReconciliation.mock.calls[0] as unknown as [
      {
        actor: string;
        validatedState: string;
        brokerOrderId: string;
        filledQuantity: bigint;
        filledGrossMinor: bigint;
        feeMinor: bigint;
        detail: { operatorEvidenceReference: string | null };
      },
    ];
    expect(reconciliationCall[0]).toMatchObject({
      actor: "OPERATOR",
      validatedState: "FILLED",
      brokerOrderId: BROKER_ORDER_ID,
      filledQuantity: 1n,
      filledGrossMinor: 10_000n,
      feeMinor: 15n,
    });
    expect(reconciliationCall[0].detail.operatorEvidenceReference).toContain(
      "operator-checked-broker-order-screen",
    );
  });

  it("broker ID 없는 UNKNOWN_BLOCKED도 B 증거와 운영자 입력으로 exact 복구한다", async () => {
    const harness = serviceHarness();
    const blocked = storedOrder({
      id: "50000000-0000-4000-8000-000000000018",
      logicalOrderId: "50000000-0000-4000-8000-000000000019",
      planOrderId: PLAN_ORDER_1,
      mode: "LIVE",
      state: "UNKNOWN_BLOCKED",
    });
    harness.repository.liveOrderContext.mockResolvedValue(
      liveContextFrom(blocked, "UNKNOWN_BLOCKED", null, "50000000-0000-4000-8000-000000000020", {
        id: "50000000-0000-4000-8000-000000000021",
        startedAt: new Date("2026-07-16T09:59:30+09:00"),
      }),
    );
    harness.runtime.liveOrders.getOrder.mockResolvedValue(
      observedOrder("FILLED", {
        filledQuantity: 1n,
        filledGrossNotionalMinor: 10_000n,
        feeMinor: 15n,
      }),
    );
    const filled = appendState(blocked, {
      state: "FILLED",
      filledQuantity: 1n,
      filledGrossMinor: 10_000n,
      feeMinor: 15n,
      detail: { reason: "ORDER_FILLED" },
      brokerOrderId: BROKER_ORDER_ID,
    });
    harness.repository.recordReconciliation.mockResolvedValue(filled);

    const result = await harness.service.recoverUnknown(
      {
        orderId: blocked.id,
        resolvedState: "FILLED",
        brokerEvidenceReference: "operator-checked-broker-order-screen",
        brokerOrderId: BROKER_ORDER_ID,
        limitPriceMinor: "10000",
        filledQuantity: "1",
        filledGrossMinor: "10000",
        feeMinor: "15",
      },
      TEST_OPERATOR,
    );

    expect(result.currentState).toBe("FILLED");
    expect(harness.repository.recordReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: blocked.id,
        brokerOrderId: BROKER_ORDER_ID,
        actor: "OPERATOR",
      }),
    );
  });

  it.each([
    {
      name: "브로커 확정 관측 실패",
      result: unavailableOrder(),
      filledQuantity: "1",
      limitPriceMinor: "10000",
      expectedCode: "ORDER_RECOVERY_BLOCKED",
    },
    {
      name: "운영자 누적 체결값 불일치",
      result: observedOrder("FILLED", {
        filledQuantity: 1n,
        filledGrossNotionalMinor: 10_000n,
        feeMinor: 15n,
      }),
      filledQuantity: "0",
      limitPriceMinor: "10000",
      expectedCode: "ORDER_RECOVERY_BLOCKED",
    },
    {
      name: "브로커 지정가와 원 주문 불일치",
      result: observedOrder("FILLED", {
        limitPriceMinor: 10_001n,
        filledQuantity: 1n,
        filledGrossNotionalMinor: 10_000n,
        feeMinor: 15n,
      }),
      filledQuantity: "1",
      limitPriceMinor: "10001",
      expectedCode: "ORDER_RECOVERY_BLOCKED",
    },
    {
      name: "운영자 지정가 입력 불일치",
      result: observedOrder("FILLED", {
        filledQuantity: 1n,
        filledGrossNotionalMinor: 10_000n,
        feeMinor: 15n,
      }),
      filledQuantity: "1",
      limitPriceMinor: "10001",
      expectedCode: "ORDER_RECOVERY_BLOCKED",
    },
  ])(
    "$name이면 UNKNOWN_BLOCKED를 변경하지 않는다",
    async ({ result, filledQuantity, limitPriceMinor, expectedCode }) => {
      const harness = serviceHarness();
      const blocked = storedOrder({
        id: "50000000-0000-4000-8000-000000000003",
        logicalOrderId: "50000000-0000-4000-8000-000000000004",
        planOrderId: PLAN_ORDER_1,
        mode: "LIVE",
        state: "UNKNOWN_BLOCKED",
        brokerOrderId: BROKER_ORDER_ID,
      });
      harness.repository.liveOrderContext.mockResolvedValue(
        liveContextFrom(blocked, "UNKNOWN_BLOCKED", BROKER_ORDER_ID),
      );
      harness.runtime.liveOrders.getOrder.mockResolvedValue(result);

      await expect(
        harness.service.recoverUnknown(
          {
            orderId: blocked.id,
            resolvedState: "FILLED",
            brokerEvidenceReference: "operator-checked-broker-order-screen",
            brokerOrderId: BROKER_ORDER_ID,
            limitPriceMinor,
            filledQuantity,
            filledGrossMinor: "10000",
            feeMinor: "15",
          },
          TEST_OPERATOR,
        ),
      ).rejects.toMatchObject({ code: expectedCode });
      expect(harness.repository.recordReconciliation).not.toHaveBeenCalled();
    },
  );
});

function serviceHarness(context = executionContext("LIVE", 1), events: string[] = []) {
  const repository = {
    ordersSnapshot: vi.fn().mockResolvedValue([]),
    loadExecutionContext: vi.fn().mockResolvedValue(context),
    manualApprovals: vi.fn().mockResolvedValue(manualApprovals(context)),
    createManualApprovals: vi.fn(),
    createPaperOrders: vi.fn(),
    appendPaperState: vi.fn(),
    appendExecutionRiskEvidence: vi.fn().mockResolvedValue({ id: "risk-evidence" }),
    createLivePreSubmitEvidenceAndLedger: vi.fn(),
    prepareLiveSubmission: vi.fn(),
    claimLiveDispatch: vi.fn(),
    recoverPlannedOrderWithoutAuthorization: vi.fn(),
    recoverAuthorizedOrderWithoutDispatch: vi.fn(),
    recordSubmitOutcome: vi.fn(),
    liveOrderContext: vi.fn(),
    recordReconciliation: vi.fn(),
    recordUnknownBlocked: vi.fn(),
    latestAcceptedCancelAction: vi.fn().mockResolvedValue(null),
    createCancelOperatorAuthorization: vi.fn(),
    claimCancelDispatch: vi.fn(),
    recordCancelOutcome: vi.fn(),
    appendKillSwitch: vi.fn(),
  };
  const operationalConfigRepository = {
    currentState: vi.fn().mockResolvedValue({
      account: { id: ACCOUNT_ID, externalRefHmac: ACCOUNT_HMAC },
      activeVersion: null,
      draftVersion: null,
      killSwitch: "DISENGAGED",
      livePromotion: "GRANTED",
      livePromotionConfigVersionId: CONFIG_ID,
    }),
  };
  const portfolioRepository = {
    recordInstrumentValidation: vi.fn().mockResolvedValue({
      id: "60000000-0000-4000-8000-000000000001",
      tradeBlockedNow: false,
      requiresOrderRevalidation: false,
      observedAt: new Date(),
    }),
  };
  const runtime = fakeRuntime(events);
  const tossRuntime = { get: vi.fn().mockReturnValue(runtime) };
  const service = new OrdersService(
    loadEngineConfig({
      DATABASE_RUNTIME_URL: "postgresql://test_runtime:test@localhost:5432/test",
      TOSSINVEST_ACCOUNT_SEQ: "1",
      TOSSINVEST_CLIENT_ID: TOSS_CLIENT_ID,
      TOSSINVEST_CLIENT_SECRET: TOSS_CLIENT_SECRET,
      ACCOUNT_REFERENCE_KEY,
      TOSS_EGRESS_ALLOWLIST_CONFIRMED: "true",
    }),
    repository as unknown as PrismaOrderRepository,
    operationalConfigRepository as unknown as PrismaOperationalConfigRepository,
    portfolioRepository as unknown as PrismaPortfolioRepository,
    tossRuntime as unknown as TossRuntimeService,
  );
  return { service, repository, operationalConfigRepository, portfolioRepository, runtime };
}

function executionContext(mode: "PAPER" | "LIVE", orderCount: 1 | 2): StoredExecutionContext {
  const orders = [
    planOrder(PLAN_ORDER_1, 0),
    ...(orderCount === 2 ? [planOrder(PLAN_ORDER_2, 1)] : []),
  ];
  const projectedCore = 100_000n + orders.reduce((sum, order) => sum + order.notionalMinor, 0n);
  const config = mode === "LIVE" ? liveOperationalConfig() : paperOperationalConfig();
  return {
    plan: {
      id: PLAN_ID,
      runId: RUN_ID,
      planVersion: 1,
      planHash: PLAN_HASH,
      mode,
      status: "PLANNED",
      snapshotId: SNAPSHOT_ID,
      snapshotDigest: "d".repeat(64),
      targetConfigVersionId: TARGET_ID,
      targetConfigContentHash: "e".repeat(64),
      totalValueMinor: 1_000_000n,
      assetDecisions: [
        {
          id: "CORE",
          instruments: [{ instrumentKey: "KR:005930", currentValueMinor: "100000" }],
        },
        { id: "SAFE", instruments: [] },
        { id: "SATELLITE", instruments: [] },
        { id: "CASH", instruments: [] },
      ],
      projectedAllocations: [
        { id: "CORE", valueMinor: projectedCore.toString() },
        { id: "SAFE", valueMinor: "0" },
        { id: "SATELLITE", valueMinor: "0" },
        { id: "CASH", valueMinor: (1_000_000n - projectedCore).toString() },
      ],
      orders,
    },
    account: { id: ACCOUNT_ID, externalRefHmac: ACCOUNT_HMAC },
    currentIdentity: {
      snapshotId: SNAPSHOT_ID,
      snapshotDigest: "d".repeat(64),
      targetConfigVersionId: TARGET_ID,
      targetConfigContentHash: "e".repeat(64),
    },
    operationalConfig: {
      id: CONFIG_ID,
      canonicalContent: JSON.stringify(config),
      contentHash: CONFIG_HASH,
      payload: config,
    },
    promotion:
      mode === "LIVE"
        ? {
            id: PROMOTION_ID,
            state: "GRANTED",
            operationalConfigVersionId: CONFIG_ID,
          }
        : null,
    killSwitch: "DISENGAGED",
    existingOrders: [],
    tradeDayFilledGrossMinor: 0n,
    reservedPendingGrossMinor: 0n,
  };
}

function planOrder(id: string, ordinal: number) {
  return {
    id,
    candidateId: `CORE:KR:005930:BUY:${ordinal}`,
    phase: "BUY" as const,
    ordinal,
    assetClassId: "CORE",
    instrumentKey: "KR:005930",
    marketCountry: "KR",
    currency: "KRW",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: 1n,
    limitPriceMinor: 10_000n,
    notionalMinor: 10_000n,
    plannedPriceSnapshotId: `70000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
    plannedQuotePriceMinor: 10_000n,
    plannedQuoteObservedAt: new Date("2026-07-16T10:00:00+09:00"),
    plannedQuoteReceivedAt: new Date("2026-07-16T10:00:01+09:00"),
    plannedQuoteAuditReference: `planned-quote-${ordinal}`,
  };
}

function manualApprovals(context: StoredExecutionContext): StoredManualApproval[] {
  return context.plan.orders.map((order, index) => ({
    id: index === 0 ? APPROVAL_1 : APPROVAL_2,
    planOrderId: order.id,
    accountId: ACCOUNT_ID,
    approvalHash: `${index + 1}`.repeat(64),
    planHash: PLAN_HASH,
    createdAt: new Date(NOW.getTime() - 5_000),
    expiresAt: new Date(NOW.getTime() + 300_000),
    consumedAt: null,
  }));
}

function liveOperationalConfig() {
  return {
    ...baseOperationalConfig(),
    mode: "LIVE" as const,
    killSwitch: false,
    live: {
      enabled: true,
      marketCountry: "KR" as const,
      allowedSession: "REGULAR_MARKET" as const,
      orderType: "LIMIT" as const,
      timeInForce: "DAY" as const,
      accountAllowlistHmacs: [ACCOUNT_HMAC],
      manualApprovalRequired: true,
      approvalTtlSeconds: 600,
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      tinyLiveMaxGrossMinor: "50000",
    },
  };
}

function paperOperationalConfig() {
  return {
    ...baseOperationalConfig(),
    mode: "PAPER" as const,
    killSwitch: false,
    live: {
      enabled: false,
      marketCountry: "KR" as const,
      allowedSession: "REGULAR_MARKET" as const,
      orderType: "LIMIT" as const,
      timeInForce: "DAY" as const,
      accountAllowlistHmacs: [],
      manualApprovalRequired: true,
      approvalTtlSeconds: 600,
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      tinyLiveMaxGrossMinor: "50000",
    },
  };
}

function baseOperationalConfig() {
  return {
    schemaVersion: "OPERATIONAL_CONFIG_V1" as const,
    freshness: {
      quote: {
        planMaxAgeSeconds: 300,
        preSubmitMaxAgeSeconds: 30,
        futureToleranceSeconds: 10,
      },
      calendar: { maxAgeSeconds: 86_400, futureToleranceSeconds: 10 },
    },
    limits: {
      minimumOrderGrossMinor: "1000",
      feeBufferMinor: "100",
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      maxDailyTurnoverBasisPoints: 10_000,
      maxAbsolutePriceChangeBasisPoints: 500,
      maxInstrumentWeightBasisPoints: 10_000,
      maxAssetClassWeightBasisPoints: 10_000,
      maxRiskyWeightBasisPoints: 10_000,
    },
  };
}

function fakeRuntime(events: string[]) {
  const source = {
    listAccountsEvidence: vi.fn().mockResolvedValue({
      ...neutralRead([
        { accountNo: ACCOUNT_NUMBER, accountSeq: 1, accountType: "BROKERAGE" as const },
      ]),
      responseValidationId: RESPONSE_VALIDATION_IDS[7],
      redactedBody: {
        result: [
          {
            accountReferenceHmac: ACCOUNT_HMAC,
            accountNo: "**** 8901",
            accountType: "BROKERAGE",
          },
        ],
      },
    }),
    getPrices: vi.fn().mockResolvedValue({
      ...neutralRead([priceQuote()]),
      responseValidationId: RESPONSE_VALIDATION_IDS[0],
      redactedBody: {},
    }),
    getOrderBook: vi.fn().mockResolvedValue({
      ...neutralRead({
        marketCountry: "KR",
        symbol: "005930",
        currency: "KRW",
        bids: [{ price: "9990", quantity: "10" }],
        asks: [{ price: "10000", quantity: "10" }],
        observedAt: "2026-07-16T10:00:05+09:00",
      }),
      responseValidationId: RESPONSE_VALIDATION_IDS[1],
      redactedBody: {},
    }),
    getCommissionSchedule: vi.fn().mockResolvedValue({
      ...neutralRead({
        accountId: ACCOUNT_ID,
        periods: [
          {
            marketCountry: "KR",
            commissionRatePercent: "0.015",
            startDate: null,
            endDate: null,
          },
        ],
      }),
      responseValidationId: RESPONSE_VALIDATION_IDS[2],
      redactedBody: {},
    }),
    getPriceLimit: vi.fn().mockResolvedValue({
      ...neutralRead({
        marketCountry: "KR",
        symbol: "005930",
        currency: "KRW",
        upperLimitPrice: "13000",
        lowerLimitPrice: "7000",
        observedAt: "2026-07-16T10:00:05+09:00",
      }),
      responseValidationId: RESPONSE_VALIDATION_IDS[1],
      redactedBody: {},
    }),
    getMarketCalendar: vi.fn().mockResolvedValue({
      ...neutralRead(marketCalendar()),
      responseValidationId: RESPONSE_VALIDATION_IDS[2],
      redactedBody: {},
    }),
    getBuyingPowerEvidence: vi.fn().mockResolvedValue({
      ...neutralRead({
        accountId: ACCOUNT_ID,
        currency: "KRW",
        cashBuyingPower: "1000000",
      }),
      responseValidationId: RESPONSE_VALIDATION_IDS[3],
      redactedBody: {},
    }),
    getSellableQuantity: vi.fn(),
    getStocksEvidence: vi.fn().mockResolvedValue({
      ...neutralRead({ result: [stock()] }),
      responseValidationId: RESPONSE_VALIDATION_IDS[4],
      redactedBody: {},
    }),
    getStockWarningsEvidence: vi.fn().mockResolvedValue({
      ...neutralRead({ result: [] }),
      responseValidationId: RESPONSE_VALIDATION_IDS[5],
      redactedBody: {},
    }),
    listOpenOrdersEvidence: vi.fn().mockResolvedValue({
      ...neutralRead([]),
      responseValidationId: RESPONSE_VALIDATION_IDS[6],
      redactedBody: {},
    }),
  };
  const liveOrders = {
    submitOrder: vi.fn<BrokerLiveOrderPort["submitOrder"]>(),
    getOrder: vi.fn<BrokerLiveOrderPort["getOrder"]>(),
    listOpenOrders: vi
      .fn<BrokerLiveOrderPort["listOpenOrders"]>()
      .mockResolvedValue(observedOpenOrders([])),
    cancelOrder: vi.fn<BrokerLiveOrderPort["cancelOrder"]>(),
  };
  return {
    source,
    liveOrders,
    accountReferenceKey: ACCOUNT_REFERENCE_KEY,
    requestAuditContext: {
      run: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => await operation()),
    },
    events,
  };
}

function neutralRead<Value>(value: Value): BrokerReadResult<Value> {
  return {
    value,
    metadata: {
      brokerId: "toss" as BrokerReadResult<Value>["metadata"]["brokerId"],
      operationId: "testOperation",
      requestId: "request-1",
      httpStatus: 200,
      rateLimitGroup: "TEST",
      receivedAt: "2026-07-16T10:00:06+09:00" as BrokerReadResult<Value>["metadata"]["receivedAt"],
      auditReference: "audit-1",
    },
  };
}

function priceQuote() {
  return {
    marketCountry: "KR",
    symbol: "005930",
    currency: "KRW",
    price: "10000",
    observedAt: "2026-07-16T10:00:05+09:00",
  };
}

function marketCalendar() {
  return {
    marketCountry: "KR",
    today: {
      date: "2026-07-16",
      sessions: [
        {
          kind: "REGULAR_MARKET",
          startAt: "2026-07-16T09:00:00+09:00",
          endAt: "2026-07-16T15:30:00+09:00",
          auctionStartAt: "2026-07-16T15:20:00+09:00",
          auctionEndAt: "2026-07-16T15:30:00+09:00",
        },
      ],
    },
    previousBusinessDay: { date: "2026-07-15", sessions: [] },
    nextBusinessDay: { date: "2026-07-17", sessions: [] },
  };
}

function stock() {
  return {
    symbol: "005930",
    market: "KOSPI",
    name: "삼성전자",
    englishName: "Samsung Electronics",
    isinCode: "KR7005930003",
    currency: "KRW",
    securityType: "COMMON_STOCK",
    isCommonShare: true,
    status: "ACTIVE",
    listDate: "1975-06-11",
    delistDate: null,
    sharesOutstanding: "1000000",
    leverageFactor: null,
    koreanMarketDetail: {
      liquidationTrading: false,
      nxtSupported: true,
      krxTradingSuspended: false,
      nxtTradingSuspended: false,
    },
  };
}

function storedOrder(input: {
  id: string;
  logicalOrderId: string;
  planOrderId: string;
  mode: "PAPER" | "LIVE";
  state: StoredOrderReceipt["timeline"][number]["state"];
  brokerOrderId?: string | null;
}): StoredOrderReceipt {
  return {
    id: input.id,
    logicalOrderId: input.logicalOrderId,
    planId: PLAN_ID,
    planOrderId: input.planOrderId,
    mode: input.mode,
    instrumentKey: "KR:005930",
    symbol: "005930",
    side: "BUY",
    quantity: 1n,
    limitPriceMinor: 10_000n,
    plannedGrossMinor: 10_000n,
    reservedGrossMinor: 10_000n,
    clientOrderId: `pr1_${"a".repeat(32)}`,
    createdAt: new Date(),
    timeline: [
      {
        sequence: 0,
        state: input.state,
        brokerStatusRaw: null,
        brokerOrderId: input.brokerOrderId ?? null,
        brokerActionOrderId: null,
        filledQuantity: 0n,
        filledGrossMinor: 0n,
        feeMinor: 0n,
        occurredAt: new Date(),
        detail: { reason: input.state },
      },
    ],
  };
}

function appendState(
  order: StoredOrderReceipt,
  input: {
    state: StoredOrderReceipt["timeline"][number]["state"];
    filledQuantity: bigint;
    filledGrossMinor: bigint;
    feeMinor: bigint;
    detail: unknown;
    brokerOrderId?: string | null;
    brokerActionOrderId?: string | null;
  },
): StoredOrderReceipt {
  return {
    ...order,
    timeline: [
      ...order.timeline,
      {
        sequence: order.timeline.length,
        state: input.state,
        brokerStatusRaw: null,
        brokerOrderId: input.brokerOrderId ?? order.timeline.at(-1)?.brokerOrderId ?? null,
        brokerActionOrderId: input.brokerActionOrderId ?? null,
        filledQuantity: input.filledQuantity,
        filledGrossMinor: input.filledGrossMinor,
        feeMinor: input.feeMinor,
        occurredAt: new Date(),
        detail: input.detail,
      },
    ],
  };
}

function liveContextFrom(
  order: StoredOrderReceipt,
  state: StoredLiveOrderContext["state"],
  brokerOrderId: string | null,
  submissionAuthorizationId: string | null = null,
  dispatch: {
    readonly id: string;
    readonly startedAt: Date;
  } | null = brokerOrderId
    ? {
        id: "50000000-0000-4000-8000-000000000099",
        startedAt: new Date("2026-07-16T09:59:30+09:00"),
      }
    : null,
): StoredLiveOrderContext {
  return {
    orderId: order.id,
    planId: order.planId,
    planVersion: 1,
    planOrderId: order.planOrderId,
    logicalOrderId: order.logicalOrderId,
    accountId: ACCOUNT_ID,
    accountExternalRefHmac: ACCOUNT_HMAC,
    clientOrderId: order.clientOrderId,
    canonicalIntentSha256: "9".repeat(64),
    brokerOrderId,
    submissionAuthorizationId,
    dispatchClaimId: dispatch?.id ?? null,
    dispatchStartedAt: dispatch?.startedAt ?? null,
    reservationId: "30000000-0000-4000-8000-000000000001",
    state,
    stateOccurredAt: new Date(),
    symbol: order.symbol,
    side: order.side,
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: order.quantity,
    limitPriceMinor: order.limitPriceMinor,
    filledQuantity: order.timeline.at(-1)?.filledQuantity ?? 0n,
    filledGrossMinor: order.timeline.at(-1)?.filledGrossMinor ?? 0n,
    feeMinor: order.timeline.at(-1)?.feeMinor ?? 0n,
  };
}

function submitAuditIntent(authorization: LiveOrderSubmitAuthorization) {
  return {
    action: "SUBMIT" as const,
    authorizationId: authorization.authorizationId,
    planId: authorization.planId,
    planOrderId: authorization.planOrderId,
    logicalOrderId: authorization.logicalOrderId,
    accountId: authorization.accountId,
    brokerAccountReference: authorization.brokerAccountReference,
    clientOrderId: authorization.clientOrderId,
    brokerOrderId: null,
    economicTerms: authorization.economicTerms,
    canonicalRequestDigest: authorization.riskDecision.canonicalRequestDigest,
    evidenceReferences: authorization.riskDecision.evidenceReferences,
    authorizedAt: authorization.issuedAt,
  };
}

function cancelAuditIntent(authorization: LiveOrderCancelAuthorization) {
  return {
    action: "CANCEL" as const,
    authorizationId: authorization.authorizationId,
    planId: authorization.planId,
    planOrderId: authorization.planOrderId,
    logicalOrderId: authorization.logicalOrderId,
    accountId: authorization.accountId,
    brokerAccountReference: authorization.brokerAccountReference,
    clientOrderId: authorization.clientOrderId,
    brokerOrderId: authorization.brokerOrderId,
    economicTerms: null,
    canonicalRequestDigest: authorization.riskDecision.canonicalRequestDigest,
    evidenceReferences: authorization.riskDecision.evidenceReferences,
    authorizedAt: authorization.issuedAt,
  };
}

function acknowledgedSubmit(clientOrderId: string): BrokerOrderSubmissionResult {
  return {
    outcome: "ACKNOWLEDGED",
    normalizedState: "PENDING",
    brokerOrderId: BROKER_ORDER_ID,
    clientOrderId,
    reasonCode: "ORDER_REQUEST_ACCEPTED",
    metadata: orderMetadata("createOrder"),
    rawPayload: { result: { orderId: BROKER_ORDER_ID } },
  };
}

function acknowledgedCancel(): BrokerOrderCancellationResult {
  return {
    outcome: "ACKNOWLEDGED",
    primaryState: "PENDING",
    cancelLifecycle: "REQUEST_ACCEPTED",
    brokerOrderId: BROKER_ORDER_ID,
    brokerActionOrderId: BROKER_ACTION_ID,
    reasonCode: "ORDER_CANCEL_REQUEST_ACCEPTED",
    metadata: orderMetadata("cancelOrder"),
    rawPayload: { result: { orderId: BROKER_ACTION_ID } },
  };
}

function observedOrder(
  state: BrokerOrderObservation["primaryState"],
  overrides: Partial<BrokerOrderObservation> = {},
): BrokerOrderReadResult<BrokerOrderObservation> {
  return {
    outcome: "OBSERVED",
    value: {
      brokerOrderId: BROKER_ORDER_ID,
      marketCountry: "KR",
      currency: "KRW",
      symbol: "005930" as BrokerOrderObservation["symbol"],
      side: "BUY",
      orderType: "LIMIT",
      timeInForce: "DAY",
      brokerStatusRaw: state ?? "PENDING",
      primaryState: state,
      cancelLifecycle: state === "CANCELED" ? "REQUEST_ACCEPTED" : "NONE",
      auxiliaryStatus: null,
      mayOverwritePrimary: true,
      quantity: 1n,
      limitPriceMinor: 10_000n,
      filledQuantity: 0n,
      averageFilledPriceMinor: null,
      filledGrossNotionalMinor: 0n,
      feeMinor: 0n,
      taxMinor: 0n,
      orderedAt: "2026-07-16T09:59:00+09:00" as BrokerOrderObservation["orderedAt"],
      canceledAt:
        state === "CANCELED"
          ? ("2026-07-16T10:00:09+09:00" as BrokerOrderObservation["canceledAt"])
          : null,
      filledAt:
        state === "FILLED"
          ? ("2026-07-16T10:00:09+09:00" as BrokerOrderObservation["filledAt"])
          : null,
      ...overrides,
    },
    reasonCode: "ORDER_OBSERVED",
    metadata: orderMetadata("getOrder"),
    rawPayload: { result: { orderId: BROKER_ORDER_ID } },
  };
}

function observedOpenOrders(
  orders: readonly BrokerOrderObservation[],
): BrokerOrderReadResult<readonly BrokerOrderObservation[]> {
  return {
    outcome: "OBSERVED",
    value: orders,
    reasonCode: "ORDER_OBSERVED",
    metadata: orderMetadata("getOrders"),
    rawPayload: { result: { orders: [] } },
  };
}

function unavailableOrder(): BrokerOrderReadResult<BrokerOrderObservation> {
  return {
    outcome: "UNAVAILABLE",
    value: null,
    reasonCode: "BROKER_ORDER_UNAVAILABLE",
    metadata: orderMetadata("getOrder"),
    rawPayload: {},
  };
}

function orderMetadata(operationId: "createOrder" | "getOrder" | "getOrders" | "cancelOrder") {
  return {
    brokerId: "toss" as BrokerOrderSubmissionResult["metadata"]["brokerId"],
    operationId,
    requestId: "request-order-1",
    httpStatus: 200,
    rateLimitGroup: "ORDER",
    receivedAt:
      "2026-07-16T10:00:10+09:00" as BrokerOrderSubmissionResult["metadata"]["receivedAt"],
    dispatchStage: "BROKER_RESPONSE" as const,
    upstreamOperationId: operationId,
    auditReference: "dispatch-claim",
    transportAuditReference: "transport-audit",
  };
}

function mutableContext(context: StoredExecutionContext) {
  return context as {
    operationalConfig: StoredExecutionContext["operationalConfig"];
    promotion: StoredExecutionContext["promotion"];
    killSwitch: StoredExecutionContext["killSwitch"];
  };
}
