import { describe, expect, it } from "vitest";

import {
  evaluateExecutionRiskGate,
  type ExecutionRiskGateInput,
} from "./execution-risk-gate";

const accountHmac = "a".repeat(64);
const approvalDigest = "b".repeat(64);
const now = new Date("2026-07-16T01:00:00.000Z");

const config = {
  schemaVersion: "OPERATIONAL_CONFIG_V1",
  mode: "PAPER",
  killSwitch: false,
  freshness: {
    quote: { planMaxAgeSeconds: 120, preSubmitMaxAgeSeconds: 10, futureToleranceSeconds: 10 },
    calendar: { maxAgeSeconds: 86_400, futureToleranceSeconds: 10 },
  },
  limits: {
    minimumOrderGrossMinor: "1000",
    feeBufferMinor: "100",
    maxSingleOrderGrossMinor: "100000",
    maxDailyGrossMinor: "300000",
    maxDailyTurnoverBasisPoints: 1_000,
    maxAbsolutePriceChangeBasisPoints: 500,
    maxInstrumentWeightBasisPoints: 8_000,
    maxAssetClassWeightBasisPoints: 8_000,
    maxRiskyWeightBasisPoints: 8_000,
  },
  live: {
    enabled: false,
    marketCountry: "KR",
    allowedSession: "REGULAR_MARKET",
    orderType: "LIMIT",
    timeInForce: "DAY",
    accountAllowlistHmacs: [],
    manualApprovalRequired: true,
    approvalTtlSeconds: 300,
    maxSingleOrderGrossMinor: "50000",
    maxDailyGrossMinor: "100000",
    tinyLiveMaxGrossMinor: "10000",
  },
} as const;

const baseInput: ExecutionRiskGateInput = {
  operationalConfig: { status: "VALID", value: config },
  requestedMode: "PAPER",
  now,
  accountExternalRefHmac: accountHmac,
  plan: {
    planId: "plan-1",
    planHash: "plan-hash-1",
    mode: "PAPER",
    snapshotId: "snapshot-1",
    snapshotDigest: "snapshot-digest-1",
    targetConfigVersionId: "config-1",
    targetConfigContentHash: "config-hash-1",
    orders: [
      {
        logicalOrderId: "order-1",
        grossNotionalMinor: 10_000n,
        marketCountry: "KR",
        orderType: "LIMIT",
        timeInForce: "DAY",
      },
    ],
  },
  currentIdentity: {
    snapshotId: "snapshot-1",
    snapshotDigest: "snapshot-digest-1",
    targetConfigVersionId: "config-1",
    targetConfigContentHash: "config-hash-1",
  },
  existingOrders: [],
  tradeDayFilledGrossMinor: 0n,
  reservedPendingGrossMinor: 0n,
  baselinePortfolioValueMinor: 1_000_000n,
  projectedExposure: {
    portfolioValueMinor: 1_000_000n,
    instruments: [{ key: "KR:0167A0", valueMinor: 700_000n }],
    assetClasses: [
      { key: "CORE", valueMinor: 700_000n },
      { key: "CASH", valueMinor: 300_000n },
    ],
    riskyAssetValueMinor: 700_000n,
  },
  manualApproval: null,
};

describe("evaluateExecutionRiskGate", () => {
  it("모든 공통 검사를 통과한 Paper 계획만 실행 가능하게 한다", () => {
    expect(evaluateExecutionRiskGate(baseInput)).toMatchObject({
      status: "READY",
      canExecute: true,
    });
  });

  it("킬 스위치는 Paper 실행도 차단한다", () => {
    const result = evaluateExecutionRiskGate({
      ...baseInput,
      operationalConfig: {
        status: "VALID",
        value: { ...config, killSwitch: true },
      },
    });
    expect(result).toMatchObject({ status: "BLOCKED", canExecute: false });
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "KILL_SWITCH_ACTIVE", outcome: "BLOCKED" }),
    );
  });

  it("오래된 계획과 미해결 주문을 각각 차단한다", () => {
    const result = evaluateExecutionRiskGate({
      ...baseInput,
      currentIdentity: { ...baseInput.currentIdentity, snapshotId: "snapshot-2" },
      existingOrders: [{ logicalOrderId: "old-order", state: "UNKNOWN_BLOCKED" }],
    });
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PLAN_IDENTITY_STALE", outcome: "BLOCKED" }),
        expect.objectContaining({ code: "UNRESOLVED_ORDER_EXISTS", outcome: "BLOCKED" }),
      ]),
    );
  });

  it("주문이 없거나 최소 주문금액보다 작으면 실행하지 않는다", () => {
    const empty = evaluateExecutionRiskGate({
      ...baseInput,
      plan: { ...baseInput.plan, orders: [] },
    });
    expect(empty.checks).toContainEqual(
      expect.objectContaining({
        code: "PLAN_HAS_NO_EXECUTABLE_ORDERS",
        outcome: "BLOCKED",
      }),
    );

    const belowMinimum = evaluateExecutionRiskGate({
      ...baseInput,
      plan: {
        ...baseInput.plan,
        orders: [{ ...baseInput.plan.orders[0]!, grossNotionalMinor: 999n }],
      },
    });
    expect(belowMinimum.checks).toContainEqual(
      expect.objectContaining({ code: "ORDER_BELOW_MINIMUM_GROSS", outcome: "BLOCKED" }),
    );
  });

  it("운영 설정을 해석할 수 없으면 다른 계산 없이 fail closed 한다", () => {
    expect(
      evaluateExecutionRiskGate({
        ...baseInput,
        operationalConfig: { status: "INVALID" },
      }),
    ).toEqual({
      status: "BLOCKED",
      canExecute: false,
      checks: [
        {
          code: "OPERATIONAL_CONFIG_INVALID",
          outcome: "BLOCKED",
          message: "운영 설정을 검증할 수 없어 주문 실행을 차단합니다.",
          subjectKey: null,
        },
      ],
    });
  });

  it("Live는 별도 활성화·계좌·주문 형태·수동 승인을 모두 요구한다", () => {
    const liveConfig = {
      ...config,
      mode: "LIVE",
      live: {
        ...config.live,
        enabled: true,
        accountAllowlistHmacs: [accountHmac],
      },
    } as const;
    const liveInput: ExecutionRiskGateInput = {
      ...baseInput,
      operationalConfig: { status: "VALID", value: liveConfig },
      requestedMode: "LIVE",
      plan: { ...baseInput.plan, mode: "LIVE" },
      manualApproval: {
        approvalId: "approval-1",
        approvalDigest,
        expectedApprovalDigest: approvalDigest,
        approvedPlanHash: baseInput.plan.planHash,
        approvedAccountHmac: accountHmac,
        approvedAt: new Date("2026-07-16T00:59:00.000Z"),
        consumedAt: null,
      },
    };
    expect(evaluateExecutionRiskGate(liveInput)).toMatchObject({
      status: "READY",
      canExecute: true,
    });

    const blocked = evaluateExecutionRiskGate({
      ...liveInput,
      plan: {
        ...liveInput.plan,
        orders: [
          {
            ...liveInput.plan.orders[0]!,
            marketCountry: "US",
            orderType: "MARKET",
          },
        ],
      },
      manualApproval: null,
    });
    expect(blocked.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LIVE_ORDER_SHAPE_BLOCKED", outcome: "BLOCKED" }),
        expect.objectContaining({ code: "LIVE_MANUAL_APPROVAL_MISSING", outcome: "BLOCKED" }),
      ]),
    );
  });

  it("소비·만료·해시 불일치 승인과 극소액 한도 초과를 차단한다", () => {
    const liveConfig = {
      ...config,
      mode: "LIVE",
      live: {
        ...config.live,
        enabled: true,
        accountAllowlistHmacs: [accountHmac],
      },
    } as const;
    const result = evaluateExecutionRiskGate({
      ...baseInput,
      operationalConfig: { status: "VALID", value: liveConfig },
      requestedMode: "LIVE",
      plan: {
        ...baseInput.plan,
        mode: "LIVE",
        orders: [
          {
            ...baseInput.plan.orders[0]!,
            grossNotionalMinor: 10_001n,
          },
        ],
      },
      manualApproval: {
        approvalId: "approval-1",
        approvalDigest,
        expectedApprovalDigest: "c".repeat(64),
        approvedPlanHash: baseInput.plan.planHash,
        approvedAccountHmac: accountHmac,
        approvedAt: new Date("2026-07-16T00:40:00.000Z"),
        consumedAt: new Date("2026-07-16T00:41:00.000Z"),
      },
    });
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TINY_LIVE_GROSS_LIMIT_EXCEEDED", outcome: "BLOCKED" }),
        expect.objectContaining({ code: "LIVE_MANUAL_APPROVAL_INVALID", outcome: "BLOCKED" }),
      ]),
    );
  });
});
