import { describe, expect, it } from "vitest";

import { createEngineApplication } from "./bootstrap";

describe("Nest application bootstrap", () => {
  it("표준 모듈 그래프를 초기화하고 health route를 노출한다", async () => {
    const app = await createEngineApplication();
    await app.init();
    try {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/internal/v1/health",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok", liveOrdersEnabled: false });
    } finally {
      await app.close();
    }
  });
});
