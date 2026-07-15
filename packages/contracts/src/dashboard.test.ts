import { describe, expect, it } from "vitest";

import { DashboardSnapshotSchema } from "./dashboard";

describe("DashboardSnapshotSchema", () => {
  it("브라우저 계약에서 범위를 벗어난 basis points를 거부한다", () => {
    const result = DashboardSnapshotSchema.safeParse({
      mode: "PAPER",
      dataSource: "SYNTHETIC",
      brokerConnection: "NOT_CONNECTED",
      accountLabel: "**** 4821",
      observedAt: "2026-07-16T09:00:00+09:00",
      conclusion: "NO_ACTION",
      totalValueMinor: "1000",
      verifiedCashMinor: null,
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
});
