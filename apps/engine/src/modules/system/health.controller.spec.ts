import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { OperationalConfigSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { OperationalConfigService } from "../operational-config/application/operational-config.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("인증 없이 봉인된 운영 모드와 Live 안전 상태를 반환한다", async () => {
    const testingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: OperationalConfigService,
          useValue: {
            current: () =>
              Promise.resolve(
                OperationalConfigSnapshotSchema.parse({
                  state: "EMPTY",
                  activeVersion: null,
                  draftVersion: null,
                  killSwitch: "ENGAGED",
                  livePromotion: "REVOKED",
                  liveOrdersEnabled: false,
                }),
              ),
          },
        },
      ],
    }).compile();
    const app = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    try {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/internal/v1/health",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "ok",
        executionMode: "PAPER",
        killSwitch: "ENGAGED",
        livePromotion: "REVOKED",
        liveOrdersEnabled: false,
      });
    } finally {
      await app.close();
    }
  });
});
