import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleRecordsSnapshotSchema,
  DashboardSnapshotSchema,
  InstrumentCatalogSearchResultSchema,
  InstrumentValidationResultSchema,
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
            assetKey: "SAFE",
            targetBasisPoints: 0,
            instrumentKeys: [],
          },
          {
            assetKey: "CORE",
            targetBasisPoints: 0,
            instrumentKeys: [],
          },
          {
            assetKey: "SATELLITE",
            targetBasisPoints: 9_999,
            instrumentKeys: ["US:AAPL"],
          },
          {
            assetKey: "CASH",
            targetBasisPoints: 0,
            instrumentKeys: [],
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

  it("로컬 종목 검색과 Toss 정확 심볼 검증을 별도 endpoint로 제공한다", async () => {
    const harness = await createHarness({ ENGINE_SERVICE_TOKEN: SERVICE_TOKEN });
    app = harness.app;
    const candidate = instrumentCandidate();
    harness.portfolio.searchInstrumentCatalog.mockResolvedValue(
      InstrumentCatalogSearchResultSchema.parse({
        query: "애플",
        catalogScope: "LOCAL_VALIDATED",
        candidates: [{ ...candidate, source: "CATALOG" }],
      }),
    );
    harness.portfolio.validateInstrument.mockResolvedValue(
      InstrumentValidationResultSchema.parse({ candidate }),
    );

    const searched = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/instruments/search?query=%EC%95%A0%ED%94%8C",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    const validated = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/instrument-validations",
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      payload: { query: "US:AAPL" },
    });

    expect(searched.statusCode).toBe(200);
    expect(searched.headers["cache-control"]).toBe("no-store");
    expect(searched.json()).toMatchObject({ catalogScope: "LOCAL_VALIDATED" });
    expect(harness.portfolio.searchInstrumentCatalog).toHaveBeenCalledWith("애플");
    expect(validated.statusCode).toBe(200);
    expect(validated.headers["cache-control"]).toBe("no-store");
    expect(validated.json()).toMatchObject({
      candidate: { instrumentKey: "US:AAPL", targetEligibility: "ELIGIBLE" },
    });
    expect(harness.portfolio.validateInstrument).toHaveBeenCalledWith("US:AAPL");
  });

  it("정확 심볼이 아닌 검증 입력은 Toss service 호출 전에 거부한다", async () => {
    const harness = await createHarness({ ENGINE_SERVICE_TOKEN: SERVICE_TOKEN });
    app = harness.app;

    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/instrument-validations",
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      payload: { query: "삼성전자" },
    });

    expect(response.statusCode).toBe(400);
    expect(harness.portfolio.validateInstrument).not.toHaveBeenCalled();
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
        holdings: [],
        liveOrdersEnabled: false,
      }),
    ),
    searchInstrumentCatalog: vi.fn(),
    validateInstrument: vi.fn(),
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

function instrumentCandidate() {
  return {
    validationId: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
    instrumentKey: "US:AAPL",
    symbol: "AAPL",
    name: "애플",
    englishName: "Apple Inc.",
    marketCountry: "US",
    listingMarket: "NASDAQ",
    currency: "USD",
    securityType: "FOREIGN_STOCK",
    listingStatus: "ACTIVE",
    source: "TOSS_EXACT",
    targetEligibility: "ELIGIBLE",
    targetReasonCodes: [],
    addEligible: true,
    blockedReason: null,
    tradeBlockedNow: false,
    tradeReasonCodes: [],
    tradeBlockedReason: null,
    requiresOrderRevalidation: false,
    verifiedAt: "2026-07-16T13:00:00.000Z",
  } as const;
}
