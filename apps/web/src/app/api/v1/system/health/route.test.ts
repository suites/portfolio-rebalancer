import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("GET /api/v1/system/health", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("실제 토스 엔진 연결 상태와 비활성화된 실거래 상태를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          state: "BLOCKED",
          mode: "SHADOW",
          dataSource: "TOSS",
          brokerConnection: "CONNECTED",
          accountLabel: "**** 8901",
          observedAt: "2026-07-16T09:00:00+09:00",
          conclusion: "BLOCKED",
          totalValueMinor: "1000",
          verifiedCashMinor: null,
          allocations: [],
          blockReason: null,
          liveOrdersEnabled: false,
        }),
      ),
    );
    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      mode: "shadow",
      dataSource: "toss",
      brokerConnection: "connected",
      liveOrdersEnabled: false,
    });
  });
});
