import "server-only";

import { cache } from "react";

import {
  ConsoleRecordsSnapshotSchema,
  CancelOrderReceiptSchema,
  ExecuteRebalancePlanReceiptSchema,
  InstrumentCatalogSearchResultSchema,
  InstrumentValidationResultSchema,
  LivePlanApprovalReceiptSchema,
  OperationalConfigSnapshotSchema,
  OrdersSnapshotSchema,
  RebalancePlanSnapshotSchema,
  StoredOrderReceiptSchema,
  TargetSettingsSnapshotSchema,
  type ActivateOperationalConfigDraftInputContract,
  type CancelOrderInputContract,
  type CancelOrderReceiptContract,
  type ConsoleRecordsSnapshotContract,
  type ExecuteRebalancePlanReceiptContract,
  type InstrumentCatalogSearchResultContract,
  type InstrumentValidationResultContract,
  type KillSwitchCommandContract,
  type LivePlanApprovalReceiptContract,
  type LivePromotionCommandContract,
  type OperationalConfigSnapshotContract,
  type OrdersSnapshotContract,
  type RebalancePlanSnapshotContract,
  type RecoverUnknownOrderInputContract,
  type StoredOrderReceiptContract,
  type TargetSettingsDraftInputContract,
  type TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";

const ENGINE_INTERNAL_URL = process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4100";

export class EngineConsoleRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`ENGINE_REQUEST_FAILED_${status}`);
    this.name = "EngineConsoleRequestError";
  }
}

export type OperatorAuditContext = { readonly actor: "tailscale-operator" };
export const TAILSCALE_OPERATOR: OperatorAuditContext = { actor: "tailscale-operator" };

export const getEngineRecords = cache(async (): Promise<ConsoleRecordsSnapshotContract> => {
  try {
    return ConsoleRecordsSnapshotSchema.parse(await requestEngine("/internal/v1/records", "GET"));
  } catch {
    return ConsoleRecordsSnapshotSchema.parse({
      state: "UNAVAILABLE",
      records: [],
    });
  }
});

export const getEngineTargetSettings = cache(async (): Promise<TargetSettingsSnapshotContract> => {
  try {
    return TargetSettingsSnapshotSchema.parse(
      await requestEngine("/internal/v1/target-settings", "GET"),
    );
  } catch {
    return unavailableTargetSettings();
  }
});

export const getEngineRebalancePlan = cache(async (): Promise<RebalancePlanSnapshotContract> => {
  try {
    return RebalancePlanSnapshotSchema.parse(
      await requestEngine("/internal/v1/rebalance-plans/latest", "GET"),
    );
  } catch {
    return unavailableRebalancePlan();
  }
});

export const getEngineOrders = cache(async (): Promise<OrdersSnapshotContract> => {
  try {
    return OrdersSnapshotSchema.parse(await requestEngine("/internal/v1/orders", "GET"));
  } catch {
    return unavailableOrders();
  }
});

export const getEngineOperationalConfig = cache(
  async (): Promise<OperationalConfigSnapshotContract> => {
    try {
      return OperationalConfigSnapshotSchema.parse(
        await requestEngine("/internal/v1/operational-config", "GET"),
      );
    } catch {
      return unavailableOperationalConfig();
    }
  },
);

export async function createEngineShadowPlan(): Promise<RebalancePlanSnapshotContract> {
  return createEngineRebalancePlan("SHADOW");
}

export async function createEngineRebalancePlan(
  mode: "SHADOW" | "PAPER" | "LIVE",
): Promise<RebalancePlanSnapshotContract> {
  return RebalancePlanSnapshotSchema.parse(
    await requestEngine("/internal/v1/rebalance-plans", "POST", { mode }),
  );
}

export async function createEngineTargetDraft(
  input: TargetSettingsDraftInputContract,
): Promise<TargetSettingsSnapshotContract> {
  return TargetSettingsSnapshotSchema.parse(
    await requestEngine("/internal/v1/target-settings/drafts", "POST", input),
  );
}

export async function activateEngineTargetDraft(
  version: number,
): Promise<TargetSettingsSnapshotContract> {
  return TargetSettingsSnapshotSchema.parse(
    await requestEngine(`/internal/v1/target-settings/drafts/${version}/activate`, "POST"),
  );
}

export async function searchEngineInstrumentCatalog(
  query: string,
): Promise<InstrumentCatalogSearchResultContract> {
  const search = new URLSearchParams({ query });
  return InstrumentCatalogSearchResultSchema.parse(
    await requestEngine(`/internal/v1/instruments/search?${search.toString()}`, "GET"),
  );
}

export async function validateEngineInstrument(
  query: string,
): Promise<InstrumentValidationResultContract> {
  return InstrumentValidationResultSchema.parse(
    await requestEngine("/internal/v1/instrument-validations", "POST", { query }),
  );
}

export async function saveEngineCurrentAccountOperationalDraft(
  config: unknown,
): Promise<OperationalConfigSnapshotContract> {
  return OperationalConfigSnapshotSchema.parse(
    await requestEngine("/internal/v1/operational-config/drafts/current-account", "POST", {
      accountScope: "CURRENT_ACCOUNT",
      config,
    }),
  );
}

export async function activateEngineOperationalDraft(
  input: ActivateOperationalConfigDraftInputContract,
): Promise<OperationalConfigSnapshotContract> {
  return OperationalConfigSnapshotSchema.parse(
    await requestEngine("/internal/v1/operational-config/drafts/activate", "POST", input),
  );
}

export async function saveEngineLivePromotion(
  input: LivePromotionCommandContract,
): Promise<OperationalConfigSnapshotContract> {
  return OperationalConfigSnapshotSchema.parse(
    await requestEngine("/internal/v1/live-promotion", "POST", input),
  );
}

export async function createEngineLivePlanApproval(
  input: {
    readonly planId: string;
    readonly planHash: string;
    readonly confirmation: "LIVE 주문 계획과 금액을 확인했습니다";
  },
): Promise<LivePlanApprovalReceiptContract> {
  const receipt = LivePlanApprovalReceiptSchema.parse(
    await requestEngine(
      `/internal/v1/rebalance-plans/${input.planId}/live-approvals`,
      "POST",
      input,
    ),
  );
  if (receipt.planId !== input.planId || receipt.planHash !== input.planHash) {
    throw new EngineConsoleRequestError(502, "ENGINE_RECEIPT_MISMATCH");
  }
  return receipt;
}

export async function executeEngineRebalancePlan(
  input: {
    readonly planId: string;
    readonly mode: "PAPER" | "LIVE";
    readonly approvalIds: readonly string[];
  },
): Promise<ExecuteRebalancePlanReceiptContract> {
  const receipt = ExecuteRebalancePlanReceiptSchema.parse(
    await requestEngine(
      `/internal/v1/rebalance-plans/${input.planId}/execute`,
      "POST",
      input,
    ),
  );
  if (receipt.planId !== input.planId || receipt.mode !== input.mode) {
    throw new EngineConsoleRequestError(502, "ENGINE_RECEIPT_MISMATCH");
  }
  return receipt;
}

export async function setEngineKillSwitch(
  input: KillSwitchCommandContract,
): Promise<OrdersSnapshotContract> {
  return OrdersSnapshotSchema.parse(
    await requestEngine("/internal/v1/kill-switch", "POST", input),
  );
}

export async function cancelEngineOrder(
  input: CancelOrderInputContract,
): Promise<CancelOrderReceiptContract> {
  const receipt = CancelOrderReceiptSchema.parse(
    await requestEngine(`/internal/v1/orders/${input.orderId}/cancel`, "POST", input),
  );
  if (receipt.orderId !== input.orderId) {
    throw new EngineConsoleRequestError(502, "ENGINE_RECEIPT_MISMATCH");
  }
  return receipt;
}

export async function reconcileEngineOrder(
  orderId: string,
): Promise<StoredOrderReceiptContract> {
  const receipt = StoredOrderReceiptSchema.parse(
    await requestEngine(`/internal/v1/orders/${orderId}/reconcile`, "POST"),
  );
  if (receipt.orderId !== orderId) {
    throw new EngineConsoleRequestError(502, "ENGINE_RECEIPT_MISMATCH");
  }
  return receipt;
}

export async function recoverEngineUnknownOrder(
  input: RecoverUnknownOrderInputContract,
): Promise<StoredOrderReceiptContract> {
  const receipt = StoredOrderReceiptSchema.parse(
    await requestEngine(`/internal/v1/orders/${input.orderId}/recover`, "POST", input),
  );
  if (receipt.orderId !== input.orderId) {
    throw new EngineConsoleRequestError(502, "ENGINE_RECEIPT_MISMATCH");
  }
  return receipt;
}

async function requestEngine(
  path: string,
  method: "GET" | "POST",
  body?: unknown,
) {
  const serviceToken = process.env.ENGINE_SERVICE_TOKEN;
  const response = await fetch(new URL(path, ENGINE_INTERNAL_URL), {
    method,
    headers: {
      ...(serviceToken ? { authorization: `Bearer ${serviceToken}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new EngineConsoleRequestError(response.status, responseErrorCode(responseBody));
  }
  return responseBody;
}

function responseErrorCode(body: unknown): string | null {
  if (body === null || Array.isArray(body) || typeof body !== "object") return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function unavailableTargetSettings(): TargetSettingsSnapshotContract {
  return TargetSettingsSnapshotSchema.parse({
    state: "UNAVAILABLE",
    accountLabel: null,
    snapshotObservedAt: null,
    snapshotTargetVersion: null,
    activeVersion: null,
    draftVersion: null,
    requiresCollection: false,
    assets: [],
    holdings: [],
  });
}

function unavailableRebalancePlan(): RebalancePlanSnapshotContract {
  return RebalancePlanSnapshotSchema.parse({
    state: "UNAVAILABLE",
    latest: null,
  });
}

function unavailableOrders(): OrdersSnapshotContract {
  return OrdersSnapshotSchema.parse({
    state: "UNAVAILABLE",
    killSwitch: "UNKNOWN",
    orders: [],
    liveOrdersEnabled: false,
  });
}

function unavailableOperationalConfig(): OperationalConfigSnapshotContract {
  return OperationalConfigSnapshotSchema.parse({
    state: "UNAVAILABLE",
    activeVersion: null,
    draftVersion: null,
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    liveOrdersEnabled: false,
  });
}
