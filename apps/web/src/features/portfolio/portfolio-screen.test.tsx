import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { PortfolioScreen } from "./portfolio-screen";

describe("PortfolioScreen", () => {
  it("실제 allocation을 caption과 column header가 있는 native table로 표시한다", () => {
    const snapshot = DashboardSnapshotSchema.parse({
      state: "BLOCKED",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "****1234",
      observedAt: "2026-07-16T03:00:00.000Z",
      conclusion: "BLOCKED",
      totalValueMinor: "1000000",
      managedCashMinor: null,
      managedCashSource: "UNSET",
      allocations: [
        {
          id: "US:AAPL",
          label: "Apple",
          description: "NASDAQ · USD · 1주",
          valueMinor: "1000000",
          currentBasisPointHundredths: 1_000_000,
          targetBasisPoints: null,
          lowerBasisPoints: null,
          upperBasisPoints: null,
          bandStatus: "TARGET_NOT_CONFIGURED",
        },
      ],
      blockReason: {
        code: "TARGET_CONFIG_MISSING",
        problem: "목표가 없습니다.",
        protectiveAction: "계획을 차단했습니다.",
        nextAction: "설정을 확인하세요.",
      },
      liveOrdersEnabled: false,
    });

    const html = renderToStaticMarkup(<PortfolioScreen snapshot={snapshot} />);

    expect(html).toContain("<table");
    expect(html).toContain("<caption>");
    expect(html).toContain('scope="col"');
    expect(html).toContain("Apple");
    expect(html).toContain("목표 미설정");
  });
});
