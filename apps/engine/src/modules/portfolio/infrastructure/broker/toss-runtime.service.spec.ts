import { describe, expect, it, vi } from "vitest";

import {
  createTossManagedFetch,
  type TossResponseMetadata,
} from "@portfolio-rebalancer/broker-toss";

import type { EngineConfig } from "../../../../config/engine.config";
import type { PrismaPortfolioRepository } from "../persistence/prisma-portfolio.repository";

const mocks = vi.hoisted(() => ({
  createTossReadSource: vi.fn(),
}));

vi.mock("./toss-read-source.adapter", () => ({
  createTossReadSource: mocks.createTossReadSource,
}));

import { TossRuntimeService } from "./toss-runtime.service";

describe("TossRuntimeService request audit", () => {
  it("재시도와 병렬 동일 operation을 append-only ordinal/attempt로 저장한다", async () => {
    const appendBrokerRequestAttempt = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: "attempt" });
    mocks.createTossReadSource.mockReturnValue(sourceStub());
    const service = new TossRuntimeService(config(), {
      appendBrokerRequestAttempt,
    } as unknown as PrismaPortfolioRepository);
    const runtime = service.get();
    const callback = createdMetadataCallback();

    await runtime.requestAuditContext.run(
      {
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
      },
      async () => {
        await callback(metadata("getAccounts", 0, 1, "SUCCESS", 200));
        runtime.requestAuditContext.attachCollectionRunId("22222222-2222-4222-8222-222222222222");
        await Promise.all([
          callback(metadata("getBuyingPower", 10, 1, "HTTP_ERROR", 429)),
          callback(metadata("getBuyingPower", 10, 2, "SUCCESS", 200)),
          callback(metadata("getBuyingPower", 11, 1, "SUCCESS", 200)),
        ]);
      },
    );

    expect(appendBrokerRequestAttempt).toHaveBeenCalledTimes(4);
    expect(appendBrokerRequestAttempt.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
        collectionRunId: null,
        operationId: "getAccounts",
        ordinal: 0,
        attempt: 1,
        outcome: "SUCCEEDED",
        safeErrorCode: null,
        redactedRequestSummary: {
          method: "GET",
          path: "/api/v1/accounts",
        },
      }),
      expect.objectContaining({
        collectionRunId: "22222222-2222-4222-8222-222222222222",
        operationId: "getBuyingPower",
        ordinal: 0,
        attempt: 1,
        outcome: "HTTP_ERROR",
        safeErrorCode: "TOSS_API_RESPONSE_ERROR",
      }),
      expect.objectContaining({
        operationId: "getBuyingPower",
        ordinal: 0,
        attempt: 2,
        outcome: "SUCCEEDED",
      }),
      expect.objectContaining({
        operationId: "getBuyingPower",
        ordinal: 1,
        attempt: 1,
        outcome: "SUCCEEDED",
        redactedRequestSummary: {
          method: "GET",
          path: "/api/v1/buying-power",
        },
      }),
    ]);
  });

  it("timeout과 network outcome을 안전 오류 코드로 저장한다", async () => {
    const appendBrokerRequestAttempt = vi
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({ id: "attempt" });
    mocks.createTossReadSource.mockReturnValue(sourceStub());
    const runtime = new TossRuntimeService(config(), {
      appendBrokerRequestAttempt,
    } as unknown as PrismaPortfolioRepository).get();
    const callback = createdMetadataCallback();

    await runtime.requestAuditContext.run(
      {
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
      },
      async () => {
        await callback(metadata("getHoldings", 0, 1, "TIMEOUT", null));
        await callback(metadata("getExchangeRate", 1, 1, "NETWORK_ERROR", null));
      },
    );

    expect(appendBrokerRequestAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        outcome: "TIMEOUT",
        httpStatus: null,
        safeErrorCode: "TOSS_API_TIMEOUT",
      }),
    );
    expect(appendBrokerRequestAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        outcome: "NETWORK_ERROR",
        httpStatus: null,
        safeErrorCode: "TOSS_API_NETWORK_FAILED",
      }),
    );
  });

  it("workflow context 밖의 공용 source 호출은 감사 누락 대신 차단한다", async () => {
    const appendBrokerRequestAttempt = vi.fn();
    mocks.createTossReadSource.mockReturnValue(sourceStub());
    new TossRuntimeService(config(), {
      appendBrokerRequestAttempt,
    } as unknown as PrismaPortfolioRepository).get();

    await expect(
      createdMetadataCallback()(metadata("getStocks", 0, 1, "SUCCESS", 200)),
    ).rejects.toThrow("workflow context");

    expect(appendBrokerRequestAttempt).not.toHaveBeenCalled();
  });

  it("repository append 실패를 callback 밖에서 숨기지 않는다", async () => {
    const appendBrokerRequestAttempt = vi
      .fn()
      .mockRejectedValue(new Error("audit database unavailable"));
    mocks.createTossReadSource.mockReturnValue(sourceStub());
    const runtime = new TossRuntimeService(config(), {
      appendBrokerRequestAttempt,
    } as unknown as PrismaPortfolioRepository).get();
    const callback = createdMetadataCallback();
    const managedFetch = createTossManagedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      { onResponseMetadata: callback },
    );

    await expect(
      runtime.requestAuditContext.run(
        {
          workflowType: "PORTFOLIO_COLLECTION",
          correlationId: "11111111-1111-4111-8111-111111111111",
        },
        async () => managedFetch("https://openapi.tossinvest.com/api/v1/accounts"),
      ),
    ).rejects.toMatchObject({ code: "TOSS_REQUEST_AUDIT_FAILED" });
  });
});

function createdMetadataCallback(): (metadata: TossResponseMetadata) => Promise<void> {
  const options = mocks.createTossReadSource.mock.calls.at(-1)?.[0] as
    | {
        readonly onResponseMetadata?: (metadata: TossResponseMetadata) => void | Promise<void>;
      }
    | undefined;
  const callback = options?.onResponseMetadata;
  if (!callback) throw new Error("onResponseMetadata callback이 생성되지 않았습니다.");
  return async (metadata) => {
    await callback(metadata);
  };
}

function metadata(
  operationId: TossResponseMetadata["operationId"],
  requestSequence: number,
  attempt: 1 | 2,
  outcome: TossResponseMetadata["outcome"],
  httpStatus: number | null,
): TossResponseMetadata {
  return {
    operationId,
    requestSequence,
    staticRateLimitGroup: rateLimitGroup(operationId),
    attempt,
    startedAt: "2026-07-16T00:00:00.000Z",
    receivedAt: "2026-07-16T00:00:00.100Z",
    outcome,
    httpStatus,
    requestId: httpStatus === null ? null : "synthetic-request-id",
    rateLimitLimit: 10,
    rateLimitRemaining: outcome === "HTTP_ERROR" ? 0 : 9,
    rateLimitResetSeconds: 1,
    retryAfterSeconds: outcome === "HTTP_ERROR" ? 1 : null,
    legacyRequestId: null,
    unofficialRateLimitGroup: null,
  };
}

function rateLimitGroup(
  operationId: TossResponseMetadata["operationId"],
): TossResponseMetadata["staticRateLimitGroup"] {
  switch (operationId) {
    case "getAccounts":
      return "ACCOUNT";
    case "getBuyingPower":
      return "ORDER_INFO";
    case "getHoldings":
      return "ASSET";
    case "getExchangeRate":
      return "MARKET_INFO";
    case "getStocks":
      return "STOCK";
    default:
      throw new Error(`테스트 rate group이 없습니다: ${operationId}`);
  }
}

function config(): EngineConfig {
  return {
    TOSSINVEST_CLIENT_ID: "synthetic-client",
    TOSSINVEST_CLIENT_SECRET: "synthetic-secret",
    ACCOUNT_REFERENCE_KEY: "synthetic-reference-key",
  } as EngineConfig;
}

function sourceStub() {
  return {
    listAccounts: vi.fn(),
    getHoldings: vi.fn(),
    getBuyingPower: vi.fn(),
    getUsdKrwRate: vi.fn(),
    getStocks: vi.fn(),
    getStockWarnings: vi.fn(),
  };
}
