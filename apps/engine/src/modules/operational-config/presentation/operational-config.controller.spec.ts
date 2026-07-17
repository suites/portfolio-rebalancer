import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperationalConfigSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { OperationalConfigService } from "../application/operational-config.service";
import { OperationalConfigError } from "../domain/operational-config.error";
import { liveConfig } from "../testing/operational-config.fixture";
import { OperationalConfigController } from "./operational-config.controller";

describe("OperationalConfigController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("GET current snapshot을 사설 no-store 경계로 제공한다", async () => {
    const harness = await createHarness();
    app = harness.app;

    const response = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/operational-config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(OperationalConfigSnapshotSchema.safeParse(response.json()).success).toBe(true);
  });

  it("draft save, exact activation과 별도 live promotion route를 분리한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    const headers = {
      "content-type": "application/json",
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
      "local-console",
    );
  });

  it("confirmation 오타는 service 호출 전에 400으로 거부한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    const response = await harness.fastify.inject({
      method: "POST",
      url: "/internal/v1/operational-config/drafts/activate",
      headers: {
        "content-type": "application/json",
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
        "content-type": "application/json",
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
    providers: [{ provide: OperationalConfigService, useValue: service }],
  }).compile();
  const nestApp = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await nestApp.init();
  return {
    app: nestApp as INestApplication,
    fastify: nestApp.getHttpAdapter().getInstance(),
    service,
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
