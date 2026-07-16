import { describe, expect, it } from "vitest";

import {
  createTossManagedFetch,
  type TossResponseMetadata,
} from "@portfolio-rebalancer/broker-toss";

import { TossRequestAuditContext } from "./toss-request-audit.context";

describe("TossRequestAuditContext", () => {
  it("재시도는 같은 ordinal을 유지하고 동일 operation의 다른 요청은 다음 ordinal을 받는다", () => {
    const context = new TossRequestAuditContext();

    context.run(
      {
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
      },
      () => {
        const firstAttempt = context.resolve(metadata("getBuyingPower", 7, 1));
        const retryAttempt = context.resolve(metadata("getBuyingPower", 7, 2));
        const parallelRequest = context.resolve(metadata("getBuyingPower", 8, 1));
        const otherOperation = context.resolve(metadata("getHoldings", 9, 1));

        expect(firstAttempt.ordinal).toBe(0);
        expect(retryAttempt.ordinal).toBe(0);
        expect(parallelRequest.ordinal).toBe(1);
        expect(otherOperation.ordinal).toBe(0);
        expect(firstAttempt.redactedRequestSummary).toEqual({
          method: "GET",
          path: "/api/v1/buying-power",
        });
      },
    );
  });

  it("collection run 연결 전후 상태를 같은 correlation context에서 변경한다", () => {
    const context = new TossRequestAuditContext();

    context.run(
      {
        workflowType: "PORTFOLIO_COLLECTION",
        correlationId: "11111111-1111-4111-8111-111111111111",
      },
      () => {
        expect(context.currentWorkflow()?.collectionRunId).toBeNull();
        expect(context.resolve(metadata("getAccounts", 0, 1)).collectionRunId).toBeNull();

        context.attachCollectionRunId("22222222-2222-4222-8222-222222222222");

        expect(context.currentWorkflow()?.collectionRunId).toBe(
          "22222222-2222-4222-8222-222222222222",
        );
        expect(context.resolve(metadata("getHoldings", 1, 1)).collectionRunId).toBe(
          "22222222-2222-4222-8222-222222222222",
        );
      },
    );
    expect(context.currentWorkflow()).toBeNull();
  });

  it("동시에 실행되는 workflow의 correlation과 ordinal 상태를 격리한다", async () => {
    const context = new TossRequestAuditContext();

    const resolved = await Promise.all(
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map(
        (correlationId) =>
          context.run({ workflowType: "PORTFOLIO_COLLECTION", correlationId }, async () => {
            await Promise.resolve();
            return context.resolve(metadata("getAccounts", 0, 1));
          }),
      ),
    );

    expect(resolved.map((item) => item.correlationId)).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(resolved.map((item) => item.ordinal)).toEqual([0, 0]);
  });

  it("전역 rate-group 큐에서 대기한 요청도 시작한 workflow context를 유지한다", async () => {
    const context = new TossRequestAuditContext();
    const observed: { readonly correlationId: string; readonly requestSequence: number }[] = [];
    const managedFetch = createTossManagedFetch(
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      {
        onResponseMetadata: (entry) => {
          const audit = context.resolve(entry);
          observed.push({
            correlationId: audit.correlationId,
            requestSequence: entry.requestSequence,
          });
        },
      },
    );

    await Promise.all(
      ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"].map(
        (correlationId) =>
          context.run({ workflowType: "PORTFOLIO_COLLECTION", correlationId }, async () => {
            await managedFetch("https://openapi.tossinvest.com/api/v1/accounts");
          }),
      ),
    );

    expect(observed).toEqual([
      {
        correlationId: "11111111-1111-4111-8111-111111111111",
        requestSequence: 0,
      },
      {
        correlationId: "22222222-2222-4222-8222-222222222222",
        requestSequence: 1,
      },
    ]);
  });

  it("workflow context 밖의 Toss 요청 metadata는 기록 생략 대신 차단한다", () => {
    const context = new TossRequestAuditContext();

    expect(() => context.resolve(metadata("getAccounts", 0, 1))).toThrow("workflow context");
  });
});

function metadata(
  operationId: TossResponseMetadata["operationId"],
  requestSequence: number,
  attempt: 1 | 2,
): TossResponseMetadata {
  return {
    operationId,
    requestSequence,
    staticRateLimitGroup:
      operationId === "getBuyingPower"
        ? "ORDER_INFO"
        : operationId === "getHoldings"
          ? "ASSET"
          : "ACCOUNT",
    attempt,
    startedAt: "2026-07-16T00:00:00.000Z",
    receivedAt: "2026-07-16T00:00:00.100Z",
    outcome: "SUCCESS",
    httpStatus: 200,
    requestId: null,
    rateLimitLimit: null,
    rateLimitRemaining: null,
    rateLimitResetSeconds: null,
    retryAfterSeconds: null,
    legacyRequestId: null,
    unofficialRateLimitGroup: null,
  };
}
