import { describe, expect, it } from "vitest";

import { createTossClientOrderId, type CanonicalOrderIntent } from "./client-order-id";

const intent: CanonicalOrderIntent = {
  logicalOrderId: "11111111-1111-4111-8111-111111111111",
  rebalanceRunId: "22222222-2222-4222-8222-222222222222",
  planVersion: 1,
  phase: "SELL",
  marketCountry: "KR",
  symbol: "005930",
  side: "SELL",
  orderType: "LIMIT",
  timeInForce: "DAY",
  quantity: "1",
  price: "72000",
};

describe("createTossClientOrderId", () => {
  it("같은 canonical 주문 의도에서 허용 문자 36자 ID를 재현한다", () => {
    const first = createTossClientOrderId(intent);
    const second = createTossClientOrderId({ ...intent });

    expect(first).toBe(second);
    expect(first).toHaveLength(36);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.startsWith("pr1_")).toBe(true);
  });

  it.each([
    ["수량", { quantity: "2" }],
    ["가격", { price: "72100" }],
    ["방향", { side: "BUY" as const, phase: "BUY" as const }],
    ["계획 버전", { planVersion: 2 }],
    ["논리 주문", { logicalOrderId: "33333333-3333-4333-8333-333333333333" }],
  ])("%s이 달라지면 다른 ID를 만든다", (_label, change) => {
    expect(createTossClientOrderId({ ...intent, ...change })).not.toBe(
      createTossClientOrderId(intent),
    );
  });

  it("시장가에 가격을 넣거나 0 수량을 사용하면 생성하지 않는다", () => {
    expect(() =>
      createTossClientOrderId({ ...intent, orderType: "MARKET", price: "72000" }),
    ).toThrow("canonical 주문 의도");
    expect(() => createTossClientOrderId({ ...intent, quantity: "0" })).toThrow(
      "canonical 주문 의도",
    );
  });
});
