import {
  RebalancePlanSnapshotSchema,
  ShadowPlanReasonCodeSchema,
  type RebalancePlanSnapshotContract,
  type StoredRebalancePlanContract,
} from "@portfolio-rebalancer/contracts";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";

type StoredRun = NonNullable<Awaited<ReturnType<PrismaPortfolioRepository["rebalanceRunById"]>>>;

export async function getLatestRebalancePlan(
  repository: PrismaPortfolioRepository,
): Promise<RebalancePlanSnapshotContract> {
  const run = await repository.latestRebalanceRun();
  return run ? presentRebalancePlan(run) : emptyRebalancePlanSnapshot();
}

export function presentRebalancePlan(run: StoredRun): RebalancePlanSnapshotContract {
  if (!run.plan || !run.completedAt || run.status === "RUNNING" || run.status === "FAILED") {
    return emptyRebalancePlanSnapshot();
  }
  const latest: StoredRebalancePlanContract = {
    runId: run.id,
    planId: run.plan.id,
    mode: run.plan.mode,
    status: run.plan.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt.toISOString(),
    snapshotId: run.snapshotId,
    snapshotDigest: run.snapshotDigest,
    configVersionId: run.targetConfigVersionId,
    canonicalVersion: requireCanonicalVersion(run.plan.canonicalVersion),
    planHash: run.plan.planHash,
    returnPolicy: requireReturnPolicy(run.plan.returnPolicy),
    reasonCodes: requireStringArray(run.plan.reasonCodes).map((code) =>
      ShadowPlanReasonCodeSchema.parse(code),
    ),
    totalValueMinor: run.plan.totalValueMinor?.toString() ?? null,
    executableOrders: run.plan.orders.map((order) => ({
      candidateId: order.candidateId,
      phase: requirePhase(order.phase),
      assetClassId: order.assetClassId,
      instrumentKey: order.instrumentKey,
      marketCountry: "KR",
      currency: "KRW",
      symbol: order.symbol,
      side: requirePhase(order.side),
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: order.quantity.toString(),
      limitPriceMinor: order.limitPriceMinor.toString(),
      notionalMinor: order.notionalMinor.toString(),
      unallocatedMinor: order.unallocatedMinor.toString(),
    })),
    deferredBuyNeeds: requireJsonArray(run.plan.deferredBuyNeeds),
    projectedAllocations: requireJsonArray(run.plan.projectedAllocations),
  };
  return RebalancePlanSnapshotSchema.parse({
    state: "READY",
    latest,
  });
}

export function unavailableRebalancePlanSnapshot(): RebalancePlanSnapshotContract {
  return RebalancePlanSnapshotSchema.parse({
    state: "UNAVAILABLE",
    latest: null,
  });
}

function emptyRebalancePlanSnapshot(): RebalancePlanSnapshotContract {
  return RebalancePlanSnapshotSchema.parse({
    state: "NO_PLAN",
    latest: null,
  });
}

function requireReturnPolicy(value: string): "BAND_EDGE" | "TARGET" {
  if (value === "BAND_EDGE" || value === "TARGET") return value;
  throw new Error("저장된 리밸런싱 계획의 복귀 정책이 올바르지 않습니다.");
}

function requireCanonicalVersion(value: string): "SHADOW_PLAN_V1" {
  if (value === "SHADOW_PLAN_V1") return value;
  throw new Error("저장된 리밸런싱 계획의 canonical version이 올바르지 않습니다.");
}

function requirePhase(value: string): "SELL" | "BUY" {
  if (value === "SELL" || value === "BUY") return value;
  throw new Error("저장된 리밸런싱 주문 후보의 방향이 올바르지 않습니다.");
}

function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("저장된 리밸런싱 계획의 이유 코드가 올바르지 않습니다.");
  }
  const codes: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string") {
      throw new Error("저장된 리밸런싱 계획의 이유 코드가 올바르지 않습니다.");
    }
    codes.push(item);
  }
  return codes;
}

function requireJsonArray(value: unknown): never[] {
  if (!Array.isArray(value)) {
    throw new Error("저장된 리밸런싱 계획의 JSON 결과가 배열이 아닙니다.");
  }
  return value as never[];
}
