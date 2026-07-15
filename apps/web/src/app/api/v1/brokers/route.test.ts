import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/v1/brokers", () => {
  it("transport 구현과 실제 연결 상태를 분리해 반환한다", async () => {
    const response = GET();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      brokers: [
        {
          id: "toss",
          openApiVersion: "1.2.4",
          operationCount: 30,
          connectionStatus: "not_connected",
          adapterStatus: "transport_only",
          liveOrdersEnabled: false,
        },
      ],
    });
  });
});
