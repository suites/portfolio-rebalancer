import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationalConfigSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { loadEngineConfig } from "../../../config/engine.config";
import { OperationalConfigService } from "../application/operational-config.service";
import { OperationalConfigError } from "../domain/operational-config.error";
import { liveConfig } from "../testing/operational-config.fixture";
import { OperationalConfigController } from "./operational-config.controller";

const SERVICE_TOKEN = "service-token-that-is-at-least-32-characters";

describe("OperationalConfigController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("GET current snapshot을 service token과 no-store 경계로 제공한다", async () => {
    const harness = await createHarness();
    app = harness.app;

    const unauthorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/operational-config",
    });
    const authorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/operational-config",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.headers["cache-control"]).toBe("no-store");
    expect(OperationalConfigSnapshotSchema.safeParse(authorized.json()).success).toBe(true);
  });

  it("draft save, exact activation과 별도 live promotion route를 분리한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    const headers = {
      authorization: `Bearer ${SERVICE_TOKEN}`,
      "content-type": "application/json",
      ...operatorHeaders(),
    };

    const draft = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/operational-config/drafts",
      headers,
      payload: liveConfig(),
    });
    const currentAccountDraft = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/operational-config/drafts/current-account",
      headers,
      payload: {
        accountScope: "CURRENT_ACCOUNT",
        config: {
          ...liveConfig(),
          live: { ...liveConfig().live, accountAllowlistHmacs: [] },
        },
      },
    });
    const activation = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/operational-config/drafts/activate",
      headers,
      payload: {
        version: 2,
        contentHash: "b".repeat(64),
        confirmation: "운영 설정을 적용합니다",
      },
    });
    const promotion = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/live-promotion",
      headers,
      payload: {
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        confirmation: "극소액 Live 승격",
      },
    });

    expect([
      draft.statusCode,
      currentAccountDraft.statusCode,
      activation.statusCode,
      promotion.statusCode,
    ]).toEqual([200, 200, 200, 200]);
    expect(harness.service.saveDraft).toHaveBeenCalledOnce();
    const currentAccountCall: unknown = harness.service.saveCurrentAccountDraft.mock.calls[0]?.[0];
    expect(JSON.stringify(currentAccountCall)).toContain('"accountScope":"CURRENT_ACCOUNT"');
    expect(JSON.stringify(currentAccountCall)).toContain('"accountAllowlistHmacs":[]');
    expect(harness.service.activateDraft).toHaveBeenCalledWith({
      version: 2,
      contentHash: "b".repeat(64),
      confirmation: "운영 설정을 적용합니다",
    });
    expect(harness.service.saveLivePromotion).toHaveBeenCalledWith(
      {
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        confirmation: "극소액 Live 승격",
      },
      expect.stringContaining("operator=fred"),
    );
  });

  it("confirmation 오타는 service 호출 전에 400으로 거부한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/operational-config/drafts/activate",
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
        ...operatorHeaders(),
      },
      payload: { version: 2, contentHash: "b".repeat(64), confirmation: "적용" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "OPERATIONAL_CONFIG_INPUT_INVALID" });
    expect(harness.service.activateDraft).not.toHaveBeenCalled();
  });

  it("typed safety conflict를 코드와 한국어 메시지로 409에 매핑한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    harness.service.saveLivePromotion.mockRejectedValue(
      new OperationalConfigError(
        "LIVE_PROMOTION_KILL_SWITCH_BLOCKED",
        "현재 킬 스위치가 명시적으로 해제된 상태가 아닙니다.",
        "CONFLICT",
      ),
    );

    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/live-promotion",
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
        ...operatorHeaders(),
      },
      payload: {
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        confirmation: "극소액 Live 승격",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "LIVE_PROMOTION_KILL_SWITCH_BLOCKED",
      message: "현재 킬 스위치가 명시적으로 해제된 상태가 아닙니다.",
    });
  });
});

async function createHarness() {
  const snapshot = emptySnapshot();
  const service = {
    current: vi.fn().mockResolvedValue(snapshot),
    saveDraft: vi.fn().mockResolvedValue(snapshot),
    saveCurrentAccountDraft: vi.fn().mockResolvedValue(snapshot),
    activateDraft: vi.fn().mockResolvedValue(snapshot),
    saveLivePromotion: vi.fn().mockResolvedValue(snapshot),
  };
  const testingModule = await Test.createTestingModule({
    controllers: [OperationalConfigController],
    providers: [
      ServiceTokenGuard,
      { provide: OperationalConfigService, useValue: service },
      {
        provide: ENGINE_CONFIG,
        useValue: loadEngineConfig({
          DATABASE_RUNTIME_URL: "postgresql://test_runtime:test@localhost:5432/test",
          ENGINE_SERVICE_TOKEN: SERVICE_TOKEN,
          VERCEL: "1",
        }),
      },
    ],
  }).compile();
  const nestApp = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await nestApp.init();
  return {
    app: nestApp as INestApplication,
    fastify: nestApp.getHttpAdapter().getInstance(),
    service,
  };
}

function operatorHeaders() {
  const reauthenticatedAt = new Date();
  return {
    "x-portfolio-operator-id": "fred",
    "x-portfolio-operator-session-id": "10000000-0000-4000-8000-000000000099",
    "x-portfolio-operator-authenticated-at": new Date(
      reauthenticatedAt.getTime() - 60_000,
    ).toISOString(),
    "x-portfolio-operator-reauthenticated-at": reauthenticatedAt.toISOString(),
  };
}

function emptySnapshot() {
  return OperationalConfigSnapshotSchema.parse({
    state: "EMPTY",
    activeVersion: null,
    draftVersion: null,
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    liveOrdersEnabled: false,
  });
}
