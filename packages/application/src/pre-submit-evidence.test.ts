import type {
  BrokerId,
  BrokerReadResult,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  PriceLimitQuote,
  PriceQuote,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import { decimal } from "@portfolio-rebalancer/domain";
import { describe, expect, it } from "vitest";

import { evaluatePreSubmitOrderEvidence } from "./pre-submit-evidence";

const symbol = "005930" as SymbolCode;
const now = new Date("2026-07-16T10:00:10+09:00");

describe("evaluatePreSubmitOrderEvidence", () => {
  it("최신 시세·가격 제한·정규장과 가격 변동 한도를 모두 통과한다", () => {
    const result = evaluatePreSubmitOrderEvidence(fixture());
    expect(result).toMatchObject({
      status: "READY",
      canSubmit: true,
      reservation: {
        canReserve: true,
        plannedGrossMinor: 20_000n,
        reservedGrossMinor: 26_000n,
      },
    });
  });

  it("오래된 현재 시세와 급변 가격은 동시에 차단 이유를 남긴다", () => {
    const input = fixture();
    const result = evaluatePreSubmitOrderEvidence({
      ...input,
      currentQuote: read(
        quote("12000", "2026-07-16T10:00:02+09:00"),
        "getPrices",
        "2026-07-16T10:00:03+09:00",
      ),
      quoteMaxAgeMs: 5_000,
    });

    expect(result.canSubmit).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "QUOTE_STALE", outcome: "BLOCKED" }),
        expect.objectContaining({
          code: "PRICE_MOVEMENT_LIMIT_EXCEEDED",
          outcome: "BLOCKED",
        }),
      ]),
    );
  });

  it("장 마감·가격 제한 누락·종목 불일치는 모두 fail closed 한다", () => {
    const input = fixture();
    const result = evaluatePreSubmitOrderEvidence({
      ...input,
      currentQuote: read(
        { ...input.currentQuote.value, symbol: "000660" as SymbolCode },
        "getPrices",
        "2026-07-16T10:00:06+09:00",
      ),
      priceLimit: read(
        { ...input.priceLimit.value, lowerLimitPrice: null, upperLimitPrice: null },
        "getPriceLimit",
        "2026-07-16T10:00:06+09:00",
      ),
      now: new Date("2026-07-16T16:00:00+09:00"),
    });

    expect(result.canSubmit).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PRE_SUBMIT_EVIDENCE_IDENTITY_MISMATCH" }),
        expect.objectContaining({ code: "MARKET_CLOSED" }),
        expect.objectContaining({ code: "ORDER_PRICE_OUTSIDE_DAILY_LIMITS" }),
        expect.objectContaining({ code: "SELL_UPPER_PRICE_LIMIT_MISSING" }),
      ]),
    );
  });
});

function fixture() {
  return {
    order: {
      marketCountry: "KR" as const,
      currency: "KRW" as const,
      symbol,
      side: "SELL" as const,
      quantity: 2n,
      limitPriceMinor: 10_000n,
    },
    plannedQuote: read(
      quote("10000", "2026-07-16T10:00:00+09:00"),
      "getPrices",
      "2026-07-16T10:00:01+09:00",
    ),
    currentQuote: read(
      quote("10050", "2026-07-16T10:00:05+09:00"),
      "getPrices",
      "2026-07-16T10:00:06+09:00",
    ),
    priceLimit: read<PriceLimitQuote>(
      {
        marketCountry: "KR",
        symbol,
        currency: "KRW",
        lowerLimitPrice: decimal("7000"),
        upperLimitPrice: decimal("13000"),
        observedAt: "2026-07-16T10:00:05+09:00" as IsoDateTime,
      },
      "getPriceLimit",
      "2026-07-16T10:00:06+09:00",
    ),
    calendar: read(calendar(), "getKrMarketCalendar", "2026-07-16T09:00:00+09:00"),
    now,
    quoteMaxAgeMs: 30_000,
    calendarMaxAgeMs: 86_400_000,
    futureToleranceMs: 2_000,
    maxAbsolutePriceChangeBasisPoints: 100n,
  };
}

function quote(price: string, observedAt: string): PriceQuote {
  return {
    marketCountry: "KR",
    symbol,
    currency: "KRW",
    price: decimal(price),
    observedAt: observedAt as IsoDateTime,
  };
}

function calendar(): MarketCalendar {
  return {
    marketCountry: "KR",
    today: {
      date: "2026-07-16" as IsoDate,
      sessions: [
        {
          kind: "REGULAR_MARKET",
          startAt: "2026-07-16T09:00:00+09:00" as IsoDateTime,
          endAt: "2026-07-16T15:30:00+09:00" as IsoDateTime,
          auctionStartAt: "2026-07-16T15:20:00+09:00" as IsoDateTime,
          auctionEndAt: "2026-07-16T15:30:00+09:00" as IsoDateTime,
        },
      ],
    },
    previousBusinessDay: { date: "2026-07-15" as IsoDate, sessions: [] },
    nextBusinessDay: { date: "2026-07-17" as IsoDate, sessions: [] },
  };
}

function read<Value>(
  value: Value,
  operationId: string,
  receivedAt: string,
): BrokerReadResult<Value> {
  return {
    value,
    metadata: {
      brokerId: "toss" as BrokerId,
      operationId,
      requestId: `request-${operationId}`,
      httpStatus: 200,
      rateLimitGroup: "MARKET_DATA",
      receivedAt: receivedAt as IsoDateTime,
      auditReference: `audit-${operationId}`,
    },
  };
}
