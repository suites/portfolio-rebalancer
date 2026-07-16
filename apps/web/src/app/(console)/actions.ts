"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type {
  CancelOrderReceiptContract,
  ExecuteRebalancePlanReceiptContract,
  InstrumentCandidateContract,
  TargetSettingsDraftInputContract,
} from "@portfolio-rebalancer/contracts";

import {
  activateEngineOperationalDraft,
  activateEngineTargetDraft,
  cancelEngineOrder,
  createEngineRebalancePlan,
  createEngineLivePlanApproval,
  createEngineShadowPlan,
  createEngineTargetDraft,
  EngineConsoleRequestError,
  executeEngineRebalancePlan,
  reconcileEngineOrder,
  recoverEngineUnknownOrder,
  saveEngineCurrentAccountOperationalDraft,
  saveEngineLivePromotion,
  searchEngineInstrumentCatalog,
  setEngineKillSwitch,
  validateEngineInstrument,
} from "@/server/engine-console";
import { refreshEngineDashboard } from "@/server/engine-dashboard";
import {
  OperatorAuthError,
  requireOperatorMutation,
  type OperatorAuditContext,
} from "@/server/operator-auth";
import { targetSettingsInputFromFormData } from "@/server/target-settings-input";

export async function refreshPortfolioAction(formData: FormData) {
  await requireActionOperator(formData, "/troubleshooting");
  await refreshEngineDashboard();
  revalidatePath("/", "layout");
  redirect("/troubleshooting");
}

export async function createShadowPlanAction(formData: FormData) {
  await requireActionOperator(formData, "/rebalancing");
  return createRebalancePlan("SHADOW");
}

export async function createRebalancePlanAction(formData: FormData) {
  await requireActionOperator(formData, "/rebalancing");
  const mode = formData.get("mode");
  if (mode !== "SHADOW" && mode !== "PAPER" && mode !== "LIVE") {
    redirect("/rebalancing?status=plan-mode-invalid");
  }
  return createRebalancePlan(mode);
}

export async function executePaperPlanAction(formData: FormData) {
  const operator = await requireActionOperator(formData, "/rebalancing");
  const planId = requiredUuid(formData, "planId");
  if (!planId) redirect("/rebalancing?status=execute-input-invalid");
  let status = "paper-execute-unavailable";
  try {
    const receipt = await executeEngineRebalancePlan(
      { planId, mode: "PAPER", approvalIds: [] },
      operator,
    );
    status = executionReceiptStatus(receipt);
  } catch (error) {
    status = orderActionStatus(error, "paper-execute-unavailable");
  }
  revalidateOrderViews();
  redirect(`/rebalancing?status=${status}`);
}

export async function executeLivePlanAction(formData: FormData) {
  const operator = await requireActionOperator(formData, "/rebalancing", true);
  const planId = requiredUuid(formData, "planId");
  const planHash = stringField(formData, "planHash");
  const confirmation = stringField(formData, "confirmation");
  if (
    !planId ||
    !/^[a-f0-9]{64}$/.test(planHash) ||
    confirmation !== "LIVE 주문 계획과 금액을 확인했습니다"
  ) {
    redirect("/rebalancing?status=live-confirmation-required");
  }
  let status = "live-execute-unavailable";
  try {
    const approvalReceipt = await createEngineLivePlanApproval(
      {
        planId,
        planHash,
        confirmation,
      },
      operator,
    );
    const executionReceipt = await executeEngineRebalancePlan(
      {
        planId,
        mode: "LIVE",
        approvalIds: approvalReceipt.approvals.map(({ approvalId }) => approvalId),
      },
      operator,
    );
    status = executionReceiptStatus(executionReceipt);
  } catch (error) {
    status = orderActionStatus(error, "live-execute-unavailable");
  }
  revalidateOrderViews();
  redirect(`/rebalancing?status=${status}`);
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
  await requireActionOperator(formData, "/settings");
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
  await requireActionOperator(formData, "/settings");
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
  await requireActionOperator(formData, "/settings");
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

export async function saveOperationalConfigDraftAction(formData: FormData) {
  await requireActionOperator(formData, "/settings");
  let status = "operational-draft-saved";
  try {
    const mode = stringField(formData, "mode");
    if (mode !== "PAPER" && mode !== "LIVE") throw new Error("MODE_INVALID");
    const liveEnabled = mode === "LIVE" && formData.get("liveEnabled") === "on";
    const config = {
      schemaVersion: "OPERATIONAL_CONFIG_V1",
      mode,
      killSwitch: false,
      freshness: {
        quote: {
          planMaxAgeSeconds: 300,
          preSubmitMaxAgeSeconds: 30,
          futureToleranceSeconds: 10,
        },
        calendar: {
          maxAgeSeconds: 86_400,
          futureToleranceSeconds: 10,
        },
      },
      limits: {
        minimumOrderGrossMinor: positiveIntegerField(formData, "minimumOrderWon"),
        feeBufferMinor: nonNegativeIntegerField(formData, "feeBufferWon"),
        maxSingleOrderGrossMinor: positiveIntegerField(formData, "maxSingleOrderWon"),
        maxDailyGrossMinor: positiveIntegerField(formData, "maxDailyGrossWon"),
        maxDailyTurnoverBasisPoints: 1_000,
        maxAbsolutePriceChangeBasisPoints: 500,
        maxInstrumentWeightBasisPoints: 4_000,
        maxAssetClassWeightBasisPoints: 7_000,
        maxRiskyWeightBasisPoints: 8_000,
      },
      live: {
        enabled: liveEnabled,
        marketCountry: "KR",
        allowedSession: "REGULAR_MARKET",
        orderType: "LIMIT",
        timeInForce: "DAY",
        accountAllowlistHmacs: [],
        manualApprovalRequired: true,
        approvalTtlSeconds: integerField(formData, "approvalTtlSeconds", 1, 600),
        maxSingleOrderGrossMinor: positiveIntegerField(formData, "liveMaxSingleOrderWon"),
        maxDailyGrossMinor: positiveIntegerField(formData, "liveMaxDailyGrossWon"),
        tinyLiveMaxGrossMinor: positiveIntegerField(formData, "tinyLiveMaxWon"),
      },
    };
    if (mode === "LIVE" && !liveEnabled) {
      throw new Error("LIVE_ENABLE_REQUIRED");
    }
    await saveEngineCurrentAccountOperationalDraft(config);
  } catch (error) {
    status =
      error instanceof EngineConsoleRequestError
        ? operationalActionStatus(error.code)
        : "operational-input-invalid";
  }
  revalidatePath("/", "layout");
  redirect(`/settings?status=${status}`);
}

export async function activateOperationalConfigDraftAction(formData: FormData) {
  await requireActionOperator(formData, "/settings");
  const version = integerFieldOrNull(formData, "version", 1, Number.MAX_SAFE_INTEGER);
  const contentHash = stringField(formData, "contentHash");
  const confirmation = stringField(formData, "confirmation");
  let status = "operational-activated";
  if (
    version === null ||
    !/^[a-f0-9]{64}$/.test(contentHash) ||
    confirmation !== "운영 설정을 적용합니다"
  ) {
    status = "operational-input-invalid";
  } else {
    try {
      await activateEngineOperationalDraft({
        version,
        contentHash,
        confirmation,
      });
    } catch (error) {
      status =
        error instanceof EngineConsoleRequestError
          ? operationalActionStatus(error.code)
          : "operational-unavailable";
    }
  }
  revalidatePath("/", "layout");
  redirect(`/settings?status=${status}`);
}

export async function setLivePromotionAction(formData: FormData) {
  const state = stringField(formData, "state");
  const operator = await requireActionOperator(formData, "/settings", state === "GRANTED");
  const reason = stringField(formData, "reason");
  let status = "live-promotion-updated";
  if ((state !== "GRANTED" && state !== "REVOKED") || reason.length < 8) {
    status = "operational-input-invalid";
  } else {
    try {
      const snapshot = await saveEngineLivePromotion(
        {
          state,
          reason,
          confirmation: state === "GRANTED" ? "극소액 Live 승격" : "Live 권한 회수",
        },
        operator,
      );
      if (snapshot.livePromotion !== state) status = "operational-unavailable";
    } catch (error) {
      status =
        error instanceof EngineConsoleRequestError
          ? operationalActionStatus(error.code)
          : "operational-unavailable";
    }
  }
  revalidatePath("/", "layout");
  redirect(`/settings?status=${status}`);
}

export async function setKillSwitchAction(formData: FormData) {
  const state = stringField(formData, "state");
  const operator = await requireActionOperator(formData, "/settings", state === "DISENGAGED");
  const reason = stringField(formData, "reason");
  let status = state === "ENGAGED" ? "kill-switch-engaged" : "kill-switch-disengaged";
  if ((state !== "ENGAGED" && state !== "DISENGAGED") || reason.length < 8) {
    status = "operational-input-invalid";
  } else {
    try {
      const snapshot = await setEngineKillSwitch(
        {
          state,
          reason,
          confirmation: state === "ENGAGED" ? "킬 스위치 작동" : "킬 스위치 해제",
        },
        operator,
      );
      if (snapshot.killSwitch !== state) status = "operational-unavailable";
    } catch (error) {
      status = orderActionStatus(error, "operational-unavailable");
    }
  }
  revalidatePath("/", "layout");
  redirect(`/settings?status=${status}`);
}

export async function cancelOrderAction(formData: FormData) {
  const operator = await requireActionOperator(formData, "/orders", true);
  const orderId = requiredUuid(formData, "orderId");
  const reason = stringField(formData, "reason");
  const confirmation = stringField(formData, "confirmation");
  let status = "cancel-requested";
  if (!orderId || reason.length < 8 || confirmation !== "미체결 주문 취소를 요청합니다") {
    status = "order-input-invalid";
  } else {
    try {
      const receipt = await cancelEngineOrder({ orderId, reason, confirmation }, operator);
      status = cancelReceiptStatus(receipt);
    } catch (error) {
      status = orderActionStatus(error, "cancel-unavailable");
    }
  }
  revalidateOrderViews();
  redirect(`/orders?status=${status}`);
}

export async function reconcileOrderAction(formData: FormData) {
  const operator = await requireActionOperator(formData, "/orders");
  const orderId = requiredUuid(formData, "orderId");
  let status = "order-reconciled";
  if (!orderId) {
    status = "order-input-invalid";
  } else {
    try {
      await reconcileEngineOrder(orderId, operator);
    } catch (error) {
      status = orderActionStatus(error, "reconcile-unavailable");
    }
  }
  revalidateOrderViews();
  redirect(`/orders?status=${status}`);
}

export async function recoverUnknownOrderAction(formData: FormData) {
  const operator = await requireActionOperator(formData, "/orders", true);
  const orderId = requiredUuid(formData, "orderId");
  const resolvedState = stringField(formData, "resolvedState");
  let status = "order-recovered";
  if (
    !orderId ||
    !["PENDING", "PARTIAL_FILLED", "FILLED", "CANCELED", "REJECTED"].includes(resolvedState)
  ) {
    status = "order-input-invalid";
  } else {
    try {
      await recoverEngineUnknownOrder(
        {
          orderId,
          resolvedState: resolvedState as
            "PENDING" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED",
          brokerEvidenceReference: stringField(formData, "brokerEvidenceReference"),
          brokerOrderId: stringField(formData, "brokerOrderId"),
          limitPriceMinor: positiveIntegerField(formData, "limitPriceWon"),
          filledQuantity: nonNegativeIntegerField(formData, "filledQuantity"),
          filledGrossMinor: nonNegativeIntegerField(formData, "filledGrossWon"),
          feeMinor: nonNegativeIntegerField(formData, "feeWon"),
        },
        operator,
      );
    } catch (error) {
      status =
        error instanceof EngineConsoleRequestError
          ? orderActionStatus(error, "recover-unavailable")
          : "order-input-invalid";
    }
  }
  revalidateOrderViews();
  redirect(`/orders?status=${status}`);
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

function requiredUuid(formData: FormData, field: string): string | null {
  const value = stringField(formData, field);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function stringField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function positiveIntegerField(formData: FormData, field: string): string {
  const value = stringField(formData, field);
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function nonNegativeIntegerField(formData: FormData, field: string): string {
  const value = stringField(formData, field);
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function integerField(formData: FormData, field: string, minimum: number, maximum: number): number {
  const value = integerFieldOrNull(formData, field, minimum, maximum);
  if (value === null) throw new Error(`${field.toUpperCase()}_INVALID`);
  return value;
}

function integerFieldOrNull(
  formData: FormData,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = stringField(formData, field);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function executionReceiptStatus(receipt: ExecuteRebalancePlanReceiptContract): string {
  if (receipt.mode === "PAPER") {
    switch (receipt.outcome) {
      case "COMPLETED":
        return "paper-executed";
      case "PENDING":
        return "paper-execution-pending";
      case "BLOCKED":
        return "paper-execution-blocked";
      case "REFRESH_REQUIRED":
        return "paper-refresh-required";
    }
  }
  switch (receipt.outcome) {
    case "COMPLETED":
      return "live-order-completed";
    case "PENDING":
      return "live-order-pending";
    case "BLOCKED":
      return "order-execution-blocked";
    case "REFRESH_REQUIRED":
      return "live-refresh-required";
  }
}

function cancelReceiptStatus(receipt: CancelOrderReceiptContract): string {
  switch (receipt.outcome) {
    case "REQUEST_ACCEPTED":
      return "cancel-requested";
    case "REJECTED":
      return "cancel-rejected";
    case "BLOCKED":
      return "cancel-blocked";
    case "UNKNOWN":
      return "cancel-unknown";
  }
}

async function requireActionOperator(
  formData: FormData,
  returnTo: "/orders" | "/rebalancing" | "/settings" | "/troubleshooting",
  recentReauthentication: boolean = false,
): Promise<OperatorAuditContext> {
  try {
    return await requireOperatorMutation(formData, { recentReauthentication });
  } catch (error) {
    if (error instanceof OperatorAuthError) {
      const encodedReturnTo = encodeURIComponent(returnTo);
      if (error.code === "AUTH_REAUTH_REQUIRED") {
        redirect(`/auth/reauth?returnTo=${encodedReturnTo}`);
      }
      if (error.code === "AUTH_UNAUTHENTICATED" || error.code === "AUTH_NOT_CONFIGURED") {
        redirect(`/auth/login?returnTo=${encodedReturnTo}`);
      }
    }
    redirect(`${returnTo}?status=operator-security-blocked`);
  }
}

function orderActionStatus(error: unknown, fallback: string): string {
  if (!(error instanceof EngineConsoleRequestError)) return fallback;
  switch (error.code) {
    case "ORDER_INPUT_INVALID":
      return "order-input-invalid";
    case "ORDER_APPROVAL_INVALID":
    case "ORDER_APPROVAL_STALE":
      return "live-approval-stale";
    case "ORDER_EXECUTION_BLOCKED":
      return "order-execution-blocked";
    case "ORDER_CANCEL_BLOCKED":
      return "cancel-blocked";
    case "ORDER_RECOVERY_BLOCKED":
      return "recovery-blocked";
    case "ORDER_NOT_FOUND":
      return "order-not-found";
    default:
      return fallback;
  }
}

function operationalActionStatus(code: string | null): string {
  switch (code) {
    case "OPERATIONAL_CONFIG_INPUT_INVALID":
      return "operational-input-invalid";
    case "OPERATIONAL_CONFIG_ACCOUNT_MISSING":
      return "operational-account-missing";
    case "OPERATIONAL_CONFIG_CONTENT_REUSED":
      return "operational-content-reused";
    case "OPERATIONAL_CONFIG_DRAFT_STALE":
    case "OPERATIONAL_CONFIG_HASH_MISMATCH":
      return "operational-draft-stale";
    case "LIVE_PROMOTION_KILL_SWITCH_BLOCKED":
      return "live-kill-switch-blocked";
    case "LIVE_PROMOTION_POLICY_BLOCKED":
      return "live-policy-blocked";
    case "LIVE_PROMOTION_REVOKE_REQUIRED":
      return "live-revoke-required";
    default:
      return "operational-unavailable";
  }
}

function revalidateOrderViews(): void {
  revalidatePath("/rebalancing");
  revalidatePath("/orders");
  revalidatePath("/settings");
  revalidatePath("/", "layout");
}
