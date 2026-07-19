import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DashboardSnapshotSchema } from "@portfolio-rebalancer/contracts";

vi.mock("@/app/(console)/actions", () => ({
  refreshPortfolioFromHomeAction: vi.fn(),
}));

import { OverviewScreen } from "./overview-screen";

describe("OverviewScreen", () => {
  it("홈에서 최신 토스 자산 수집을 시작할 수 있다", () => {
    const snapshot = DashboardSnapshotSchema.parse({
      state: "READY",
      mode: "SHADOW",
      dataSource: "TOSS",
      brokerConnection: "CONNECTED",
      accountLabel: "****0007",
      observedAt: "2026-07-19T10:39:00.000Z",
      conclusion: "NO_ACTION",
      securitiesValueMinor: "3128168",
      totalValueMinor: "3128168",
      managedCashMinor: "0",
      managedCashSource: "EXCLUDED",
      buyingPower: [],
      allocations: [],
      unmanagedHoldings: [],
      blockReason: null,
    });

    const html = renderToStaticMarkup(<OverviewScreen snapshot={snapshot} />);

    expect(html).toContain("최신 자산 가져오기");
    expect(html).toContain("금액 숨기기");
  });
});
