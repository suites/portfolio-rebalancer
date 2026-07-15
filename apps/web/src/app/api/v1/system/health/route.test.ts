import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/system/health", () => {
  it("paper 기본값과 비활성화된 실거래 상태를 반환한다", async () => {
    const response = GET();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      status: "ok",
      mode: "paper",
      dataSource: "synthetic",
      brokerConnection: "not_connected",
      liveOrdersEnabled: false,
    });
  });
});
