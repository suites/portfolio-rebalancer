import {
  calculateAllocationSnapshot,
  isOutsideAllocationBand,
  type AllocationInput,
} from "@portfolio-rebalancer/domain";

export type DashboardConclusion = "NO_ACTION" | "REBALANCE_REQUIRED" | "BLOCKED" | "UNKNOWN";

export type DashboardDataStatus = "VERIFIED" | "BLOCKED" | "UNKNOWN";

export interface DashboardAllocation {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly valueMinor: string;
  readonly currentBasisPointHundredths: number;
  readonly targetBasisPoints: number;
  readonly lowerBasisPoints: number;
  readonly upperBasisPoints: number;
  readonly bandStatus: "IN_RANGE" | "OUTSIDE_BAND";
}

export interface DashboardSnapshot {
  readonly mode: "PAPER" | "SHADOW";
  readonly dataSource: "SYNTHETIC";
  readonly brokerConnection: "NOT_CONNECTED";
  readonly accountLabel: string;
  readonly observedAt: string;
  readonly conclusion: DashboardConclusion;
  readonly totalValueMinor: string;
  readonly verifiedCashMinor: string | null;
  readonly allocations: readonly DashboardAllocation[];
}

export interface DashboardAssetInput extends AllocationInput {
  readonly label: string;
  readonly description: string;
  readonly lowerBasisPoints: bigint;
  readonly upperBasisPoints: bigint;
}

export function buildDashboardSnapshot(
  input: Omit<DashboardSnapshot, "allocations" | "conclusion" | "totalValueMinor"> & {
    readonly dataStatus: DashboardDataStatus;
    readonly assets: readonly DashboardAssetInput[];
  },
): DashboardSnapshot {
  validateDashboardAssets(input.assets, input.verifiedCashMinor);
  const calculated = calculateAllocationSnapshot(input.assets);
  const conclusion = determineConclusion(input, calculated.totalValueMinor);
  return {
    mode: input.mode,
    dataSource: input.dataSource,
    brokerConnection: input.brokerConnection,
    accountLabel: input.accountLabel,
    observedAt: input.observedAt,
    conclusion,
    totalValueMinor: calculated.totalValueMinor.toString(),
    verifiedCashMinor: input.verifiedCashMinor,
    allocations: calculated.allocations.map((allocation) => {
      const source = input.assets.find(({ id }) => id === allocation.id);
      if (!source) {
        throw new Error(`대시보드 자산 정보를 찾을 수 없습니다: ${allocation.id}`);
      }
      return {
        id: allocation.id,
        label: source.label,
        description: source.description,
        valueMinor: allocation.valueMinor.toString(),
        currentBasisPointHundredths: Number(
          (allocation.valueMinor * 1_000_000n) / calculated.totalValueMinor,
        ),
        targetBasisPoints: Number(allocation.targetBasisPoints),
        lowerBasisPoints: Number(source.lowerBasisPoints),
        upperBasisPoints: Number(source.upperBasisPoints),
        bandStatus: isOutsideAllocationBand({
          valueMinor: allocation.valueMinor,
          totalValueMinor: calculated.totalValueMinor,
          lowerBasisPoints: source.lowerBasisPoints,
          upperBasisPoints: source.upperBasisPoints,
        })
          ? "OUTSIDE_BAND"
          : "IN_RANGE",
      };
    }),
  };
}

function determineConclusion(
  input: {
    readonly dataStatus: DashboardDataStatus;
    readonly verifiedCashMinor: string | null;
    readonly assets: readonly DashboardAssetInput[];
  },
  totalValueMinor: bigint,
): DashboardConclusion {
  if (input.dataStatus === "UNKNOWN") return "UNKNOWN";
  if (input.dataStatus === "BLOCKED" || input.verifiedCashMinor === null) return "BLOCKED";

  const outsideBand = input.assets.some((asset) =>
    isOutsideAllocationBand({
      valueMinor: asset.valueMinor,
      totalValueMinor,
      lowerBasisPoints: asset.lowerBasisPoints,
      upperBasisPoints: asset.upperBasisPoints,
    }),
  );
  return outsideBand ? "REBALANCE_REQUIRED" : "NO_ACTION";
}

function validateDashboardAssets(
  assets: readonly DashboardAssetInput[],
  verifiedCashMinor: string | null,
): void {
  for (const asset of assets) {
    if (
      asset.lowerBasisPoints < 0n ||
      asset.lowerBasisPoints > asset.targetBasisPoints ||
      asset.targetBasisPoints > asset.upperBasisPoints ||
      asset.upperBasisPoints > 10_000n
    ) {
      throw new Error(`자산 ${asset.id}의 허용 비중과 목표 비중이 올바르지 않습니다.`);
    }
  }

  if (verifiedCashMinor !== null) {
    if (!/^\d+$/.test(verifiedCashMinor)) {
      throw new Error("검증된 관리 현금은 0 이상의 minor-unit 정수 문자열이어야 합니다.");
    }
    const cashAsset = assets.find(({ id }) => id === "cash");
    if (!cashAsset || cashAsset.valueMinor !== BigInt(verifiedCashMinor)) {
      throw new Error("검증된 관리 현금과 cash 자산 평가액이 일치해야 합니다.");
    }
  }
}
