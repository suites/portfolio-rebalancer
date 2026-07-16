import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "./app.module";

describe("AppModule", () => {
  it("표준 Nest 모듈 그래프를 초기화하고 health route를 노출한다", async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
