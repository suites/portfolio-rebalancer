import { beforeEach, describe, expect, it, vi } from "vitest";

const engineMocks = vi.hoisted(() => ({
  activateEngineOperationalDraft: vi.fn(),
  cancelEngineOrder: vi.fn(),
  createEngineRebalancePlan: vi.fn(),
  createEngineLivePlanApproval: vi.fn(),
  createEngineShadowPlan: vi.fn(),
  createEngineTargetDraft: vi.fn(),
  executeEngineRebalancePlan: vi.fn(),
  reconcileEngineOrder: vi.fn(),
  recoverEngineUnknownOrder: vi.fn(),
  saveEngineCurrentAccountOperationalDraft: vi.fn(),
  saveEngineLivePromotion: vi.fn(),
  searchEngineInstrumentCatalog: vi.fn(),
  setEngineKillSwitch: vi.fn(),
  validateEngineInstrument: vi.fn(),
}));
const operator = {
  operatorId: "fred",
  sessionId: "10000000-0000-4000-8000-000000000099",
  authenticatedAt: "2026-07-16T03:00:00.000Z",
  reauthenticatedAt: "2026-07-16T03:59:00.000Z",
};
const authMocks = vi.hoisted(() => ({
  requireOperatorMutation: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/server/engine-dashboard", () => ({ refreshEngineDashboard: vi.fn() }));
vi.mock("@/server/operator-auth", () => ({
  requireOperatorMutation: authMocks.requireOperatorMutation,
  OperatorAuthError: class OperatorAuthError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));
vi.mock("@/server/engine-console", () => ({
  activateEngineTargetDraft: vi.fn(),
  activateEngineOperationalDraft: engineMocks.activateEngineOperationalDraft,
  cancelEngineOrder: engineMocks.cancelEngineOrder,
  createEngineRebalancePlan: engineMocks.createEngineRebalancePlan,
  createEngineLivePlanApproval: engineMocks.createEngineLivePlanApproval,
  createEngineShadowPlan: engineMocks.createEngineShadowPlan,
  createEngineTargetDraft: engineMocks.createEngineTargetDraft,
  executeEngineRebalancePlan: engineMocks.executeEngineRebalancePlan,
  reconcileEngineOrder: engineMocks.reconcileEngineOrder,
  recoverEngineUnknownOrder: engineMocks.recoverEngineUnknownOrder,
  saveEngineCurrentAccountOperationalDraft: engineMocks.saveEngineCurrentAccountOperationalDraft,
  saveEngineLivePromotion: engineMocks.saveEngineLivePromotion,
  searchEngineInstrumentCatalog: engineMocks.searchEngineInstrumentCatalog,
  setEngineKillSwitch: engineMocks.setEngineKillSwitch,
  validateEngineInstrument: engineMocks.validateEngineInstrument,
  EngineConsoleRequestError: class EngineConsoleRequestError extends Error {
    constructor(
      readonly status: number,
      readonly code: string | null,
    ) {
      super("ENGINE_REQUEST_FAILED");
    }
  },
}));

import {
  activateOperationalConfigDraftAction,
  cancelOrderAction,
  createRebalancePlanAction,
  createShadowPlanAction,
  executeLivePlanAction,
  executePaperPlanAction,
  saveTargetDraftAction,
  saveOperationalConfigDraftAction,
  searchTargetInstrumentAction,
  setKillSwitchAction,
  setLivePromotionAction,
  type SaveTargetDraftActionState,
  type SearchTargetInstrumentActionState,
} from "./actions";

const initialState: SearchTargetInstrumentActionState = {
  status: "idle",
  query: "",
  mode: null,
  catalogScope: null,
  candidates: [],
  message: null,
};
const initialSaveState: SaveTargetDraftActionState = {
  status: "idle",
  message: null,
};

describe("settings server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMocks.requireOperatorMutation.mockResolvedValue(operator);
  });

  it("같은 영문 입력도 사용자가 선택한 로컬 이름 검색 intent를 따른다", async () => {
    engineMocks.searchEngineInstrumentCatalog.mockResolvedValue({
      query: "Apple",
      catalogScope: "LOCAL_VALIDATED",
      candidates: [],
    });
    const formData = new FormData();
    formData.set("instrumentQuery", "Apple");
    formData.set("lookupMode", "CATALOG");

    const result = await searchTargetInstrumentAction(initialState, formData);

    expect(engineMocks.searchEngineInstrumentCatalog).toHaveBeenCalledWith("Apple");
    expect(engineMocks.validateEngineInstrument).not.toHaveBeenCalled();
    expect(result.mode).toBe("CATALOG");
  });

  it("사용자가 정확 검증을 선택한 미국 티커만 검증 endpoint로 보낸다", async () => {
    engineMocks.validateEngineInstrument.mockResolvedValue({
      candidate: {
        validationId: "019d1b9f-56ce-7e1b-a4ba-a6f607eb3333",
        instrumentKey: "US:AAPL",
        symbol: "AAPL",
        name: "Apple",
        englishName: "Apple Inc.",
        marketCountry: "US",
        listingMarket: "NASDAQ",
        currency: "USD",
        securityType: "FOREIGN_STOCK",
        listingStatus: "ACTIVE",
        source: "TOSS_EXACT",
        targetEligibility: "ELIGIBLE",
        targetReasonCodes: [],
        addEligible: true,
        blockedReason: null,
        tradeBlockedNow: false,
        tradeReasonCodes: [],
        tradeBlockedReason: null,
        requiresOrderRevalidation: true,
        verifiedAt: "2026-07-16T03:00:00.000Z",
      },
    });
    const formData = new FormData();
    formData.set("instrumentQuery", "AAPL");
    formData.set("lookupMode", "EXACT");

    const result = await searchTargetInstrumentAction(initialState, formData);

    expect(engineMocks.validateEngineInstrument).toHaveBeenCalledWith("AAPL");
    expect(engineMocks.searchEngineInstrumentCatalog).not.toHaveBeenCalled();
    expect(result.mode).toBe("VALIDATED");
  });

  it("정확 검증 형식이 아닌 입력은 broker 호출 전에 거부한다", async () => {
    const formData = new FormData();
    formData.set("instrumentQuery", "삼성전자");
    formData.set("lookupMode", "EXACT");

    const result = await searchTargetInstrumentAction(initialState, formData);

    expect(result.status).toBe("error");
    expect(result.message).toContain("정확 검증");
    expect(engineMocks.validateEngineInstrument).not.toHaveBeenCalled();
    expect(engineMocks.searchEngineInstrumentCatalog).not.toHaveBeenCalled();
  });

  it("초안 저장 실패는 redirect하지 않고 편집기가 표시할 오류 상태를 반환한다", async () => {
    engineMocks.createEngineTargetDraft.mockRejectedValue(new Error("engine unavailable"));
    const formData = targetDraftFormData();

    const result = await saveTargetDraftAction(initialSaveState, formData);

    expect(result.status).toBe("error");
    expect(result.message).toContain("입력값은 유지");
    expect(engineMocks.createEngineTargetDraft).toHaveBeenCalledOnce();
  });

  it("Shadow 계획 생성 성공은 리밸런싱 화면으로 돌아간다", async () => {
    engineMocks.createEngineShadowPlan.mockResolvedValue({
      state: "NO_PLAN",
      latest: null,
    });

    await expect(createShadowPlanAction(new FormData())).rejects.toThrow("REDIRECT");

    expect(engineMocks.createEngineShadowPlan).toHaveBeenCalledOnce();
  });

  it("Paper와 Live 계획은 선택한 모드를 엔진에 그대로 전달한다", async () => {
    engineMocks.createEngineRebalancePlan.mockResolvedValue({
      state: "NO_PLAN",
      latest: null,
    });

    for (const mode of ["PAPER", "LIVE"] as const) {
      const formData = new FormData();
      formData.set("mode", mode);
      await expect(createRebalancePlanAction(formData)).rejects.toThrow("REDIRECT");
      expect(engineMocks.createEngineRebalancePlan).toHaveBeenCalledWith(mode);
    }
  });

  it("Paper 실행은 승인 없이 주문 실행 endpoint를 한 번 호출한다", async () => {
    engineMocks.executeEngineRebalancePlan.mockResolvedValue({
      planId: "10000000-0000-4000-8000-000000000001",
      mode: "PAPER",
      outcome: "PENDING",
      orderIds: [],
      message: "Paper",
    });
    const formData = new FormData();
    formData.set("planId", "10000000-0000-4000-8000-000000000001");

    await expect(executePaperPlanAction(formData)).rejects.toThrow("REDIRECT");

    expect(engineMocks.executeEngineRebalancePlan).toHaveBeenCalledWith(
      {
        planId: "10000000-0000-4000-8000-000000000001",
        mode: "PAPER",
        approvalIds: [],
      },
      operator,
    );
    expect(engineMocks.createEngineLivePlanApproval).not.toHaveBeenCalled();
  });

  it("Live 최종 확인은 주문별 승인을 만든 뒤 같은 승인 ID로 한 번만 실행한다", async () => {
    engineMocks.createEngineLivePlanApproval.mockResolvedValue({
      planId: "10000000-0000-4000-8000-000000000001",
      planHash: "a".repeat(64),
      approvals: [
        {
          approvalId: "10000000-0000-4000-8000-000000000002",
          planOrderId: "10000000-0000-4000-8000-000000000003",
          planHash: "a".repeat(64),
          expiresAt: "2026-07-16T04:00:00+09:00",
        },
      ],
    });
    engineMocks.executeEngineRebalancePlan.mockResolvedValue({
      planId: "10000000-0000-4000-8000-000000000001",
      mode: "LIVE",
      outcome: "PENDING",
      orderIds: ["10000000-0000-4000-8000-000000000004"],
      message: "Live",
    });
    const formData = new FormData();
    formData.set("planId", "10000000-0000-4000-8000-000000000001");
    formData.set("planHash", "a".repeat(64));
    formData.set("confirmation", "LIVE 주문 계획과 금액을 확인했습니다");

    await expect(executeLivePlanAction(formData)).rejects.toThrow("REDIRECT");

    expect(engineMocks.createEngineLivePlanApproval).toHaveBeenCalledWith(
      {
        planId: "10000000-0000-4000-8000-000000000001",
        planHash: "a".repeat(64),
        confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
      },
      operator,
    );
    expect(engineMocks.executeEngineRebalancePlan).toHaveBeenCalledWith(
      {
        planId: "10000000-0000-4000-8000-000000000001",
        mode: "LIVE",
        approvalIds: ["10000000-0000-4000-8000-000000000002"],
      },
      operator,
    );
    expect(authMocks.requireOperatorMutation).toHaveBeenCalledWith(formData, {
      recentReauthentication: true,
    });
  });

  it("execute HTTP 200도 receipt outcome이 BLOCKED면 성공으로 표시하지 않는다", async () => {
    engineMocks.executeEngineRebalancePlan.mockResolvedValue({
      planId: "10000000-0000-4000-8000-000000000001",
      mode: "PAPER",
      outcome: "BLOCKED",
      orderIds: [],
      message: "blocked",
    });
    const formData = new FormData();
    formData.set("planId", "10000000-0000-4000-8000-000000000001");

    await expect(executePaperPlanAction(formData)).rejects.toThrow("REDIRECT");

    expect(navigationMocks.redirect).toHaveBeenLastCalledWith(
      "/rebalancing?status=paper-execution-blocked",
    );
  });

  it("cancel HTTP 200도 UNKNOWN outcome이면 취소 성공으로 표시하지 않는다", async () => {
    engineMocks.cancelEngineOrder.mockResolvedValue({
      orderId: "10000000-0000-4000-8000-000000000001",
      outcome: "UNKNOWN",
      currentState: "UNKNOWN",
      brokerActionOrderId: null,
      message: "broker result unknown",
    });
    const formData = new FormData();
    formData.set("orderId", "10000000-0000-4000-8000-000000000001");
    formData.set("reason", "현재 미체결 주문을 중단합니다.");
    formData.set("confirmation", "미체결 주문 취소를 요청합니다");

    await expect(cancelOrderAction(formData)).rejects.toThrow("REDIRECT");

    expect(engineMocks.cancelEngineOrder).toHaveBeenCalledWith(
      {
        orderId: "10000000-0000-4000-8000-000000000001",
        reason: "현재 미체결 주문을 중단합니다.",
        confirmation: "미체결 주문 취소를 요청합니다",
      },
      operator,
    );
    expect(authMocks.requireOperatorMutation).toHaveBeenCalledWith(formData, {
      recentReauthentication: true,
    });
    expect(navigationMocks.redirect).toHaveBeenLastCalledWith("/orders?status=cancel-unknown");
  });

  it("킬 스위치 해제와 Live 승격만 최근 재인증을 추가 요구한다", async () => {
    engineMocks.setEngineKillSwitch.mockImplementation(({ state }: { state: string }) =>
      Promise.resolve({ killSwitch: state }),
    );
    engineMocks.saveEngineLivePromotion.mockImplementation(({ state }: { state: string }) =>
      Promise.resolve({ livePromotion: state }),
    );

    for (const state of ["ENGAGED", "DISENGAGED"] as const) {
      const formData = new FormData();
      formData.set("state", state);
      formData.set("reason", "안전 상태를 다시 확인했습니다.");
      await expect(setKillSwitchAction(formData)).rejects.toThrow("REDIRECT");
      expect(authMocks.requireOperatorMutation).toHaveBeenLastCalledWith(formData, {
        recentReauthentication: state === "DISENGAGED",
      });
    }

    for (const state of ["REVOKED", "GRANTED"] as const) {
      const formData = new FormData();
      formData.set("state", state);
      formData.set("reason", "안전 상태를 다시 확인했습니다.");
      await expect(setLivePromotionAction(formData)).rejects.toThrow("REDIRECT");
      expect(authMocks.requireOperatorMutation).toHaveBeenLastCalledWith(formData, {
        recentReauthentication: state === "GRANTED",
      });
    }
  });

  it("운영 설정 UI는 계좌번호나 HMAC 없이 현재 계좌 scope만 엔진에 전달한다", async () => {
    engineMocks.saveEngineCurrentAccountOperationalDraft.mockResolvedValue({});
    const formData = operationalConfigFormData();

    await expect(saveOperationalConfigDraftAction(formData)).rejects.toThrow("REDIRECT");

    const submitted: unknown =
      engineMocks.saveEngineCurrentAccountOperationalDraft.mock.calls[0]?.[0];
    const serialized = JSON.stringify(submitted);
    expect(serialized).toContain('"mode":"LIVE"');
    expect(serialized).toContain('"enabled":true');
    expect(serialized).toContain('"accountAllowlistHmacs":[]');
    expect(serialized).toContain('"manualApprovalRequired":true');
    expect(serialized).not.toMatch(/[a-f0-9]{64}/);
  });

  it("운영 설정 적용은 화면에 표시된 해시와 정확한 확인 문구를 함께 요구한다", async () => {
    engineMocks.activateEngineOperationalDraft.mockResolvedValue({});
    const invalid = new FormData();
    invalid.set("version", "2");
    invalid.set("contentHash", "a".repeat(64));
    invalid.set("confirmation", "적용");

    await expect(activateOperationalConfigDraftAction(invalid)).rejects.toThrow("REDIRECT");
    expect(engineMocks.activateEngineOperationalDraft).not.toHaveBeenCalled();

    const valid = new FormData();
    valid.set("version", "2");
    valid.set("contentHash", "a".repeat(64));
    valid.set("confirmation", "운영 설정을 적용합니다");

    await expect(activateOperationalConfigDraftAction(valid)).rejects.toThrow("REDIRECT");
    expect(engineMocks.activateEngineOperationalDraft).toHaveBeenCalledExactlyOnceWith({
      version: 2,
      contentHash: "a".repeat(64),
      confirmation: "운영 설정을 적용합니다",
    });
  });
});

function targetDraftFormData(): FormData {
  const formData = new FormData();
  formData.set("cashMode", "EXCLUDED");
  for (const [assetKey, targetPercent] of [
    ["SAFE", "0"],
    ["CORE", "0"],
    ["SATELLITE", "100"],
    ["CASH", "0"],
  ] as const) {
    formData.append("assetKey", assetKey);
    formData.append("targetPercent", targetPercent);
    formData.append("compositionMode", "PRESERVE_CURRENT");
  }
  formData.append("instrumentKey", "US:AAPL");
  formData.append("instrumentClass", "SATELLITE");
  return formData;
}

function operationalConfigFormData(): FormData {
  const formData = new FormData();
  formData.set("mode", "LIVE");
  formData.set("liveEnabled", "on");
  formData.set("minimumOrderWon", "10000");
  formData.set("feeBufferWon", "1000");
  formData.set("maxSingleOrderWon", "100000");
  formData.set("maxDailyGrossWon", "300000");
  formData.set("approvalTtlSeconds", "300");
  formData.set("liveMaxSingleOrderWon", "50000");
  formData.set("liveMaxDailyGrossWon", "150000");
  formData.set("tinyLiveMaxWon", "50000");
  return formData;
}
