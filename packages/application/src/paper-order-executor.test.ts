import type {
  AccountId,
  BrokerId,
  BrokerReadResult,
  CommissionRateSchedule,
  IsoDate,
  IsoDateTime,
  OrderBookLevel,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import { decimal } from "@portfolio-rebalancer/domain";
import { describe, expect, it } from "vitest";

import {
  PAPER_EXECUTION_FIXTURE_VERSION,
  PAPER_LIMIT_FILL_POLICY_VERSION,
  PaperOrderExecutor,
  simulatePaperLimitDayOrder,
  type PaperLimitExecutionInput,
} from "./paper-order-executor";

describe("simulatePaperLimitDayOrder", () => {
  it("BUY는 이후의 ask를 가격 우선으로 소비해 전량 체결한다", () => {
    const result = simulatePaperLimitDayOrder(
      fixture({
        side: "BUY",
        remainingQuantity: 5n,
        limitPriceMinor: 101n,
        asks: [level("101", "4"), level("100", "3"), level("102", "100")],
      }),
    );

    expect(result).toMatchObject({
      policyVersion: PAPER_LIMIT_FILL_POLICY_VERSION,
      decision: "FILLED",
      reasonCode: "LIMIT_FULLY_FILLED",
      normalizedTransition: {
        from: "PENDING",
        to: "FILLED",
        applied: true,
      },
      fill: {
        quantity: 5n,
        remainingQuantity: 0n,
        grossNotionalMinor: 502n,
        commissionMinor: 1n,
        netCashDeltaMinor: -503n,
        executions: [
          { priceMinor: 100n, quantity: 3n, notionalMinor: 300n },
          { priceMinor: 101n, quantity: 2n, notionalMinor: 202n },
        ],
      },
      rawState: {
        broker: null,
        source: {
          kind: "PAPER_ORDERBOOK_REPLAY",
          value: "PAPER_LIMIT_FULL_FILL",
        },
      },
    });
    expect(result.evidence.limitations).toContain("NO_OHLC_FILL_INFERENCE");
    expect(result.evidence.qualifyingBookQuantity).toBe(7n);
  });

  it("BUY 지정가가 best ask를 통과하지 않으면 상태를 바꾸지 않는다", () => {
    const result = simulatePaperLimitDayOrder(
      fixture({
        side: "BUY",
        remainingQuantity: 2n,
        limitPriceMinor: 99n,
        asks: [level("100", "10")],
      }),
    );

    expect(result.decision).toBe("NO_FILL");
    expect(result.reasonCode).toBe("LIMIT_NOT_CROSSED");
    expect(result.normalizedTransition).toEqual({
      from: "PENDING",
      to: "PENDING",
      applied: false,
    });
    expect(result.fill).toEqual({
      quantity: 0n,
      remainingQuantity: 2n,
      grossNotionalMinor: 0n,
      commissionMinor: 0n,
      netCashDeltaMinor: 0n,
      executions: [],
    });
  });

  it("호가가 교차해도 이후 quote가 지정가를 통과하지 않으면 체결하지 않는다", () => {
    const result = simulatePaperLimitDayOrder(
      fixture({
        side: "BUY",
        remainingQuantity: 1n,
        limitPriceMinor: 100n,
        quotePrice: "101",
        asks: [level("100", "1")],
      }),
    );

    expect(result.decision).toBe("NO_FILL");
    expect(result.reasonCode).toBe("LIMIT_NOT_CROSSED");
    expect(result.fill.quantity).toBe(0n);
  });

  it("SELL은 이후의 bid만 사용하고 결정적으로 부분체결한다", () => {
    const result = simulatePaperLimitDayOrder(
      fixture({
        side: "SELL",
        remainingQuantity: 5n,
        limitPriceMinor: 100n,
        bids: [level("99", "100"), level("101", "2"), level("102", "1")],
      }),
    );

    expect(result.decision).toBe("PARTIAL_FILLED");
    expect(result.reasonCode).toBe("LIMIT_PARTIALLY_FILLED");
    expect(result.normalizedTransition.to).toBe("PARTIAL_FILLED");
    expect(result.fill).toEqual({
      quantity: 3n,
      remainingQuantity: 2n,
      grossNotionalMinor: 304n,
      commissionMinor: 1n,
      netCashDeltaMinor: 303n,
      executions: [
        { priceMinor: 102n, quantity: 1n, notionalMinor: 102n },
        { priceMinor: 101n, quantity: 2n, notionalMinor: 202n },
      ],
    });
  });

  it("부분체결을 끄면 전량에 부족한 호가 잔량을 미체결로 남긴다", () => {
    const result = simulatePaperLimitDayOrder({
      ...fixture({
        side: "SELL",
        remainingQuantity: 5n,
        limitPriceMinor: 100n,
        bids: [level("101", "2")],
      }),
      partialFillPolicy: {
        enabled: false,
        bookParticipationBasisPoints: 10_000n,
      },
    });

    expect(result.decision).toBe("NO_FILL");
    expect(result.reasonCode).toBe("FILLABLE_LIQUIDITY_INSUFFICIENT");
    expect(result.evidence.simulatedAvailableQuantity).toBe(2n);
  });

  it("오래된 quote나 orderbook은 체결 대신 fail closed 한다", () => {
    const input = fixture({
      side: "BUY",
      remainingQuantity: 1n,
      limitPriceMinor: 100n,
      asks: [level("100", "1")],
    });
    const result = simulatePaperLimitDayOrder({
      ...input,
      evaluatedAt: isoDateTime("2026-07-16T00:05:00.000Z"),
      freshnessPolicy: {
        maxEvidenceAgeMs: 60_000,
        futureToleranceMs: 1_000,
      },
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.reasonCode).toBe("QUOTE_STALE");
    expect(result.normalizedTransition.applied).toBe(false);
    expect(result.fill.quantity).toBe(0n);
  });

  it("provider observedAt이 없으면 수신 시각만으로 체결하지 않는다", () => {
    const input = fixture({
      side: "BUY",
      remainingQuantity: 1n,
      limitPriceMinor: 100n,
      asks: [level("100", "1")],
    });
    const result = simulatePaperLimitDayOrder({
      ...input,
      quote: {
        ...required(input.quote),
        value: { ...required(input.quote).value, observedAt: null },
      },
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.reasonCode).toBe("QUOTE_OBSERVED_AT_MISSING");
    expect(result.rawState.source.value).toBe("PAPER_EXECUTION_BLOCKED");
  });

  it("quote나 orderbook이 없으면 가격을 추정하지 않고 차단한다", () => {
    const input = fixture({
      side: "BUY",
      remainingQuantity: 1n,
      limitPriceMinor: 100n,
      asks: [level("100", "1")],
    });

    expect(simulatePaperLimitDayOrder({ ...input, quote: null }).reasonCode).toBe("QUOTE_MISSING");
    expect(simulatePaperLimitDayOrder({ ...input, orderBook: null }).reasonCode).toBe(
      "ORDERBOOK_MISSING",
    );
  });

  it("minor unit 미만의 양수 수수료를 올림하고 BUY 현금 소요에 포함한다", () => {
    const result = simulatePaperLimitDayOrder(
      fixture({
        side: "BUY",
        remainingQuantity: 1n,
        limitPriceMinor: 1n,
        quotePrice: "1",
        asks: [level("1", "1")],
      }),
    );

    expect(result.decision).toBe("FILLED");
    expect(result.fill.grossNotionalMinor).toBe(1n);
    expect(result.fill.commissionMinor).toBe(1n);
    expect(result.fill.netCashDeltaMinor).toBe(-2n);
  });

  it("OrderExecutor 경계도 같은 고정 fixture 결과를 반환한다", async () => {
    const input = fixture({
      side: "BUY",
      remainingQuantity: 1n,
      limitPriceMinor: 100n,
      asks: [level("100", "1")],
    });

    await expect(new PaperOrderExecutor().execute(input)).resolves.toEqual(
      simulatePaperLimitDayOrder(input),
    );
  });
});

function fixture(options: {
  readonly side: "BUY" | "SELL";
  readonly remainingQuantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly quotePrice?: string;
  readonly bids?: readonly OrderBookLevel[];
  readonly asks?: readonly OrderBookLevel[];
}): PaperLimitExecutionInput {
  const symbol = "005930" as SymbolCode;
  const observedAt = isoDateTime("2026-07-16T00:00:10.000Z");
  const receivedAt = isoDateTime("2026-07-16T00:00:11.000Z");
  return {
    fixtureVersion: PAPER_EXECUTION_FIXTURE_VERSION,
    order: {
      logicalOrderId: "logical-order-1",
      currentState: "PENDING",
      marketCountry: "KR",
      currency: "KRW",
      symbol,
      side: options.side,
      orderType: "LIMIT",
      timeInForce: "DAY",
      remainingQuantity: options.remainingQuantity,
      limitPriceMinor: options.limitPriceMinor,
      submittedAt: isoDateTime("2026-07-16T00:00:00.000Z"),
      tradeDate: "2026-07-16" as IsoDate,
    },
    evaluatedAt: isoDateTime("2026-07-16T00:00:12.000Z"),
    freshnessPolicy: {
      maxEvidenceAgeMs: 60_000,
      futureToleranceMs: 1_000,
    },
    partialFillPolicy: {
      enabled: true,
      bookParticipationBasisPoints: 10_000n,
    },
    quote: readResult(
      {
        marketCountry: "KR",
        symbol,
        price: decimal(options.quotePrice ?? "100"),
        currency: "KRW",
        observedAt,
      },
      "get-current-price",
      receivedAt,
    ),
    orderBook: readResult(
      {
        marketCountry: "KR",
        symbol,
        currency: "KRW",
        bids: options.bids ?? [level("99", "100")],
        asks: options.asks ?? [level("101", "100")],
        observedAt,
      },
      "get-orderbook",
      receivedAt,
    ),
    commissionSchedule: schedule(),
  };
}

function level(price: string, quantity: string): OrderBookLevel {
  return {
    price: decimal(price),
    quantity: decimal(quantity),
  };
}

function readResult<Value>(
  value: Value,
  operationId: string,
  receivedAt: IsoDateTime,
): BrokerReadResult<Value> {
  return {
    value,
    metadata: {
      brokerId: "toss" as BrokerId,
      operationId,
      requestId: `request-${operationId}`,
      httpStatus: 200,
      rateLimitGroup: "quotes",
      receivedAt,
      auditReference: `audit-${operationId}`,
    },
  };
}

function schedule(): CommissionRateSchedule {
  return {
    accountId: "account-1" as AccountId,
    periods: [
      {
        marketCountry: "KR",
        commissionRatePercent: decimal("0.015"),
        startDate: null,
        endDate: null,
      },
    ],
  };
}

function isoDateTime(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function required<Value>(value: Value | null): Value {
  if (value === null) throw new Error("테스트 fixture 값이 필요합니다.");
  return value;
}
