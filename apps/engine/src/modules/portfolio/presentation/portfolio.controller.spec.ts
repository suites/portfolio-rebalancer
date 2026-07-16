import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { CronTokenGuard } from "../../../common/auth/guards/cron-token.guard";
import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { loadEngineConfig, type EngineConfig } from "../../../config/engine.config";
import { blockedDashboard } from "../application/dashboard.presenter";
import { PortfolioService } from "../application/portfolio.service";
import { PortfolioController } from "./portfolio.controller";

const SERVICE_TOKEN = "service-token-that-is-at-least-32-characters";
const CRON_TOKEN = "cron-token-at-least-16-characters";

describe("NestJS engine HTTP contract", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("service token을 정확히 검증하고 dashboard를 no-store로 반환한다", async () => {
    const harness = await createHarness({
      VERCEL: "1",
      ENGINE_SERVICE_TOKEN: SERVICE_TOKEN,
    });
    app = harness.app;

    const unauthorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/dashboard",
    });
    const authorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/dashboard",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toEqual({ error: "unauthorized" });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.headers["cache-control"]).toBe("no-store");
    expect(DashboardSnapshotSchema.safeParse(authorized.json()).success).toBe(true);
    expect(harness.portfolio.dashboard).toHaveBeenCalledOnce();
  });

  it("refresh 실패도 503과 검증 가능한 차단 계약으로 반환한다", async () => {
    const harness = await createHarness({ ENGINE_SERVICE_TOKEN: SERVICE_TOKEN });
    app = harness.app;
    harness.portfolio.refresh.mockResolvedValue({
      ok: false,
      dashboard: blockedDashboard("EGRESS_NOT_CONFIRMED"),
    });

    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/portfolio/refresh",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body: unknown = response.json();
    expect(DashboardSnapshotSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ blockReason: { code: "EGRESS_NOT_CONFIRMED" } });
  });

  it("cron secret은 service token과 분리하고 실패 코드를 보존한다", async () => {
    const harness = await createHarness({
      ENGINE_SERVICE_TOKEN: SERVICE_TOKEN,
      CRON_SECRET: CRON_TOKEN,
    });
    app = harness.app;
    harness.portfolio.collectFromCron.mockResolvedValue({
      ok: false,
      code: "COLLECTION_IN_PROGRESS",
    });

    const wrongToken = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/cron/portfolio",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const cron = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/cron/portfolio",
      headers: { authorization: `Bearer ${CRON_TOKEN}` },
    });

    expect(wrongToken.statusCode).toBe(401);
    expect(wrongToken.json()).toEqual({ error: "unauthorized" });
    expect(cron.statusCode).toBe(503);
    expect(cron.json()).toEqual({ ok: false, code: "COLLECTION_IN_PROGRESS" });
  });
});

async function createHarness(environment: NodeJS.ProcessEnv) {
  const config = loadEngineConfig({
    DATABASE_URL: "postgresql://local:local@127.0.0.1:15432/local",
    ...environment,
  });
  const portfolio = {
    dashboard: vi.fn().mockResolvedValue({
      ok: true,
      dashboard: blockedDashboard("NO_SNAPSHOT"),
    }),
    refresh: vi.fn().mockResolvedValue({
      ok: true,
      dashboard: blockedDashboard("TARGET_CONFIG_MISSING"),
    }),
    collectFromCron: vi.fn().mockResolvedValue({ ok: true }),
  };
  const testingModule = await Test.createTestingModule({
    controllers: [PortfolioController],
    providers: [
      { provide: ENGINE_CONFIG, useValue: config satisfies EngineConfig },
      { provide: PortfolioService, useValue: portfolio },
      ServiceTokenGuard,
      CronTokenGuard,
    ],
  }).compile();
  const nestApp = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await nestApp.init();
  return {
    app: nestApp,
    fastify: nestApp.getHttpAdapter().getInstance(),
    portfolio,
  };
}
