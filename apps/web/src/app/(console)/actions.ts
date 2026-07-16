"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  InstrumentCandidateContract,
  TargetSettingsDraftInputContract,
} from "@portfolio-rebalancer/contracts";

import {
  activateEngineTargetDraft,
  createEngineRebalancePlan,
  createEngineShadowPlan,
  createEngineTargetDraft,
  EngineConsoleRequestError,
  searchEngineInstrumentCatalog,
  validateEngineInstrument,
} from "@/server/engine-console";
import { refreshEngineDashboard } from "@/server/engine-dashboard";
import { targetSettingsInputFromFormData } from "@/server/target-settings-input";

export async function refreshPortfolioAction() {
  await refreshEngineDashboard();
  revalidatePath("/", "layout");
  redirect("/troubleshooting");
}

export async function createShadowPlanAction() {
  return createRebalancePlan("SHADOW");
}

export async function createRebalancePlanAction(formData: FormData) {
  const mode = formData.get("mode");
  if (mode !== "SHADOW" && mode !== "PAPER" && mode !== "LIVE") {
    redirect("/rebalancing?status=plan-mode-invalid");
  }
  return createRebalancePlan(mode);
}

async function createRebalancePlan(mode: "SHADOW" | "PAPER" | "LIVE") {
  let status: string | null = null;
  try {
    if (mode === "SHADOW") {
      await createEngineShadowPlan();
    } else {
      await createEngineRebalancePlan(mode);
    }
  } catch (error) {
    status =
      error instanceof EngineConsoleRequestError
        ? shadowPlanErrorStatus(error.code)
        : "plan-unavailable";
  }
  revalidatePath("/rebalancing");
  redirect(status === null ? "/rebalancing" : `/rebalancing?status=${status}`);
}

export type SaveTargetDraftActionState = {
  readonly status: "idle" | "error";
  readonly message: string | null;
};

export type SearchTargetInstrumentActionState = {
  readonly status: "idle" | "success" | "error";
  readonly query: string;
  readonly mode: "CATALOG" | "VALIDATED" | null;
  readonly catalogScope: "LOCAL_VALIDATED" | null;
  readonly candidates: readonly InstrumentCandidateContract[];
  readonly message: string | null;
};

export async function saveTargetDraftAction(
  _previousState: SaveTargetDraftActionState,
  formData: FormData,
): Promise<SaveTargetDraftActionState> {
  let input: TargetSettingsDraftInputContract;
  try {
    input = targetSettingsInputFromFormData(formData);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "목표 합계와 종목별 자산군을 다시 확인하세요.",
    };
  }

  try {
    await createEngineTargetDraft(input);
  } catch (error) {
    return {
      status: "error",
      message: targetDraftErrorMessage(error),
    };
  }
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function searchTargetInstrumentAction(
  _previousState: SearchTargetInstrumentActionState,
  formData: FormData,
): Promise<SearchTargetInstrumentActionState> {
  const rawQuery = formData.get("instrumentQuery");
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const lookupMode = formData.get("lookupMode");
  if (query.length === 0) {
    return {
      status: "error",
      query,
      mode: null,
      catalogScope: null,
      candidates: [],
      message: "종목명, 국내 6자리 종목코드 또는 미국 티커를 입력하세요.",
    };
  }
  if (lookupMode !== "CATALOG" && lookupMode !== "EXACT") {
    return {
      status: "error",
      query,
      mode: null,
      catalogScope: null,
      candidates: [],
      message: "로컬 이름 검색 또는 코드·티커 정확 검증 중 하나를 선택하세요.",
    };
  }

  try {
    if (lookupMode === "EXACT") {
      if (!isExactInstrumentQuery(query)) {
        return {
          status: "error",
          query,
          mode: null,
          catalogScope: null,
          candidates: [],
          message:
            "정확 검증은 국내 6자리 종목코드, 미국 티커 또는 KR:/US: 접두 형식만 사용할 수 있습니다.",
        };
      }
      const result = await validateEngineInstrument(query);
      return {
        status: "success",
        query,
        mode: "VALIDATED",
        catalogScope: null,
        candidates: [result.candidate],
        message: "토스증권 서버 응답으로 종목을 다시 검증했습니다.",
      };
    }
    const result = await searchEngineInstrumentCatalog(query);
    return {
      status: "success",
      query: result.query,
      mode: "CATALOG",
      catalogScope: result.catalogScope,
      candidates: result.candidates,
      message:
        result.candidates.length === 0
          ? "서버에서 이전에 검증한 종목 카탈로그에 일치하는 결과가 없습니다."
          : "서버에서 이전에 검증한 종목 카탈로그 결과입니다.",
    };
  } catch (error) {
    return {
      status: "error",
      query,
      mode: null,
      catalogScope: null,
      candidates: [],
      message: instrumentSearchErrorMessage(error),
    };
  }
}

export async function activateTargetDraftAction(formData: FormData) {
  let status: string | null = "activate-invalid";
  const rawVersion = formData.get("version");
  if (typeof rawVersion === "string" && /^\d+$/.test(rawVersion)) {
    try {
      await activateEngineTargetDraft(Number(rawVersion));
      status = null;
    } catch (error) {
      status =
        error instanceof EngineConsoleRequestError
          ? error.code === "DRAFT_STALE"
            ? "draft-stale"
            : error.status === 400
              ? "activate-invalid"
              : "unavailable"
          : "unavailable";
    }
  }
  revalidatePath("/", "layout");
  redirect(status === null ? "/settings" : `/settings?status=${status}`);
}

function isExactInstrumentQuery(query: string): boolean {
  const qualified = /^(KR|US):(.+)$/i.exec(query);
  if (qualified) {
    const marketCountry = qualified[1]?.toUpperCase();
    const symbol = qualified[2] ?? "";
    return marketCountry === "KR"
      ? /^\d{6}$/.test(symbol)
      : /^[A-Za-z][A-Za-z0-9.-]{0,19}$/.test(symbol);
  }
  return /^\d{6}$/.test(query) || /^[A-Za-z][A-Za-z0-9.-]{0,19}$/.test(query);
}

function targetDraftErrorMessage(error: unknown): string {
  if (!(error instanceof EngineConsoleRequestError)) {
    return "설정 서버에 연결할 수 없습니다. 입력값은 유지되었으니 잠시 후 다시 시도하세요.";
  }
  if (error.code === "DRAFT_STALE") {
    return "계좌 정보가 바뀌었습니다. 최신 계좌 정보를 확인한 뒤 초안을 다시 저장하세요.";
  }
  if (error.code === "CLASS_POLICY_REQUIRED") {
    return "미보유 종목이 포함된 자산군은 내부 비중을 균등 배분으로 선택해야 합니다.";
  }
  if (error.code === "INSTRUMENT_VALIDATION_FAILED") {
    return "추가한 종목을 토스증권에서 다시 검증하지 못했습니다. 종목을 제거하거나 다시 검색하세요.";
  }
  if (error.code === "ASSET_SET_MISMATCH") {
    return "현재 보유종목을 빠짐없이 한 자산군에만 배치했는지 확인하세요.";
  }
  if (error.status === 400) {
    return "목표 합계, 관리 현금, 자산군 분류와 내부 배분 방식을 다시 확인하세요.";
  }
  return "설정 서버에 연결할 수 없습니다. 입력값은 유지되었으니 잠시 후 다시 시도하세요.";
}

function instrumentSearchErrorMessage(error: unknown): string {
  if (!(error instanceof EngineConsoleRequestError)) {
    return "종목 검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.";
  }
  if (error.code === "INSTRUMENT_VALIDATION_INVALID" || error.status === 400) {
    return "국내 6자리 종목코드, 미국 티커 또는 종목명을 확인하세요.";
  }
  if (error.code === "INSTRUMENT_VALIDATION_FAILED") {
    return "토스증권에서 해당 종목을 검증하지 못했습니다.";
  }
  return "종목 검색 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.";
}

function shadowPlanErrorStatus(code: string | null): string {
  switch (code) {
    case "NO_SNAPSHOT":
      return "plan-no-snapshot";
    case "TARGET_CONFIG_MISSING":
    case "TARGET_CONFIG_STALE":
      return "plan-target-required";
    case "MANAGED_CASH_MISSING":
      return "plan-cash-required";
    case "PLAN_IN_PROGRESS":
      return "plan-in-progress";
    default:
      return "plan-unavailable";
  }
}
