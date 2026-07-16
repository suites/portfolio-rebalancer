import {
  DashboardSnapshotSchema,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";

export async function getDashboard(
  repository: PrismaPortfolioRepository,
): Promise<DashboardSnapshotContract> {
  const snapshot = await repository.latestSnapshot();
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
  const allocations = snapshot.holdings.map((holding) => ({
    id: `${holding.market}:${holding.symbol}`,
    label: holding.name,
    description: `${holding.market} · ${holding.currency} · ${holding.quantity}주`,
    valueMinor: holding.marketValueKrwMinor.toString(),
    currentBasisPointHundredths:
      total === 0n ? 0 : Number((holding.marketValueKrwMinor * 1_000_000n) / total),
    targetBasisPoints: null,
    lowerBasisPoints: null,
    upperBasisPoints: null,
    bandStatus: "TARGET_NOT_CONFIGURED" as const,
  }));
  return DashboardSnapshotSchema.parse({
    state: "BLOCKED",
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: "CONNECTED",
    accountLabel: snapshot.account.maskedNumber,
    observedAt: snapshot.observedAt.toISOString(),
    conclusion: "BLOCKED",
    totalValueMinor: total.toString(),
    verifiedCashMinor: null,
    allocations,
    blockReason: reasonFor("TARGET_CONFIG_MISSING"),
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
        nextAction: "설정 화면이 제공되기 전까지 조회 결과만 확인하세요.",
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
