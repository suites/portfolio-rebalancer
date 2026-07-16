import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DashboardSnapshotSchema,
  RebalancePlanSnapshotSchema,
} from "@portfolio-rebalancer/contracts";

import { RebalancingScreen } from "./rebalancing-screen";

vi.mock("@/app/(console)/actions", () => ({
  createRebalancePlanAction: vi.fn(),
}));

describe("RebalancingScreen", () => {
  it("관리 현금이 없으면 Shadow 계획 버튼을 비활성화하고 설정으로 안내한다", () => {
    const html = renderToStaticMarkup(
      <RebalancingScreen
        snapshot={dashboard("BLOCKED")}
        plan={RebalancePlanSnapshotSchema.parse({
          state: "NO_PLAN",
          latest: null,
          liveOrdersEnabled: false,
        })}
        actionStatus={undefined}
      />,
    );

    expect(html).toContain("관리 현금");
    expect(html).toContain("Shadow 계획 만들기");
    expect(html).toContain("Paper 계획 만들기");
    expect(html).toContain("Live 계획만 만들기");
    expect(html).toContain("disabled");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("어떤 모드에서도 실제 주문을 제출하지 않습니다");
  });

  it("저장된 주문 후보와 예상 비중을 금융 계산 없이 표시한다", () => {
    const plan = RebalancePlanSnapshotSchema.parse({
      state: "READY",
      latest: {
        runId: "20000000-0000-4000-8000-000000000001",
        planId: "20000000-0000-4000-8000-000000000002",
        mode: "SHADOW",
        status: "PLANNED",
        startedAt: "2026-07-16T01:00:00.000Z",
        completedAt: "2026-07-16T01:00:01.000Z",
        snapshotId: "20000000-0000-4000-8000-000000000003",
        snapshotDigest: "a".repeat(64),
        configVersionId: "20000000-0000-4000-8000-000000000004",
        canonicalVersion: "SHADOW_PLAN_V1",
        planHash: "b".repeat(64),
        returnPolicy: "BAND_EDGE",
        reasonCodes: ["BUY_PHASE_READY", "BUY_NEEDS_REMAIN"],
        totalValueMinor: "100000",
        executableOrders: [
          {
            candidateId: "SAFE:KR:114800:BUY",
            phase: "BUY",
            assetClassId: "SAFE",
            instrumentKey: "KR:114800",
            marketCountry: "KR",
            currency: "KRW",
            symbol: "114800",
            side: "BUY",
            orderType: "LIMIT",
            timeInForce: "DAY",
            quantity: "2",
            limitPriceMinor: "10000",
            notionalMinor: "20000",
            unallocatedMinor: "5000",
          },
        ],
        deferredBuyNeeds: [
          {
            assetClassId: "SAFE",
            instrumentKey: "KR:114800",
            marketCountry: "KR",
            currency: "KRW",
            symbol: "114800",
            desiredNotionalMinor: "25000",
            fundedMinor: "25000",
            executableNotionalMinor: "20000",
            remainingNeedMinor: "5000",
            previewQuantity: "2",
            previewNotionalMinor: "20000",
            reasonCodes: ["BUY_ROUNDING_REMAINDER"],
          },
        ],
        projectedAllocations: [
          {
            id: "SAFE",
            kind: "SECURITIES",
            valueMinor: "70000",
            targetBasisPoints: "8000",
            lowerBasisPoints: "7500",
            upperBasisPoints: "8500",
            currentBasisPoints: "7000",
            driftBasisPoints: "-1000",
            outsideBand: true,
          },
        ],
      },
      liveOrdersEnabled: false,
    });

    const html = renderToStaticMarkup(
      <RebalancingScreen snapshot={dashboard("READY")} plan={plan} actionStatus={undefined} />,
    );

    expect(html).toContain("1개 주문 후보");
    expect(html).toContain("KR:114800");
    expect(html).toContain("2주");
    expect(html).toContain("₩20,000");
    expect(html).toContain("다음 snapshot에서 다시 계산");
    expect(html).toContain("70%");
    expect(html).not.toContain("실거래 실행");
  });
});

function dashboard(state: "READY" | "BLOCKED") {
  return DashboardSnapshotSchema.parse({
    state,
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: "CONNECTED",
    accountLabel: "**** 0007",
    observedAt: "2026-07-16T01:00:00.000Z",
    conclusion: state === "READY" ? "REBALANCE_REQUIRED" : "BLOCKED",
    securitiesValueMinor: "90000",
    totalValueMinor: state === "READY" ? "100000" : "90000",
    managedCashMinor: state === "READY" ? "10000" : null,
    managedCashSource: state === "READY" ? "USER_FIXED" : "UNSET",
    buyingPower: [],
    allocations: [
      {
        id: "SAFE",
        label: "안전자산",
        description: "변동성 완충 자산",
        valueMinor: "90000",
        currentBasisPointHundredths: state === "READY" ? 900_000 : 1_000_000,
        targetBasisPoints: 8000,
        lowerBasisPoints: 7500,
        upperBasisPoints: 8500,
        bandStatus: "OUTSIDE_BAND",
        instruments: [],
      },
      {
        id: "CASH",
        label: "관리 현금",
        description: "사용자가 정한 고정 원화 관리금액",
        valueMinor: state === "READY" ? "10000" : "0",
        currentBasisPointHundredths: state === "READY" ? 100_000 : 0,
        targetBasisPoints: 2000,
        lowerBasisPoints: 1500,
        upperBasisPoints: 2500,
        bandStatus: "OUTSIDE_BAND",
        instruments: [],
      },
    ],
    unmanagedHoldings: [],
    blockReason:
      state === "BLOCKED"
        ? {
            code: "MANAGED_CASH_MISSING",
            problem: "관리 현금 기준이 없습니다.",
            protectiveAction: "계획과 주문을 차단했습니다.",
            nextAction: "설정에서 관리 현금을 선택하세요.",
          }
        : null,
    liveOrdersEnabled: false,
  });
}
