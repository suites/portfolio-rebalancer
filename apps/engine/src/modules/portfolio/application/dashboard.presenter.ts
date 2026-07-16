import {
  DashboardSnapshotSchema,
  TargetStoredCashPolicySchema,
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

  const managedCashSource = cashSourceFor(
    snapshot.targetConfigVersion?.cashPolicy,
    snapshot.managedCashMinor,
  );
  if (
    snapshot.holdings.length === 0 &&
    (snapshot.managedCashMinor === null || snapshot.managedCashMinor === 0n)
  ) {
    const emptyBlockCode =
      snapshot.validationStatus === "VERIFIED"
        ? ("EMPTY_HOLDINGS" as const)
        : ("SNAPSHOT_EVIDENCE_UNVERIFIED" as const);
    return DashboardSnapshotSchema.parse({
      state: emptyBlockCode === "EMPTY_HOLDINGS" ? "EMPTY" : "BLOCKED",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: snapshot.account.maskedNumber,
      observedAt: snapshot.observedAt.toISOString(),
      conclusion: "BLOCKED",
      securitiesValueMinor: snapshot.securitiesValueMinor.toString(),
      totalValueMinor: "0",
      managedCashMinor: snapshot.managedCashMinor?.toString() ?? null,
      managedCashSource,
      buyingPower: (snapshot.buyingPower ?? []).map((item) => ({
        currency: item.currency,
        amount: item.amount,
        valueKrwMinor: item.valueKrwMinor.toString(),
        observedAt: item.observedAt.toISOString(),
        valuationEligible: false,
      })),
      allocations: [],
      unmanagedHoldings: [],
      blockReason: reasonFor(emptyBlockCode),
      liveOrdersEnabled: false,
    });
  }

  const total = snapshot.totalValueMinor;
  const pinnedTarget = snapshot.targetConfigVersion;
  const holdings = new Map(
    snapshot.holdings.map((holding) => [`${holding.marketCountry}:${holding.symbol}`, holding]),
  );
  const managedHoldingKeys = new Set<string>();
  const allocations = pinnedTarget
    ? pinnedTarget.allocations.map((target) => {
        if (target.assetKey === "CASH") {
          const valueMinor = snapshot.managedCashMinor ?? 0n;
          return presentTargetAllocation({
            id: target.assetKey,
            label: target.label,
            description:
              managedCashSource === "EXCLUDED"
                ? "포트폴리오 평가에서 제외"
                : managedCashSource === "USER_FIXED"
                  ? "사용자가 정한 고정 원화 관리금액"
                  : "관리 현금 기준이 아직 스냅샷에 반영되지 않음",
            valueMinor,
            totalValueMinor: total,
            target,
            targetConfigured: snapshot.managedCashMinor !== null,
            instruments: [],
          });
        }
        const targetHoldings = target.instruments.map((instrument) => {
          const instrumentKey = `${instrument.marketCountry}:${instrument.symbol}`;
          const holding = holdings.get(instrumentKey);
          if (holding) managedHoldingKeys.add(instrumentKey);
          return { instrumentKey, instrument, holding };
        });
        const valueMinor = targetHoldings.reduce(
          (sum, { holding }) => sum + (holding?.marketValueKrwMinor ?? 0n),
          0n,
        );
        return presentTargetAllocation({
          id: target.assetKey,
          label: target.label,
          description: targetAllocationDescription(target.assetKey, targetHoldings.length),
          valueMinor,
          totalValueMinor: total,
          target,
          targetConfigured: true,
          instruments: targetHoldings.map(({ instrumentKey, instrument, holding }) => ({
            id: instrumentKey,
            label: holding?.name ?? instrument.name,
            description: holding
              ? `${holding.marketCountry} · ${holding.currency} · ${holding.quantity}주`
              : `${instrument.marketCountry} · ${instrument.currency} · 현재 미보유`,
            valueMinor: (holding?.marketValueKrwMinor ?? 0n).toString(),
            currentWithinAssetBasisPointHundredths:
              valueMinor === 0n
                ? 0
                : Number(((holding?.marketValueKrwMinor ?? 0n) * 1_000_000n) / valueMinor),
            targetWithinAssetPoints: instrument.withinAssetPoints,
          })),
        });
      })
    : snapshot.holdings.map((holding) => ({
        id: `${holding.marketCountry}:${holding.symbol}`,
        label: holding.name,
        description: `${holding.marketCountry} · ${holding.currency} · ${holding.quantity}주`,
        valueMinor: holding.marketValueKrwMinor.toString(),
        currentBasisPointHundredths:
          total === 0n ? 0 : Number((holding.marketValueKrwMinor * 1_000_000n) / total),
        targetBasisPoints: null,
        lowerBasisPoints: null,
        upperBasisPoints: null,
        bandStatus: "TARGET_NOT_CONFIGURED" as const,
        instruments: [],
      }));
  const unmanagedHoldings = snapshot.holdings
    .filter((holding) => !managedHoldingKeys.has(`${holding.marketCountry}:${holding.symbol}`))
    .map((holding) => ({
      id: `${holding.marketCountry}:${holding.symbol}`,
      label: holding.name,
      description: `${holding.marketCountry} · ${holding.currency} · ${holding.quantity}주`,
      valueMinor: holding.marketValueKrwMinor.toString(),
    }));
  const targetIntegrityInvalid =
    pinnedTarget?.allocations.some(
      (allocation) =>
        (allocation.assetKey === "CASH" && allocation.instruments.length !== 0) ||
        (allocation.assetKey !== "CASH" &&
          allocation.targetBasisPoints > 0 &&
          allocation.instruments.length === 0),
    ) ?? false;

  let blockCode: DashboardBlockReasonContract["code"] | null = null;
  if (snapshot.validationStatus !== "VERIFIED") {
    blockCode = "SNAPSHOT_EVIDENCE_UNVERIFIED";
  } else if (activeTargetVersionId !== (pinnedTarget?.id ?? null)) {
    blockCode = activeTargetVersionId ? "TARGET_CONFIG_STALE" : "TARGET_CONFIG_MISSING";
  } else if (!pinnedTarget) {
    blockCode = "TARGET_CONFIG_MISSING";
  } else if (snapshot.managedCashMinor === null) {
    blockCode = "MANAGED_CASH_MISSING";
  } else if (
    unmanagedHoldings.length > 0 ||
    targetIntegrityInvalid ||
    !pinnedTarget.allocations.some(({ assetKey }) => assetKey === "CASH")
  ) {
    blockCode = "UNMANAGED_ASSET";
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
    securitiesValueMinor: snapshot.securitiesValueMinor.toString(),
    totalValueMinor: total.toString(),
    managedCashMinor: snapshot.managedCashMinor?.toString() ?? null,
    managedCashSource,
    buyingPower: (snapshot.buyingPower ?? []).map((item) => ({
      currency: item.currency,
      amount: item.amount,
      valueKrwMinor: item.valueKrwMinor.toString(),
      observedAt: item.observedAt.toISOString(),
      valuationEligible: false,
    })),
    allocations,
    unmanagedHoldings,
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
    securitiesValueMinor: null,
    totalValueMinor: null,
    managedCashMinor: null,
    managedCashSource: "UNSET",
    buyingPower: [],
    allocations: [],
    unmanagedHoldings: [],
    blockReason: reasonFor(code),
    liveOrdersEnabled: false,
  });
}

function presentTargetAllocation(input: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly valueMinor: bigint;
  readonly totalValueMinor: bigint;
  readonly targetConfigured: boolean;
  readonly target: {
    readonly targetBasisPoints: number;
    readonly lowerBasisPoints: number;
    readonly upperBasisPoints: number;
  };
  readonly instruments: readonly {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly valueMinor: string;
    readonly currentWithinAssetBasisPointHundredths: number;
    readonly targetWithinAssetPoints: number;
  }[];
}) {
  const common = {
    id: input.id,
    label: input.label,
    description: input.description,
    valueMinor: input.valueMinor.toString(),
    currentBasisPointHundredths:
      input.totalValueMinor === 0n
        ? 0
        : Number((input.valueMinor * 1_000_000n) / input.totalValueMinor),
    instruments: input.instruments,
  };
  if (!input.targetConfigured || input.totalValueMinor <= 0n) {
    return {
      ...common,
      targetBasisPoints: null,
      lowerBasisPoints: null,
      upperBasisPoints: null,
      bandStatus: "TARGET_NOT_CONFIGURED" as const,
    };
  }
  const outside = isOutsideAllocationBand({
    valueMinor: input.valueMinor,
    totalValueMinor: input.totalValueMinor,
    lowerBasisPoints: BigInt(input.target.lowerBasisPoints),
    upperBasisPoints: BigInt(input.target.upperBasisPoints),
  });
  return {
    ...common,
    targetBasisPoints: input.target.targetBasisPoints,
    lowerBasisPoints: input.target.lowerBasisPoints,
    upperBasisPoints: input.target.upperBasisPoints,
    bandStatus: outside ? ("OUTSIDE_BAND" as const) : ("IN_RANGE" as const),
  };
}

function targetAllocationDescription(assetKey: string, instrumentCount: number): string {
  const count = `${instrumentCount}개 구성 종목`;
  switch (assetKey) {
    case "SAFE":
      return `변동성 완충 자산 · ${count}`;
    case "CORE":
      return `장기 성장 핵심 자산 · ${count}`;
    case "SATELLITE":
      return `개별주·테마 보조 자산 · ${count}`;
    default:
      return count;
  }
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
        problem: "목표 비중은 확인했지만 평가에 사용할 관리 현금 기준이 스냅샷에 없습니다.",
        nextAction:
          "설정에서 관리 현금을 고정 금액으로 포함하거나 제외한 뒤 토스 데이터를 다시 점검하세요.",
      };
    case "UNMANAGED_ASSET":
      return {
        ...common,
        code,
        problem: "스냅샷 보유자산과 고정된 목표 설정의 종목 구성이 일치하지 않습니다.",
        nextAction: "설정에서 모든 현재 보유자산을 확인하고 새 목표 버전을 적용하세요.",
      };
    case "SNAPSHOT_EVIDENCE_UNVERIFIED":
      return {
        ...common,
        code,
        problem: "최신 계좌 스냅샷의 요청·응답 검증 증거를 신뢰할 수 없습니다.",
        nextAction: "토스 데이터를 다시 점검해 새 검증 스냅샷을 생성하세요.",
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
    case "COLLECTION_LEASE_LOST":
      return {
        ...common,
        code,
        problem: "수집 도중 실행 소유권이 만료되거나 다른 실행으로 이전되었습니다.",
        nextAction: "현재 실행의 저장을 중단했습니다. 진행 중인 수집이 끝난 뒤 다시 확인하세요.",
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

function cashSourceFor(
  cashPolicy: unknown,
  managedCashMinor: bigint | null,
): "UNSET" | "EXCLUDED" | "USER_FIXED" {
  if (managedCashMinor === null) return "UNSET";
  const parsed = TargetStoredCashPolicySchema.safeParse(cashPolicy);
  if (!parsed.success || parsed.data.mode === "UNSET") return "UNSET";
  return parsed.data.mode === "EXCLUDED" ? "EXCLUDED" : "USER_FIXED";
}
