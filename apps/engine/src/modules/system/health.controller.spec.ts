import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("인증 없이 실거래 비활성 상태를 반환한다", async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const app = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
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
