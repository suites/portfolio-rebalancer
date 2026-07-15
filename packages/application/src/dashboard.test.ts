import { describe, expect, it } from "vitest";

import { buildDashboardSnapshot } from "./dashboard";

describe("buildDashboardSnapshot", () => {
  it("브라우저에 bigint를 노출하지 않는 직렬화 가능한 DTO를 만든다", () => {
    const result = buildDashboardSnapshot({
      mode: "PAPER",
      dataSource: "SYNTHETIC",
      brokerConnection: "NOT_CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      dataStatus: "VERIFIED",
      verifiedCashMinor: "1000000",
      assets: [
        {
          id: "core",
          label: "코어 자산",
          description: "광범위 시장 ETF",
          valueMinor: 7_000_000n,
          targetBasisPoints: 7_500n,
          lowerBasisPoints: 7_000n,
          upperBasisPoints: 8_000n,
        },
        {
          id: "satellite",
          label: "AI 반도체",
          description: "테마 ETF",
          valueMinor: 2_000_000n,
          targetBasisPoints: 1_500n,
          lowerBasisPoints: 1_125n,
          upperBasisPoints: 1_875n,
        },
        {
          id: "cash",
          label: "현금",
          description: "운용 대기 자금",
          valueMinor: 1_000_000n,
          targetBasisPoints: 1_000n,
          lowerBasisPoints: 750n,
          upperBasisPoints: 1_250n,
        },
      ],
    });

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result.allocations[0]?.currentBasisPointHundredths).toBe(700_000);
    expect(result.conclusion).toBe("REBALANCE_REQUIRED");
  });

  it("검증된 관리 현금이 없으면 비중과 무관하게 거래를 차단한다", () => {
    const result = buildDashboardSnapshot({
      mode: "PAPER",
      dataSource: "SYNTHETIC",
      brokerConnection: "NOT_CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      dataStatus: "VERIFIED",
      verifiedCashMinor: null,
      assets: [
        {
          id: "core",
          label: "코어 자산",
          description: "광범위 시장 ETF",
          valueMinor: 10_000_000n,
          targetBasisPoints: 10_000n,
          lowerBasisPoints: 9_000n,
          upperBasisPoints: 10_000n,
        },
      ],
    });

    expect(result.conclusion).toBe("BLOCKED");
  });

  it("1bp 미만의 밴드 상한 이탈도 리밸런싱 검토로 분류한다", () => {
    const result = buildDashboardSnapshot({
      mode: "PAPER",
      dataSource: "SYNTHETIC",
      brokerConnection: "NOT_CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      dataStatus: "VERIFIED",
      verifiedCashMinor: "0",
      assets: [
        {
          id: "core",
          label: "코어 자산",
          description: "광범위 시장 ETF",
          valueMinor: 800_009n,
          targetBasisPoints: 8_000n,
          lowerBasisPoints: 7_000n,
          upperBasisPoints: 8_000n,
        },
        {
          id: "satellite",
          label: "위성 자산",
          description: "테마 ETF",
          valueMinor: 199_991n,
          targetBasisPoints: 2_000n,
          lowerBasisPoints: 1_000n,
          upperBasisPoints: 3_000n,
        },
        {
          id: "cash",
          label: "현금",
          description: "검증된 관리 현금",
          valueMinor: 0n,
          targetBasisPoints: 0n,
          lowerBasisPoints: 0n,
          upperBasisPoints: 0n,
        },
      ],
    });

    expect(result.conclusion).toBe("REBALANCE_REQUIRED");
  });

  it("검증된 현금과 cash 자산 평가액이 다르면 차단한다", () => {
    expect(() =>
      buildDashboardSnapshot({
        mode: "PAPER",
        dataSource: "SYNTHETIC",
        brokerConnection: "NOT_CONNECTED",
        accountLabel: "**** 4821",
        observedAt: "2026-07-16T09:00:00+09:00",
        dataStatus: "VERIFIED",
        verifiedCashMinor: "100",
        assets: [
          {
            id: "cash",
            label: "현금",
            description: "검증된 현금",
            valueMinor: 99n,
            targetBasisPoints: 10_000n,
            lowerBasisPoints: 10_000n,
            upperBasisPoints: 10_000n,
          },
        ],
      }),
    ).toThrow("일치");
  });
});
