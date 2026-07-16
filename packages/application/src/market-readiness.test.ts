import { describe, expect, it } from "vitest";

import type {
  BrokerId,
  BrokerObservationMetadata,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  MarketSessionInterval,
  PriceQuote,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import { decimal } from "@portfolio-rebalancer/domain";

import { classifyMarketCalendarReadiness, evaluateQuoteFreshness } from "./market-readiness";

const fiveMinutes = 5 * 60 * 1_000;

describe("evaluateQuoteFreshness", () => {
  it("provider 관측 시각이 없으면 UNKNOWN으로 fail closed 한다", () => {
    const result = evaluateQuoteFreshness({
      quote: quote(null),
      metadata: metadata("2026-07-16T10:00:01+09:00"),
      policy: timePolicy("2026-07-16T10:01:00+09:00"),
    });

    expect(result).toMatchObject({
      status: "UNKNOWN",
      canProceed: false,
      reasonCode: "QUOTE_PROVIDER_TIME_UNKNOWN",
    });
  });

  it("최대 데이터 나이와 정확히 같은 시세는 허용하고 1ms 초과부터 차단한다", () => {
    const exactBoundary = evaluateQuoteFreshness({
      quote: quote("2026-07-16T10:00:00.000+09:00"),
      metadata: metadata("2026-07-16T10:00:00.100+09:00"),
      policy: timePolicy("2026-07-16T10:05:00.000+09:00"),
    });
    const oneMillisecondStale = evaluateQuoteFreshness({
      quote: quote("2026-07-16T10:00:00.000+09:00"),
      metadata: metadata("2026-07-16T10:00:00.100+09:00"),
      policy: timePolicy("2026-07-16T10:05:00.001+09:00"),
    });

    expect(exactBoundary).toMatchObject({
      status: "READY",
      canProceed: true,
      reasonCode: "QUOTE_FRESH",
      providerAgeMs: fiveMinutes,
    });
    expect(oneMillisecondStale).toMatchObject({
      status: "BLOCKED",
      canProceed: false,
      reasonCode: "QUOTE_STALE",
      providerAgeMs: fiveMinutes + 1,
    });
  });

  it.each([
    {
      name: "provider 관측 시각",
      quoteObservedAt: "2026-07-16T10:00:02.001+09:00" as IsoDateTime,
      receivedAt: "2026-07-16T10:00:00.000+09:00" as IsoDateTime,
      reasonCode: "QUOTE_PROVIDER_TIME_FUTURE",
    },
    {
      name: "응답 수신 시각",
      quoteObservedAt: "2026-07-16T10:00:00.000+09:00" as IsoDateTime,
      receivedAt: "2026-07-16T10:00:02.001+09:00" as IsoDateTime,
      reasonCode: "QUOTE_RECEIVED_TIME_FUTURE",
    },
  ])("$name이 허용 오차보다 미래이면 차단한다", ({ quoteObservedAt, receivedAt, reasonCode }) => {
    const result = evaluateQuoteFreshness({
      quote: quote(quoteObservedAt),
      metadata: metadata(receivedAt),
      policy: timePolicy("2026-07-16T10:00:00.000+09:00", 2_000),
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      canProceed: false,
      reasonCode,
    });
  });
});

describe("classifyMarketCalendarReadiness", () => {
  it("KR 정규장은 시작 포함, 종료 제외이며 start-only 경매는 세션 종료까지 차단한다", () => {
    const calendar = marketCalendar("KR", "2026-07-16", [
      session(
        "REGULAR_MARKET",
        "2026-07-16T09:00:00+09:00",
        "2026-07-16T15:30:00+09:00",
        "2026-07-16T15:20:00+09:00",
        null,
      ),
    ]);

    expect(
      calendarState(calendar, "2026-07-16T15:19:59.999+09:00", ["REGULAR_MARKET"]),
    ).toMatchObject({
      state: "OPEN",
      canProceed: true,
      reasonCode: "MARKET_SESSION_OPEN",
    });
    expect(
      calendarState(calendar, "2026-07-16T15:20:00.000+09:00", ["REGULAR_MARKET"]),
    ).toMatchObject({
      state: "AUCTION",
      canProceed: false,
      reasonCode: "MARKET_AUCTION_ACTIVE",
    });
    expect(
      calendarState(calendar, "2026-07-16T15:30:00.000+09:00", ["REGULAR_MARKET"]),
    ).toMatchObject({
      state: "CLOSED",
      canProceed: false,
      reasonCode: "MARKET_CLOSED",
    });
  });

  it("auction start가 없으면 세션 시작부터 auction end 직전까지 보수적으로 경매로 본다", () => {
    const calendar = marketCalendar("KR", "2026-07-16", [
      session(
        "AFTER_MARKET",
        "2026-07-16T15:30:00+09:00",
        "2026-07-16T20:00:00+09:00",
        null,
        "2026-07-16T15:40:00+09:00",
      ),
    ]);

    expect(calendarState(calendar, "2026-07-16T15:30:00+09:00", ["AFTER_MARKET"])).toMatchObject({
      state: "AUCTION",
      reasonCode: "MARKET_AUCTION_ACTIVE",
    });
    expect(calendarState(calendar, "2026-07-16T15:40:00+09:00", ["AFTER_MARKET"])).toMatchObject({
      state: "OPEN",
      reasonCode: "MARKET_SESSION_OPEN",
    });
  });

  it("명시적 auction start와 end는 각각 포함·제외 경계로 사용한다", () => {
    const calendar = marketCalendar("KR", "2026-07-16", [
      session(
        "PRE_MARKET",
        "2026-07-16T08:00:00+09:00",
        "2026-07-16T09:00:00+09:00",
        "2026-07-16T08:50:00+09:00",
        "2026-07-16T08:55:00+09:00",
      ),
    ]);

    expect(calendarState(calendar, "2026-07-16T08:50:00+09:00", ["PRE_MARKET"])).toMatchObject({
      state: "AUCTION",
      reasonCode: "MARKET_AUCTION_ACTIVE",
    });
    expect(calendarState(calendar, "2026-07-16T08:55:00+09:00", ["PRE_MARKET"])).toMatchObject({
      state: "OPEN",
      reasonCode: "MARKET_SESSION_OPEN",
    });
  });

  it("US 정규장이 KST 다음 날짜까지 이어져도 미국 현지 거래일로 OPEN을 판정한다", () => {
    const calendar = marketCalendar("US", "2026-07-16", [
      session(
        "REGULAR_MARKET",
        "2026-07-16T22:30:00+09:00",
        "2026-07-17T05:00:00+09:00",
        null,
        null,
      ),
    ]);

    expect(calendarState(calendar, "2026-07-17T02:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject({
      state: "OPEN",
      canProceed: true,
      activeSessionKind: "REGULAR_MARKET",
    });
    expect(calendarState(calendar, "2026-07-17T05:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject({
      state: "CLOSED",
      canProceed: false,
    });
  });

  it("현재 열린 세션이 허용 목록에 없으면 CLOSED로 차단한다", () => {
    const calendar = marketCalendar("KR", "2026-07-16", [
      session("PRE_MARKET", "2026-07-16T08:00:00+09:00", "2026-07-16T09:00:00+09:00", null, null),
    ]);

    expect(calendarState(calendar, "2026-07-16T08:30:00+09:00", ["REGULAR_MARKET"])).toMatchObject({
      state: "CLOSED",
      canProceed: false,
      reasonCode: "MARKET_SESSION_NOT_ALLOWED",
      activeSessionKind: "PRE_MARKET",
    });
  });

  it("KR 허용 세션의 단일가 경계가 모두 누락되면 UNKNOWN으로 차단한다", () => {
    const calendar = marketCalendar("KR", "2026-07-16", [
      session(
        "REGULAR_MARKET",
        "2026-07-16T09:00:00+09:00",
        "2026-07-16T15:30:00+09:00",
        null,
        null,
      ),
    ]);

    expect(calendarState(calendar, "2026-07-16T10:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject({
      state: "UNKNOWN",
      canProceed: false,
      reasonCode: "CALENDAR_AUCTION_BOUNDARY_MISSING",
    });
  });

  it("현재 시장 현지 날짜와 today 증거가 다르면 UNKNOWN으로 차단한다", () => {
    const calendar = marketCalendar("KR", "2026-07-15", []);

    expect(calendarState(calendar, "2026-07-16T10:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject({
      state: "UNKNOWN",
      canProceed: false,
      reasonCode: "CALENDAR_CURRENT_DAY_MISMATCH",
    });
  });

  it("현재 거래일 evidence가 누락되면 UNKNOWN으로 차단한다", () => {
    const missingToday = {
      ...marketCalendar("KR", "2026-07-16", []),
      today: undefined,
    } as unknown as MarketCalendar;

    expect(
      calendarState(missingToday, "2026-07-16T10:00:00+09:00", ["REGULAR_MARKET"]),
    ).toMatchObject({
      state: "UNKNOWN",
      canProceed: false,
      reasonCode: "CALENDAR_CURRENT_DAY_MISSING",
    });
  });

  it("세션 종료가 시작보다 빠른 malformed current-day 증거는 UNKNOWN이다", () => {
    const malformed = marketCalendar("KR", "2026-07-16", [
      session(
        "REGULAR_MARKET",
        "2026-07-16T15:30:00+09:00",
        "2026-07-16T09:00:00+09:00",
        null,
        null,
      ),
    ]);

    expect(calendarState(malformed, "2026-07-16T10:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject(
      {
        state: "UNKNOWN",
        canProceed: false,
        reasonCode: "CALENDAR_CURRENT_DAY_INVALID",
      },
    );
  });

  it("세션 객체 자체가 손상된 current-day 증거도 예외 없이 UNKNOWN이다", () => {
    const malformed = {
      ...marketCalendar("KR", "2026-07-16", []),
      today: {
        date: "2026-07-16",
        sessions: [null],
      },
    } as unknown as MarketCalendar;

    expect(calendarState(malformed, "2026-07-16T10:00:00+09:00", ["REGULAR_MARKET"])).toMatchObject(
      {
        state: "UNKNOWN",
        canProceed: false,
        reasonCode: "CALENDAR_CURRENT_DAY_INVALID",
      },
    );
  });
});

function quote(observedAt: string | null): PriceQuote {
  return {
    marketCountry: "KR",
    symbol: "005930" as SymbolCode,
    price: decimal("72000"),
    currency: "KRW",
    observedAt: observedAt as IsoDateTime | null,
  };
}

function metadata(receivedAt: string): BrokerObservationMetadata {
  return {
    brokerId: "toss" as BrokerId,
    operationId: "getPrices",
    requestId: "synthetic-request-id",
    httpStatus: 200,
    rateLimitGroup: "MARKET_DATA",
    receivedAt: receivedAt as IsoDateTime,
  };
}

function timePolicy(now: string, futureToleranceMs = 2_000) {
  return {
    now: new Date(now),
    maxAgeMs: fiveMinutes,
    futureToleranceMs,
  };
}

function session(
  kind: MarketSessionInterval["kind"],
  startAt: string,
  endAt: string,
  auctionStartAt: string | null,
  auctionEndAt: string | null,
): MarketSessionInterval {
  return {
    kind,
    startAt: startAt as IsoDateTime,
    endAt: endAt as IsoDateTime,
    auctionStartAt: auctionStartAt as IsoDateTime | null,
    auctionEndAt: auctionEndAt as IsoDateTime | null,
  };
}

function marketCalendar(
  marketCountry: MarketCalendar["marketCountry"],
  today: string,
  sessions: readonly MarketSessionInterval[],
): MarketCalendar {
  return {
    marketCountry,
    today: { date: today as IsoDate, sessions },
    previousBusinessDay: { date: "2026-07-15" as IsoDate, sessions: [] },
    nextBusinessDay: { date: "2026-07-17" as IsoDate, sessions: [] },
  };
}

function calendarState(
  calendar: MarketCalendar,
  now: string,
  allowedSessionKinds: Parameters<typeof classifyMarketCalendarReadiness>[0]["allowedSessionKinds"],
) {
  return classifyMarketCalendarReadiness({
    calendar,
    metadata: {
      ...metadata("2026-07-16T07:55:00+09:00"),
      operationId: calendar.marketCountry === "KR" ? "getKrMarketCalendar" : "getUsMarketCalendar",
      rateLimitGroup: "MARKET_INFO",
      receivedAt:
        calendar.marketCountry === "KR"
          ? ("2026-07-16T07:55:00+09:00" as IsoDateTime)
          : ("2026-07-16T21:55:00+09:00" as IsoDateTime),
    },
    allowedSessionKinds,
    policy: {
      now: new Date(now),
      maxAgeMs: 24 * 60 * 60 * 1_000,
      futureToleranceMs: 2_000,
    },
  });
}
