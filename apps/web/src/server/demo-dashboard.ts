import "server-only";

import { buildDashboardSnapshot } from "@portfolio-rebalancer/application";
import {
  DashboardSnapshotSchema,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";

export function getDemoDashboard(): DashboardSnapshotContract {
  const snapshot = buildDashboardSnapshot({
    mode: "PAPER",
    dataSource: "SYNTHETIC",
    brokerConnection: "NOT_CONNECTED",
    accountLabel: "**** 4821",
    observedAt: "2026-07-16T09:12:00+09:00",
    dataStatus: "VERIFIED",
    verifiedCashMinor: "1248000",
    assets: [
      {
        id: "core",
        label: "코어 자산",
        description: "광범위 시장 ETF",
        valueMinor: 8_486_400n,
        targetBasisPoints: 7_500n,
        lowerBasisPoints: 7_000n,
        upperBasisPoints: 8_000n,
      },
      {
        id: "satellite",
        label: "AI 반도체",
        description: "테마 ETF",
        valueMinor: 2_745_600n,
        targetBasisPoints: 1_500n,
        lowerBasisPoints: 1_125n,
        upperBasisPoints: 1_875n,
      },
      {
        id: "cash",
        label: "현금",
        description: "검증된 관리 현금",
        valueMinor: 1_248_000n,
        targetBasisPoints: 1_000n,
        lowerBasisPoints: 750n,
        upperBasisPoints: 1_250n,
      },
    ],
  });
  return DashboardSnapshotSchema.parse(snapshot);
}
