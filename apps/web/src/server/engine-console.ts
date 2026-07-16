import "server-only";

import { cache } from "react";

import {
  ConsoleRecordsSnapshotSchema,
  InstrumentCatalogSearchResultSchema,
  InstrumentValidationResultSchema,
  TargetSettingsSnapshotSchema,
  type ConsoleRecordsSnapshotContract,
  type InstrumentCatalogSearchResultContract,
  type InstrumentValidationResultContract,
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

export const getEngineRecords = cache(async (): Promise<ConsoleRecordsSnapshotContract> => {
  try {
    return ConsoleRecordsSnapshotSchema.parse(await requestEngine("/internal/v1/records", "GET"));
  } catch {
    return ConsoleRecordsSnapshotSchema.parse({
      state: "UNAVAILABLE",
      records: [],
      orderLedgerState: "NOT_IMPLEMENTED",
      liveOrdersEnabled: false,
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

async function requestEngine(path: string, method: "GET" | "POST", body?: unknown) {
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
    liveOrdersEnabled: false,
  });
}
