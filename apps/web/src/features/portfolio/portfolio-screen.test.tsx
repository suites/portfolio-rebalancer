import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { PortfolioScreen } from "./portfolio-screen";

describe("PortfolioScreen", () => {
  it("자산군과 구성 종목, 관리되지 않는 보유종목을 native table과 별도 영역에 표시한다", () => {
    const snapshot = DashboardSnapshotSchema.parse({
      state: "BLOCKED",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "****1234",
      observedAt: "2026-07-16T03:00:00.000Z",
      conclusion: "BLOCKED",
      securitiesValueMinor: "1000100",
      totalValueMinor: "1000100",
      managedCashMinor: null,
      managedCashSource: "UNSET",
      allocations: [
        {
          id: "CORE",
          label: "핵심 공격자산",
          description: "장기 성장 핵심 자산 · 1개 구성 종목",
          valueMinor: "1000000",
          currentBasisPointHundredths: 999_900,
          targetBasisPoints: 10_000,
          lowerBasisPoints: 9_500,
          upperBasisPoints: 10_000,
          bandStatus: "IN_RANGE",
          instruments: [
            {
              id: "US:AAPL",
              label: "Apple",
              description: "US · USD · 1주",
              valueMinor: "1000000",
              currentWithinAssetBasisPointHundredths: 1_000_000,
              targetWithinAssetPoints: 10_000,
            },
          ],
        },
      ],
      unmanagedHoldings: [
        {
          id: "US:BRK.B",
          label: "Berkshire",
          description: "US · USD · 1주",
          valueMinor: "100",
        },
      ],
      blockReason: {
        code: "UNMANAGED_ASSET",
        problem: "관리되지 않는 보유종목이 있습니다.",
        protectiveAction: "계획을 차단했습니다.",
        nextAction: "설정을 확인하세요.",
      },
    });

    const html = renderToStaticMarkup(<PortfolioScreen snapshot={snapshot} />);

    expect(html).toContain("<table");
    expect(html).toContain("<caption>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Apple");
    expect(html).toContain("핵심 공격자산");
    expect(html).toContain("관리되지 않는 보유종목");
    expect(html).toContain("Berkshire");
  });
});
