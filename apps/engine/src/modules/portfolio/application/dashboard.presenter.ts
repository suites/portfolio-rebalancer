import {
  DashboardSnapshotSchema,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { isOutsideAllocationBand } from "@portfolio-rebalancer/domain";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";

export async function getDashboard(
  repository: PrismaPortfolioRepository,
): Promise<DashboardSnapshotContract> {
  const { snapshot, activeTargetVersionId } = await repository.latestDashboardState();
  if (!snapshot) return blockedDashboard("NO_SNAPSHOT");

  if (snapshot.holdings.length === 0) {
    return DashboardSnapshotSchema.parse({
      state: "EMPTY",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: snapshot.account.maskedNumber,
      observedAt: snapshot.observedAt.toISOString(),
      conclusion: "BLOCKED",
      totalValueMinor: "0",
      verifiedCashMinor: null,
      allocations: [],
      blockReason: reasonFor("EMPTY_HOLDINGS"),
      liveOrdersEnabled: false,
    });
  }

  const total = snapshot.totalValueMinor;
  const pinnedTarget = snapshot.targetConfigVersion;
  const targets = new Map(
    pinnedTarget?.allocations.map((allocation) => [allocation.assetKey, allocation]) ?? [],
  );
  const allocations = snapshot.holdings.map((holding) => {
    const id = `${holding.market}:${holding.symbol}`;
    const target = targets.get(id);
    const common = {
      id,
      label: holding.name,
      description: `${holding.market} · ${holding.currency} · ${holding.quantity}주`,
      valueMinor: holding.marketValueKrwMinor.toString(),
      currentBasisPointHundredths:
        total === 0n ? 0 : Number((holding.marketValueKrwMinor * 1_000_000n) / total),
    };
    if (!target || total <= 0n) {
      return {
        ...common,
        targetBasisPoints: null,
        lowerBasisPoints: null,
        upperBasisPoints: null,
        bandStatus: "TARGET_NOT_CONFIGURED" as const,
      };
    }
    const outside = isOutsideAllocationBand({
      valueMinor: holding.marketValueKrwMinor,
      totalValueMinor: total,
      lowerBasisPoints: BigInt(target.lowerBasisPoints),
      upperBasisPoints: BigInt(target.upperBasisPoints),
    });
    return {
      ...common,
      targetBasisPoints: target.targetBasisPoints,
      lowerBasisPoints: target.lowerBasisPoints,
      upperBasisPoints: target.upperBasisPoints,
      bandStatus: outside ? ("OUTSIDE_BAND" as const) : ("IN_RANGE" as const),
    };
  });

  let blockCode: DashboardBlockReasonContract["code"] | null = null;
  if (activeTargetVersionId !== (pinnedTarget?.id ?? null)) {
    blockCode = activeTargetVersionId ? "TARGET_CONFIG_STALE" : "TARGET_CONFIG_MISSING";
  } else if (!pinnedTarget) {
    blockCode = "TARGET_CONFIG_MISSING";
  } else if (
    allocations.some(({ bandStatus }) => bandStatus === "TARGET_NOT_CONFIGURED") ||
    targets.size !== snapshot.holdings.length
  ) {
    blockCode = "UNMANAGED_ASSET";
  } else if (snapshot.managedCashMinor === null) {
    blockCode = "MANAGED_CASH_MISSING";
  }

  const outsideBand = allocations.some(({ bandStatus }) => bandStatus === "OUTSIDE_BAND");
  return DashboardSnapshotSchema.parse({
    state: blockCode ? "BLOCKED" : "READY",
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: "CONNECTED",
    accountLabel: snapshot.account.maskedNumber,
    observedAt: snapshot.observedAt.toISOString(),
    conclusion: blockCode ? "BLOCKED" : outsideBand ? "REBALANCE_REQUIRED" : "NO_ACTION",
    totalValueMinor: total.toString(),
    verifiedCashMinor: snapshot.managedCashMinor?.toString() ?? null,
    allocations,
    blockReason: blockCode ? reasonFor(blockCode) : null,
    liveOrdersEnabled: false,
  });
}

export function blockedDashboard(
  code: DashboardBlockReasonContract["code"],
): DashboardSnapshotContract {
  return DashboardSnapshotSchema.parse({
    state: "BLOCKED",
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: code === "CREDENTIALS_MISSING" ? "NOT_CONFIGURED" : "FAILED",
    accountLabel: null,
    observedAt: null,
    conclusion: "BLOCKED",
    totalValueMinor: null,
    verifiedCashMinor: null,
    allocations: [],
    blockReason: reasonFor(code),
    liveOrdersEnabled: false,
  });
}

function reasonFor(code: DashboardBlockReasonContract["code"]): DashboardBlockReasonContract {
  const common = {
    protectiveAction: "실제 주문과 리밸런싱 계획 생성을 차단했습니다.",
  };
  switch (code) {
    case "NO_SNAPSHOT":
      return {
        ...common,
        code,
        problem: "저장된 실제 계좌 스냅샷이 없습니다.",
        nextAction: "토스 데이터 새로고침을 실행하세요.",
      };
    case "EMPTY_HOLDINGS":
      return {
        ...common,
        code,
        problem: "선택한 계좌에 보유 주식이 없습니다.",
        nextAction: "계좌 선택이 올바른지 확인하세요.",
      };
    case "TARGET_CONFIG_MISSING":
      return {
        ...common,
        code,
        problem: "실제 보유자산은 조회했지만 목표 비중이 설정되지 않았습니다.",
        nextAction: "설정에서 목표 비중 초안을 저장하고 적용한 뒤 새 스냅샷을 수집하세요.",
      };
    case "TARGET_CONFIG_STALE":
      return {
        ...common,
        code,
        problem: "활성 목표 설정이 최신 계좌 스냅샷에 아직 고정되지 않았습니다.",
        nextAction: "문제 해결에서 토스 데이터 재점검을 실행하세요.",
      };
    case "MANAGED_CASH_MISSING":
      return {
        ...common,
        code,
        problem: "목표 비중은 확인했지만 평가에 포함할 관리 현금이 검증되지 않았습니다.",
        nextAction: "관리 현금 source of truth가 구현될 때까지 현재·목표 비중만 검토하세요.",
      };
    case "UNMANAGED_ASSET":
      return {
        ...common,
        code,
        problem: "스냅샷 보유자산과 고정된 목표 설정의 종목 구성이 일치하지 않습니다.",
        nextAction: "설정에서 모든 현재 보유자산을 확인하고 새 목표 버전을 적용하세요.",
      };
    case "CREDENTIALS_MISSING":
      return {
        ...common,
        code,
        problem: "토스증권 API 자격증명이 설정되지 않았습니다.",
        nextAction: "엔진 런타임에 TOSSINVEST_CLIENT_ID와 TOSSINVEST_CLIENT_SECRET을 주입하세요.",
      };
    case "EGRESS_NOT_CONFIRMED":
      return {
        ...common,
        code,
        problem: "Vercel의 고정 출구 IP가 토스증권 허용 IP로 확인되지 않았습니다.",
        nextAction:
          "engine 프로젝트에서 Static IPs 또는 Secure Compute를 활성화하고 토스증권 허용 IP 등록 후 확인 변수를 설정하세요.",
      };
    case "COLLECTION_IN_PROGRESS":
      return {
        ...common,
        code,
        problem: "다른 실제 계좌 수집이 진행 중입니다.",
        nextAction: "잠시 뒤 저장된 최신 스냅샷을 다시 확인하세요.",
      };
    default:
      return {
        ...common,
        code,
        problem: "실제 계좌 데이터를 안전하게 확인하지 못했습니다.",
        nextAction: "엔진 로그와 토스증권 연결 상태를 확인한 뒤 다시 시도하세요.",
      };
  }
}
