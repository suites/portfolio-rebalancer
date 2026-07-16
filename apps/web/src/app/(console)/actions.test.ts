import { beforeEach, describe, expect, it, vi } from "vitest";

const engineMocks = vi.hoisted(() => ({
  createEngineRebalancePlan: vi.fn(),
  createEngineShadowPlan: vi.fn(),
  createEngineTargetDraft: vi.fn(),
  searchEngineInstrumentCatalog: vi.fn(),
  validateEngineInstrument: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("@/server/engine-dashboard", () => ({ refreshEngineDashboard: vi.fn() }));
vi.mock("@/server/engine-console", () => ({
  activateEngineTargetDraft: vi.fn(),
  createEngineRebalancePlan: engineMocks.createEngineRebalancePlan,
  createEngineShadowPlan: engineMocks.createEngineShadowPlan,
  createEngineTargetDraft: engineMocks.createEngineTargetDraft,
  searchEngineInstrumentCatalog: engineMocks.searchEngineInstrumentCatalog,
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
  createRebalancePlanAction,
  createShadowPlanAction,
  saveTargetDraftAction,
  searchTargetInstrumentAction,
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
      liveOrdersEnabled: false,
    });

    await expect(createShadowPlanAction()).rejects.toThrow("REDIRECT");

    expect(engineMocks.createEngineShadowPlan).toHaveBeenCalledOnce();
  });

  it("Paper와 Live 계획은 선택한 모드를 엔진에 그대로 전달한다", async () => {
    engineMocks.createEngineRebalancePlan.mockResolvedValue({
      state: "NO_PLAN",
      latest: null,
      liveOrdersEnabled: false,
    });

    for (const mode of ["PAPER", "LIVE"] as const) {
      const formData = new FormData();
      formData.set("mode", mode);
      await expect(createRebalancePlanAction(formData)).rejects.toThrow("REDIRECT");
      expect(engineMocks.createEngineRebalancePlan).toHaveBeenCalledWith(mode);
    }
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
