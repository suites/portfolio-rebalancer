import { describe, expect, it } from "vitest";

import {
  CreateLivePlanApprovalInputSchema,
  ExecuteRebalancePlanInputSchema,
  KillSwitchCommandSchema,
  RecoverUnknownOrderInputSchema,
} from "./orders";

const planId = "20000000-0000-4000-8000-000000000001";
const approvalId = "20000000-0000-4000-8000-000000000002";
const orderId = "20000000-0000-4000-8000-000000000003";

describe("order operation contracts", () => {
  it("Paper는 승인 없이, Live는 중복 없는 주문별 승인이 있을 때만 받는다", () => {
    expect(
      ExecuteRebalancePlanInputSchema.safeParse({
        planId,
        mode: "PAPER",
        approvalIds: [],
      }).success,
    ).toBe(true);
    expect(
      ExecuteRebalancePlanInputSchema.safeParse({
        planId,
        mode: "LIVE",
        approvalIds: [approvalId],
      }).success,
    ).toBe(true);
    expect(
      ExecuteRebalancePlanInputSchema.safeParse({
        planId,
        mode: "LIVE",
        approvalIds: [],
      }).success,
    ).toBe(false);
    expect(
      ExecuteRebalancePlanInputSchema.safeParse({
        planId,
        mode: "LIVE",
        approvalIds: [approvalId, approvalId],
      }).success,
    ).toBe(false);
  });

  it("Live 승인은 화면에 표시한 계획 해시와 고정 확인 문구를 요구한다", () => {
    expect(
      CreateLivePlanApprovalInputSchema.safeParse({
        planId,
        planHash: "a".repeat(64),
        confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
      }).success,
    ).toBe(true);
    expect(
      CreateLivePlanApprovalInputSchema.safeParse({
        planId,
        planHash: "a".repeat(64),
        confirmation: "확인",
      }).success,
    ).toBe(false);
  });

  it("킬 스위치 해제는 상태에 맞는 명시적 확인 문구를 요구한다", () => {
    expect(
      KillSwitchCommandSchema.safeParse({
        state: "DISENGAGED",
        reason: "검증된 Paper 결과를 바탕으로 수동 해제",
        confirmation: "킬 스위치 해제",
      }).success,
    ).toBe(true);
    expect(
      KillSwitchCommandSchema.safeParse({
        state: "DISENGAGED",
        reason: "검증된 Paper 결과를 바탕으로 수동 해제",
        confirmation: "킬 스위치 작동",
      }).success,
    ).toBe(false);
  });

  it("UNKNOWN_BLOCKED 복구는 브로커 증거와 누적 체결값을 요구한다", () => {
    expect(
      RecoverUnknownOrderInputSchema.safeParse({
        orderId,
        resolvedState: "FILLED",
        brokerEvidenceReference: "request-audit-1",
        brokerOrderId: "broker-order-1",
        filledQuantity: "1",
        filledGrossMinor: "10000",
        feeMinor: "10",
      }).success,
    ).toBe(true);
    expect(
      RecoverUnknownOrderInputSchema.safeParse({
        orderId,
        resolvedState: "FILLED",
        brokerEvidenceReference: "",
        brokerOrderId: "broker-order-1",
        filledQuantity: "1",
        filledGrossMinor: "10000",
        feeMinor: "10",
      }).success,
    ).toBe(false);
  });
});
