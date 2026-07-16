import { describe, expectTypeOf, it } from "vitest";

import type {
  BrokerReadPorts,
  BuyingPowerReader,
  CommissionReader,
  MarketCalendarReader,
  PriceLimitReader,
  SellableQuantityReader,
} from "./ports";

describe("BrokerReadPorts", () => {
  it("가격 제한과 계좌 사전거래 조회를 역할별 포트로 노출한다", () => {
    expectTypeOf<BrokerReadPorts["priceLimits"]>().toMatchTypeOf<PriceLimitReader>();
    expectTypeOf<BrokerReadPorts["buyingPower"]>().toMatchTypeOf<BuyingPowerReader>();
    expectTypeOf<BrokerReadPorts["sellableQuantity"]>().toMatchTypeOf<SellableQuantityReader>();
    expectTypeOf<BrokerReadPorts["commissions"]>().toMatchTypeOf<CommissionReader>();
  });

  it("시장 캘린더 포트는 날짜별 캘린더를 반환한다", () => {
    expectTypeOf<BrokerReadPorts["marketCalendar"]>().toMatchTypeOf<MarketCalendarReader>();
  });

  it("각 포트는 값과 HTTP 관측 메타데이터를 함께 반환한다", () => {
    expectTypeOf<
      ReturnType<BrokerReadPorts["commissions"]["getCommissionSchedule"]>
    >().toMatchTypeOf<
      Promise<{
        readonly value: unknown;
        readonly metadata: {
          readonly operationId: string;
          readonly receivedAt: string;
        };
      }>
    >();
  });

  it("통합 preTrade 포트는 계약에 남기지 않는다", () => {
    expectTypeOf<"preTrade" extends keyof BrokerReadPorts ? true : false>().toEqualTypeOf<false>();
  });
});
