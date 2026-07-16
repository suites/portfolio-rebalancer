import { describe, expect, it } from "vitest";

import { DashboardSnapshotSchema } from "./dashboard";

describe("DashboardSnapshotSchema", () => {
  it("브라우저 계약에서 범위를 벗어난 basis points를 거부한다", () => {
    const result = DashboardSnapshotSchema.safeParse({
      state: "READY",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      conclusion: "NO_ACTION",
      totalValueMinor: "1000",
      managedCashMinor: null,
      managedCashSource: "UNSET",
      blockReason: null,
      liveOrdersEnabled: false,
      allocations: [
        {
          id: "core",
          label: "코어",
          description: "시장",
          valueMinor: "1000",
          currentBasisPointHundredths: 1_000_100,
          targetBasisPoints: 10_000,
          lowerBasisPoints: 9_000,
          upperBasisPoints: 10_000,
          bandStatus: "OUTSIDE_BAND",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("목표가 없는 실제 보유자산은 미설정 상태로만 허용한다", () => {
    const result = DashboardSnapshotSchema.safeParse({
      state: "BLOCKED",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      conclusion: "BLOCKED",
      totalValueMinor: "1000",
      managedCashMinor: null,
      managedCashSource: "UNSET",
      blockReason: {
        code: "TARGET_CONFIG_MISSING",
        problem: "목표 비중이 설정되지 않았습니다.",
        protectiveAction: "주문 계획을 차단했습니다.",
        nextAction: "목표 비중을 설정하세요.",
      },
      liveOrdersEnabled: false,
      allocations: [
        {
          id: "KR:005930",
          label: "삼성전자",
          description: "KR · KRW",
          valueMinor: "1000",
          currentBasisPointHundredths: 1_000_000,
          targetBasisPoints: null,
          lowerBasisPoints: null,
          upperBasisPoints: null,
          bandStatus: "TARGET_NOT_CONFIGURED",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("매수 가능 금액을 관리 현금과 구분된 비평가 증거로만 허용한다", () => {
    const base = {
      state: "BLOCKED",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      conclusion: "BLOCKED",
      totalValueMinor: "1000",
      managedCashMinor: null,
      managedCashSource: "UNSET",
      allocations: [],
      blockReason: null,
      liveOrdersEnabled: false,
    };

    expect(
      DashboardSnapshotSchema.safeParse({
        ...base,
        buyingPower: [
          {
            currency: "KRW",
            amount: "5000000",
            valueKrwMinor: "5000000",
            observedAt: "2026-07-16T09:00:00+09:00",
            valuationEligible: false,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      DashboardSnapshotSchema.safeParse({
        ...base,
        buyingPower: [
          {
            currency: "KRW",
            amount: "5000000",
            valueKrwMinor: "5000000",
            observedAt: "2026-07-16T09:00:00+09:00",
            valuationEligible: true,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
