import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ConsoleRecordsSnapshotSchema,
  OrdersSnapshotSchema,
} from "@portfolio-rebalancer/contracts";

import { OrdersScreen } from "./orders-screen";

vi.mock("@/app/(console)/actions", () => ({
  cancelOrderAction: vi.fn(),
  reconcileOrderAction: vi.fn(),
  recoverUnknownOrderAction: vi.fn(),
}));

describe("OrdersScreen", () => {
  it("실제 Live PENDING 원장에는 상태 이력, 조정과 명시적 취소 확인을 표시한다", () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        records={records()}
        orders={OrdersSnapshotSchema.parse({
          state: "READY",
          killSwitch: "DISENGAGED",
          liveOrdersEnabled: true,
          orders: [
            {
              orderId: "10000000-0000-4000-8000-000000000001",
              logicalOrderId: "10000000-0000-4000-8000-000000000002",
              planId: "10000000-0000-4000-8000-000000000003",
              planOrderId: "10000000-0000-4000-8000-000000000004",
              mode: "LIVE",
              symbol: "005930",
              instrumentKey: "KR:005930",
              side: "BUY",
              quantity: "1",
              limitPriceMinor: "70000",
              plannedGrossMinor: "70000",
              reservedGrossMinor: "70000",
              clientOrderId: "a".repeat(36),
              currentState: "PENDING",
              createdAt: "2026-07-16T03:00:00+09:00",
              timeline: [
                {
                  sequence: 0,
                  state: "PLANNED",
                  brokerStatusRaw: null,
                  brokerOrderId: null,
                  brokerActionOrderId: null,
                  filledQuantity: "0",
                  filledGrossMinor: "0",
                  feeMinor: "0",
                  occurredAt: "2026-07-16T03:00:00+09:00",
                  message: "주문 계획을 원장에 저장했습니다.",
                },
                {
                  sequence: 1,
                  state: "PENDING",
                  brokerStatusRaw: "ACKNOWLEDGED",
                  brokerOrderId: "broker-order-1",
                  brokerActionOrderId: null,
                  filledQuantity: "0",
                  filledGrossMinor: "0",
                  feeMinor: "0",
                  occurredAt: "2026-07-16T03:00:01+09:00",
                  message: "브로커가 주문을 접수했습니다.",
                },
              ],
            },
          ],
        })}
        actionStatus={undefined}
      />,
    );

    expect(html).toContain("005930");
    expect(html).toContain("브로커 상태 다시 확인");
    expect(html).toContain("취소 요청 1회 전송");
    expect(html).toContain("미체결 주문 취소를 요청합니다");
    expect(html).toContain("상태 이력 2건");
  });

  it("원장 조회 실패 시 상태를 추정하지 않고 모든 작업을 숨긴다", () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        records={records()}
        orders={OrdersSnapshotSchema.parse({
          state: "UNAVAILABLE",
          killSwitch: "UNKNOWN",
          orders: [],
          liveOrdersEnabled: false,
        })}
        actionStatus={undefined}
      />,
    );

    expect(html).toContain("주문 원장을 안전하게 확인하지 못했습니다.");
    expect(html).not.toContain("취소 요청 1회 전송");
    expect(html).not.toContain("브로커 상태 다시 확인");
  });

  it("UNKNOWN_BLOCKED 복구는 원 주문 지정가를 포함한 exact 브로커 증거를 요구한다", () => {
    const html = renderToStaticMarkup(
      <OrdersScreen
        records={records()}
        orders={OrdersSnapshotSchema.parse({
          state: "READY",
          killSwitch: "DISENGAGED",
          liveOrdersEnabled: false,
          orders: [
            {
              orderId: "10000000-0000-4000-8000-000000000001",
              logicalOrderId: "10000000-0000-4000-8000-000000000002",
              planId: "10000000-0000-4000-8000-000000000003",
              planOrderId: "10000000-0000-4000-8000-000000000004",
              mode: "LIVE",
              symbol: "005930",
              instrumentKey: "KR:005930",
              side: "BUY",
              quantity: "1",
              limitPriceMinor: "70000",
              plannedGrossMinor: "70000",
              reservedGrossMinor: "70000",
              clientOrderId: "a".repeat(36),
              currentState: "UNKNOWN_BLOCKED",
              createdAt: "2026-07-16T03:00:00+09:00",
              timeline: [
                {
                  sequence: 0,
                  state: "UNKNOWN_BLOCKED",
                  brokerStatusRaw: "UNKNOWN",
                  brokerOrderId: "broker-order-1",
                  brokerActionOrderId: null,
                  filledQuantity: "0",
                  filledGrossMinor: "0",
                  feeMinor: "0",
                  occurredAt: "2026-07-16T03:10:00+09:00",
                  message: "운영자 확인이 필요합니다.",
                },
              ],
            },
          ],
        })}
        actionStatus={undefined}
      />,
    );

    expect(html).toContain('name="limitPriceWon"');
    expect(html).toContain('value="70000"');
    expect(html).toContain("원 주문 지정가");
  });
});

function records() {
  return ConsoleRecordsSnapshotSchema.parse({
    state: "READY",
    records: [],
  });
}
