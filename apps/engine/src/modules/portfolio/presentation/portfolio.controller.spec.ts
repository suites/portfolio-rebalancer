import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleRecordsSnapshotSchema,
  DashboardSnapshotSchema,
  TargetSettingsSnapshotSchema,
} from "@portfolio-rebalancer/contracts";

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

  it("records와 target settings도 service token과 no-store 경계를 사용한다", async () => {
    const harness = await createHarness({ ENGINE_SERVICE_TOKEN: SERVICE_TOKEN });
    app = harness.app;

    const records = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/records",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const settings = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/target-settings",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    expect(records.statusCode).toBe(200);
    expect(records.headers["cache-control"]).toBe("no-store");
    expect(ConsoleRecordsSnapshotSchema.safeParse(records.json()).success).toBe(true);
    expect(settings.statusCode).toBe(200);
    expect(settings.headers["cache-control"]).toBe("no-store");
    expect(TargetSettingsSnapshotSchema.safeParse(settings.json()).success).toBe(true);
  });

  it("잘못된 목표 합계는 service 호출 전에 400으로 거부한다", async () => {
    const harness = await createHarness({ ENGINE_SERVICE_TOKEN: SERVICE_TOKEN });
    app = harness.app;

    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/target-settings/drafts",
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      payload: {
        cashPolicy: {
          mode: "EXCLUDED",
          version: "CASH_V1",
        },
        allocations: [
          {
            assetKey: "US:AAPL",
            targetBasisPoints: 9_999,
          },
          {
            assetKey: "CASH",
            targetBasisPoints: 0,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const body: unknown = response.json();
    expect(body).toMatchObject({ code: "TARGET_SETTINGS_INVALID" });
    expect(JSON.stringify(body)).toContain("10000bp");
    expect(harness.portfolio.createTargetDraft).not.toHaveBeenCalled();
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
    records: vi.fn().mockResolvedValue(
      ConsoleRecordsSnapshotSchema.parse({
        state: "READY",
        records: [],
        orderLedgerState: "NOT_IMPLEMENTED",
        liveOrdersEnabled: false,
      }),
    ),
    targetSettings: vi.fn().mockResolvedValue(
      TargetSettingsSnapshotSchema.parse({
        state: "NO_SNAPSHOT",
        accountLabel: null,
        snapshotObservedAt: null,
        snapshotTargetVersion: null,
        activeVersion: null,
        draftVersion: null,
        requiresCollection: false,
        assets: [],
        liveOrdersEnabled: false,
      }),
    ),
    createTargetDraft: vi.fn(),
    activateTargetDraft: vi.fn(),
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
