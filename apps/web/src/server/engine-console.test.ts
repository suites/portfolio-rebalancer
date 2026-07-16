import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cancelEngineOrder } from "./engine-console";
import type { EngineConsoleRequestError } from "./engine-console";

describe("engine console operator audit headers", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_INTERNAL_URL", "http://127.0.0.1:4100");
    vi.stubEnv("ENGINE_SERVICE_TOKEN", "service-token-for-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("위험 요청은 브라우저 입력이 아닌 검증된 operator context를 내부 헤더로 전달한다", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          orderId: "10000000-0000-4000-8000-000000000001",
          outcome: "UNKNOWN",
          currentState: "UNKNOWN",
          brokerActionOrderId: null,
          message: "취소 결과를 확정하지 못했습니다.",
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const operator = {
      operatorId: "fred",
      sessionId: "10000000-0000-4000-8000-000000000099",
      authenticatedAt: "2026-07-16T03:00:00.000Z",
      reauthenticatedAt: "2026-07-16T03:04:00.000Z",
    };

    await cancelEngineOrder(
      {
        orderId: "10000000-0000-4000-8000-000000000001",
        reason: "현재 미체결 주문을 중단합니다.",
        confirmation: "미체결 주문 취소를 요청합니다",
      },
      operator,
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({
      authorization: "Bearer service-token-for-test",
      "x-portfolio-operator-id": "fred",
      "x-portfolio-operator-session-id": "10000000-0000-4000-8000-000000000099",
      "x-portfolio-operator-authenticated-at": "2026-07-16T03:00:00.000Z",
      "x-portfolio-operator-reauthenticated-at": "2026-07-16T03:04:00.000Z",
    });
  });

  it("HTTP 200이어도 다른 주문의 receipt면 성공으로 사용하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            orderId: "20000000-0000-4000-8000-000000000001",
            outcome: "REQUEST_ACCEPTED",
            currentState: "PENDING",
            brokerActionOrderId: "cancel-1",
            message: "accepted",
          }),
        ),
      ),
    );

    await expect(
      cancelEngineOrder(
        {
          orderId: "10000000-0000-4000-8000-000000000001",
          reason: "현재 미체결 주문을 중단합니다.",
          confirmation: "미체결 주문 취소를 요청합니다",
        },
        {
          operatorId: "fred",
          sessionId: "10000000-0000-4000-8000-000000000099",
          authenticatedAt: "2026-07-16T03:00:00.000Z",
          reauthenticatedAt: "2026-07-16T03:04:00.000Z",
        },
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "ENGINE_RECEIPT_MISMATCH",
    } satisfies Partial<EngineConsoleRequestError>);
  });
});
