import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("GET /api/v1/brokers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("실제 엔진의 토스 연결 상태를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          state: "EMPTY",
          mode: "SHADOW",
          dataSource: "TOSS",
          brokerConnection: "CONNECTED",
          accountLabel: "**** 8901",
          observedAt: "2026-07-16T09:00:00+09:00",
          conclusion: "BLOCKED",
          totalValueMinor: "0",
          managedCashMinor: null,
          managedCashSource: "UNSET",
          allocations: [],
          blockReason: null,
          liveOrdersEnabled: false,
        }),
      ),
    );
    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      brokers: [
        {
          id: "toss",
          connectionStatus: "connected",
          adapterStatus: "read_only_adapter",
          liveOrdersEnabled: false,
        },
      ],
    });
  });
});
