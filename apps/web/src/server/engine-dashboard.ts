import "server-only";

import { cache } from "react";

import {
  DashboardSnapshotSchema,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";

const ENGINE_INTERNAL_URL = process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4100";

export const getEngineDashboard = cache(async (): Promise<DashboardSnapshotContract> => {
  try {
    const current = await getStoredEngineDashboard();
    if (current.blockReason?.code !== "NO_SNAPSHOT") return current;
    return await requestDashboard("/internal/v1/portfolio/refresh", "POST");
  } catch {
    return engineUnavailableDashboard();
  }
});

export const getStoredEngineDashboard = cache(async (): Promise<DashboardSnapshotContract> => {
  try {
    return await requestDashboard("/internal/v1/dashboard", "GET");
  } catch {
    return engineUnavailableDashboard();
  }
});

export async function refreshEngineDashboard(): Promise<DashboardSnapshotContract> {
  try {
    return await requestDashboard("/internal/v1/portfolio/refresh", "POST");
  } catch {
    return engineUnavailableDashboard();
  }
}

function engineUnavailableDashboard(): DashboardSnapshotContract {
  return DashboardSnapshotSchema.parse({
    state: "BLOCKED",
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: "FAILED",
    accountLabel: null,
    observedAt: null,
    conclusion: "BLOCKED",
    securitiesValueMinor: null,
    totalValueMinor: null,
    managedCashMinor: null,
    managedCashSource: "UNSET",
    buyingPower: [],
    allocations: [],
    unmanagedHoldings: [],
    blockReason: {
      code: "ENGINE_UNAVAILABLE",
      problem: "포트폴리오 엔진에 연결할 수 없습니다.",
      protectiveAction: "실제 주문과 리밸런싱 계획 생성을 차단했습니다.",
      nextAction: "PostgreSQL과 engine 프로세스 상태를 확인하세요.",
    },
  });
}

async function requestDashboard(path: string, method: "GET" | "POST") {
  const serviceToken = process.env.ENGINE_SERVICE_TOKEN;
  const response = await fetch(new URL(path, ENGINE_INTERNAL_URL), {
    method,
    ...(serviceToken ? { headers: { authorization: `Bearer ${serviceToken}` } } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json();
  return DashboardSnapshotSchema.parse(body);
}
