import { type INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrdersSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { loadEngineConfig } from "../../../config/engine.config";
import { OrdersService } from "../application/orders.service";
import { OrdersController } from "./orders.controller";

const SERVICE_TOKEN = "service-token-that-is-at-least-32-characters";
const PATH_PLAN_ID = "10000000-0000-4000-8000-000000000001";
const BODY_PLAN_ID = "10000000-0000-4000-8000-000000000002";
const PATH_ORDER_ID = "10000000-0000-4000-8000-000000000003";
const BODY_ORDER_ID = "10000000-0000-4000-8000-000000000004";
const APPROVAL_ID = "10000000-0000-4000-8000-000000000005";

describe("OrdersController", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("orders snapshot을 service token과 no-store 경계로 제공한다", async () => {
    const harness = await createHarness();
    app = harness.app;

    const unauthorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/orders",
    });
    const authorized = await harness.fastify.inject({
      method: "GET",
      url: "/internal/v1/orders",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.headers["cache-control"]).toBe("no-store");
    expect(OrdersSnapshotSchema.safeParse(authorized.json()).success).toBe(true);
  });

  it.each([
    {
      name: "Live 승인",
      path: `/internal/v1/rebalance-plans/${PATH_PLAN_ID}/live-approvals`,
      payload: {
        planId: BODY_PLAN_ID,
        planHash: "a".repeat(64),
        confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
      },
      method: "createLivePlanApproval" as const,
      message: "경로의 계획 ID와 승인 입력의 계획 ID가 일치해야 합니다.",
    },
    {
      name: "계획 실행",
      path: `/internal/v1/rebalance-plans/${PATH_PLAN_ID}/execute`,
      payload: { planId: BODY_PLAN_ID, mode: "LIVE", approvalIds: [APPROVAL_ID] },
      method: "execute" as const,
      message: "경로의 계획 ID와 실행 입력의 계획 ID가 일치해야 합니다.",
    },
    {
      name: "주문 취소",
      path: `/internal/v1/orders/${PATH_ORDER_ID}/cancel`,
      payload: {
        orderId: BODY_ORDER_ID,
        reason: "사용자가 미체결 주문 취소를 요청했습니다.",
        confirmation: "미체결 주문 취소를 요청합니다",
      },
      method: "cancel" as const,
      message: "경로의 주문 ID와 취소 입력의 주문 ID가 일치해야 합니다.",
    },
    {
      name: "UNKNOWN_BLOCKED 복구",
      path: `/internal/v1/orders/${PATH_ORDER_ID}/recover`,
      payload: {
        orderId: BODY_ORDER_ID,
        resolvedState: "PENDING",
        brokerEvidenceReference: "operator-reviewed-order",
        brokerOrderId: "broker-order-1",
        limitPriceMinor: "10000",
        filledQuantity: "0",
        filledGrossMinor: "0",
        feeMinor: "0",
      },
      method: "recoverUnknown" as const,
      message: "경로의 주문 ID와 복구 입력의 주문 ID가 일치해야 합니다.",
    },
  ])("$name path/body ID 불일치는 service 호출 전에 400으로 거부한다", async (testCase) => {
    const harness = await createHarness();
    app = harness.app;

    const response = await harness.fastify.inject({
      method: "POST",
      url: testCase.path,
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      payload: testCase.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "ORDER_INPUT_INVALID",
      message: testCase.message,
    });
    expect(harness.service[testCase.method]).not.toHaveBeenCalled();
  });

  it("Live 승인 route는 service token 외 최근 운영자 재인증 헤더도 요구한다", async () => {
    const harness = await createHarness();
    app = harness.app;
    const payload = {
      planId: PATH_PLAN_ID,
      planHash: "a".repeat(64),
      confirmation: "LIVE 주문 계획과 금액을 확인했습니다",
    };
    const missingOperator = await harness.fastify.inject({
      method: "POST",
      url: `/internal/v1/rebalance-plans/${PATH_PLAN_ID}/live-approvals`,
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
      },
      payload,
    });
    const authorized = await harness.fastify.inject({
      method: "POST",
      url: `/internal/v1/rebalance-plans/${PATH_PLAN_ID}/live-approvals`,
      headers: {
        authorization: `Bearer ${SERVICE_TOKEN}`,
        "content-type": "application/json",
        ...operatorHeaders(),
      },
      payload,
    });

    expect(missingOperator.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(harness.service.createLivePlanApproval).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ operatorId: "fred" }),
    );
  });
});

async function createHarness() {
  const snapshot = OrdersSnapshotSchema.parse({
    state: "EMPTY",
    killSwitch: "UNKNOWN",
    orders: [],
    liveOrdersEnabled: false,
  });
  const service = {
    snapshot: vi.fn().mockResolvedValue(snapshot),
    createLivePlanApproval: vi.fn(),
    execute: vi.fn(),
    setKillSwitch: vi.fn(),
    cancel: vi.fn(),
    recoverUnknown: vi.fn(),
  };
  const testingModule = await Test.createTestingModule({
    controllers: [OrdersController],
    providers: [
      ServiceTokenGuard,
      { provide: OrdersService, useValue: service },
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
