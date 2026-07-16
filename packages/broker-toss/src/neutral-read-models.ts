import type {
  AccountId,
  CommissionRatePeriod,
  CommissionRateSchedule,
  InstrumentIdentifier,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  MarketCalendarDay,
  MarketCountry,
  MarketSessionInterval,
  MarketSessionKind,
  OrderBookLevel,
  OrderBookSnapshot,
  PriceLimitQuote,
  PriceQuote,
  SellableQuantityQuote,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import type { Currency, DecimalString } from "@portfolio-rebalancer/domain";

import type {
  TossCommissionsResponse,
  TossKrAfterMarketSession,
  TossKrMarketCalendarResponse,
  TossKrMarketDay,
  TossKrPreMarketSession,
  TossKrRegularMarketSession,
  TossOrderbookEntry,
  TossOrderbookResponse,
  TossPriceLimitResponse,
  TossPricesResponse,
  TossSellableQuantityResponse,
  TossUsMarketCalendarResponse,
  TossUsMarketDay,
  TossUsMarketSession,
} from "./read-models";

export type TossNeutralReadModelIssue =
  | "REQUESTED_SYMBOLS_EMPTY"
  | "REQUESTED_SYMBOL_DUPLICATE"
  | "RESPONSE_SYMBOL_DUPLICATE"
  | "RESPONSE_SYMBOL_MISSING"
  | "RESPONSE_SYMBOL_EXTRA"
  | "MARKET_CURRENCY_MISMATCH"
  | "PRICE_NON_POSITIVE"
  | "ORDERBOOK_QUANTITY_NEGATIVE"
  | "ORDERBOOK_EMPTY"
  | "ORDERBOOK_ORDER_INVALID"
  | "ORDERBOOK_CROSSED"
  | "ORDERBOOK_NO_LIQUIDITY"
  | "PRICE_LIMIT_INVALID"
  | "CALENDAR_DATE_ORDER_INVALID"
  | "SESSION_INTERVAL_INVALID"
  | "SESSION_OVERLAP"
  | "AUCTION_BOUNDARY_INVALID"
  | "SELLABLE_QUANTITY_NEGATIVE"
  | "SELLABLE_QUANTITY_NOT_INTEGER"
  | "REQUESTED_MARKETS_EMPTY"
  | "REQUESTED_MARKET_DUPLICATE"
  | "COMMISSION_RATE_NEGATIVE"
  | "COMMISSION_PERIOD_INVALID"
  | "COMMISSION_PERIOD_OVERLAP"
  | "COMMISSION_MARKET_MISSING";

export class TossNeutralReadModelError extends Error {
  readonly code = "TOSS_NEUTRAL_READ_MODEL_INVALID";

  constructor(
    readonly issue: TossNeutralReadModelIssue,
    message: string,
  ) {
    super(message);
    this.name = "TossNeutralReadModelError";
  }
}

export function normalizeTossPrices(
  response: TossPricesResponse,
  requestedInstruments: readonly InstrumentIdentifier[],
): readonly PriceQuote[] {
  if (requestedInstruments.length === 0) {
    fail("REQUESTED_SYMBOLS_EMPTY", "시세 조회를 요청한 종목이 없습니다.");
  }

  const requestedBySymbol = new Map<string, InstrumentIdentifier>();
  for (const instrument of requestedInstruments) {
    if (requestedBySymbol.has(instrument.symbol)) {
      fail(
        "REQUESTED_SYMBOL_DUPLICATE",
        `시세 조회 요청에 중복 종목 코드가 있습니다: ${instrument.symbol}`,
      );
    }
    requestedBySymbol.set(instrument.symbol, instrument);
  }

  const responseBySymbol = new Map<string, TossPricesResponse["result"][number]>();
  for (const quote of response.result) {
    if (responseBySymbol.has(quote.symbol)) {
      fail(
        "RESPONSE_SYMBOL_DUPLICATE",
        `토스 시세 응답에 중복 종목 코드가 있습니다: ${quote.symbol}`,
      );
    }
    if (!requestedBySymbol.has(quote.symbol)) {
      fail("RESPONSE_SYMBOL_EXTRA", `요청하지 않은 종목의 시세가 반환되었습니다: ${quote.symbol}`);
    }
    responseBySymbol.set(quote.symbol, quote);
  }

  return requestedInstruments.map((instrument) => {
    const quote = responseBySymbol.get(instrument.symbol);
    if (!quote) {
      fail("RESPONSE_SYMBOL_MISSING", `요청한 종목의 시세가 응답에 없습니다: ${instrument.symbol}`);
    }
    assertCurrencyMatchesMarket(instrument.marketCountry, quote.currency, instrument.symbol);
    assertPositivePrice(quote.lastPrice, instrument.symbol);

    return {
      marketCountry: instrument.marketCountry,
      symbol: quote.symbol as SymbolCode,
      price: quote.lastPrice as DecimalString,
      currency: quote.currency,
      observedAt: (quote.timestamp ?? null) as IsoDateTime | null,
    };
  });
}

export function normalizeTossOrderbook(
  response: TossOrderbookResponse,
  instrument: InstrumentIdentifier,
): OrderBookSnapshot {
  assertCurrencyMatchesMarket(
    instrument.marketCountry,
    response.result.currency,
    instrument.symbol,
  );

  if (response.result.asks.length === 0 || response.result.bids.length === 0) {
    fail(
      "ORDERBOOK_EMPTY",
      `${instrument.marketCountry}:${instrument.symbol} 호가의 매수 또는 매도 목록이 비어 있습니다.`,
    );
  }

  const asks = response.result.asks.map((entry, index) =>
    normalizeOrderbookLevel(entry, instrument, "매도", index),
  );
  const bids = response.result.bids.map((entry, index) =>
    normalizeOrderbookLevel(entry, instrument, "매수", index),
  );
  assertOrderbookOrdering(asks, bids, instrument);
  if (
    !asks.some(({ quantity }) => !isZeroDecimal(quantity)) ||
    !bids.some(({ quantity }) => !isZeroDecimal(quantity))
  ) {
    fail(
      "ORDERBOOK_NO_LIQUIDITY",
      `${instrument.marketCountry}:${instrument.symbol} 호가에 양수 잔량이 없습니다.`,
    );
  }

  return {
    marketCountry: instrument.marketCountry,
    symbol: instrument.symbol,
    currency: response.result.currency,
    asks,
    bids,
    observedAt: (response.result.timestamp ?? null) as IsoDateTime | null,
  };
}

export function normalizeTossPriceLimit(
  response: TossPriceLimitResponse,
  instrument: InstrumentIdentifier,
): PriceLimitQuote {
  assertCurrencyMatchesMarket(
    instrument.marketCountry,
    response.result.currency,
    instrument.symbol,
  );

  const upper = response.result.upperLimitPrice ?? null;
  const lower = response.result.lowerLimitPrice ?? null;

  if (instrument.marketCountry === "US") {
    if (upper !== null || lower !== null) {
      fail(
        "PRICE_LIMIT_INVALID",
        `${instrument.symbol} 미국 종목의 가격 제한은 상한과 하한이 모두 null이어야 합니다.`,
      );
    }
  } else {
    if (upper === null || lower === null) {
      fail(
        "PRICE_LIMIT_INVALID",
        `${instrument.symbol} 국내 종목의 상한가와 하한가가 모두 필요합니다.`,
      );
    }
    assertPositivePrice(upper, `${instrument.symbol} 상한가`);
    assertPositivePrice(lower, `${instrument.symbol} 하한가`);
    if (compareNonNegativeDecimals(lower, upper) >= 0) {
      fail(
        "PRICE_LIMIT_INVALID",
        `${instrument.symbol} 국내 종목의 하한가는 상한가보다 작아야 합니다.`,
      );
    }
  }

  return {
    marketCountry: instrument.marketCountry,
    symbol: instrument.symbol,
    currency: response.result.currency,
    upperLimitPrice: upper as DecimalString | null,
    lowerLimitPrice: lower as DecimalString | null,
    observedAt: response.result.timestamp as IsoDateTime,
  };
}

export function normalizeTossKrMarketCalendar(
  response: TossKrMarketCalendarResponse,
): MarketCalendar {
  const calendar: MarketCalendar = {
    marketCountry: "KR",
    today: normalizeKrMarketDay(response.result.today),
    previousBusinessDay: normalizeKrMarketDay(response.result.previousBusinessDay),
    nextBusinessDay: normalizeKrMarketDay(response.result.nextBusinessDay),
  };
  assertCalendarOrdering(calendar);
  return calendar;
}

export function normalizeTossUsMarketCalendar(
  response: TossUsMarketCalendarResponse,
): MarketCalendar {
  const calendar: MarketCalendar = {
    marketCountry: "US",
    today: normalizeUsMarketDay(response.result.today),
    previousBusinessDay: normalizeUsMarketDay(response.result.previousBusinessDay),
    nextBusinessDay: normalizeUsMarketDay(response.result.nextBusinessDay),
  };
  assertCalendarOrdering(calendar);
  return calendar;
}

export function normalizeTossSellableQuantity(
  response: TossSellableQuantityResponse,
  accountId: AccountId,
  instrument: InstrumentIdentifier,
): SellableQuantityQuote {
  const quantity = response.result.sellableQuantity;
  if (hasNegativeSign(quantity)) {
    fail(
      "SELLABLE_QUANTITY_NEGATIVE",
      `${instrument.marketCountry}:${instrument.symbol} 매도 가능 수량이 음수입니다.`,
    );
  }
  if (instrument.marketCountry === "KR" && !/^\d+$/.test(quantity)) {
    fail(
      "SELLABLE_QUANTITY_NOT_INTEGER",
      `${instrument.symbol} 국내 종목의 매도 가능 수량은 정수여야 합니다.`,
    );
  }

  return {
    accountId,
    marketCountry: instrument.marketCountry,
    symbol: instrument.symbol,
    quantity: quantity as DecimalString,
  };
}

export function normalizeTossCommissions(
  response: TossCommissionsResponse,
  accountId: AccountId,
  requestedMarkets: readonly MarketCountry[],
): CommissionRateSchedule {
  if (requestedMarkets.length === 0) {
    fail("REQUESTED_MARKETS_EMPTY", "수수료 일정을 확인할 요청 시장이 없습니다.");
  }

  const requestedMarketSet = new Set<MarketCountry>();
  for (const requestedMarket of requestedMarkets) {
    if (requestedMarketSet.has(requestedMarket)) {
      fail(
        "REQUESTED_MARKET_DUPLICATE",
        `수수료 일정 요청 시장이 중복되었습니다: ${requestedMarket}`,
      );
    }
    requestedMarketSet.add(requestedMarket);
  }

  const periods = response.result.map((commission): CommissionRatePeriod => {
    if (hasNegativeSign(commission.commissionRate)) {
      fail("COMMISSION_RATE_NEGATIVE", `${commission.marketCountry} 시장 수수료율이 음수입니다.`);
    }

    const startDate = (commission.startDate ?? null) as IsoDate | null;
    const endDate = (commission.endDate ?? null) as IsoDate | null;
    if (startDate !== null && endDate !== null && startDate > endDate) {
      fail(
        "COMMISSION_PERIOD_INVALID",
        `${commission.marketCountry} 시장 수수료 적용 시작일이 종료일보다 늦습니다.`,
      );
    }

    return {
      marketCountry: commission.marketCountry,
      commissionRatePercent: commission.commissionRate as DecimalString,
      startDate,
      endDate,
    };
  });

  for (const requestedMarket of requestedMarketSet) {
    if (!periods.some((period) => period.marketCountry === requestedMarket)) {
      fail(
        "COMMISSION_MARKET_MISSING",
        `요청한 ${requestedMarket} 시장 수수료 일정이 응답에 없습니다.`,
      );
    }
  }

  assertCommissionPeriodsDoNotOverlap(periods);

  return { accountId, periods };
}

function normalizeOrderbookLevel(
  entry: TossOrderbookEntry,
  instrument: InstrumentIdentifier,
  sideLabel: string,
  index: number,
): OrderBookLevel {
  assertPositivePrice(entry.price, `${instrument.symbol} ${sideLabel}호가 ${index + 1}`);
  if (hasNegativeSign(entry.volume)) {
    fail(
      "ORDERBOOK_QUANTITY_NEGATIVE",
      `${instrument.symbol} ${sideLabel}호가 ${index + 1}의 잔량이 음수입니다.`,
    );
  }
  return {
    price: entry.price as DecimalString,
    quantity: entry.volume as DecimalString,
  };
}

function assertOrderbookOrdering(
  asks: readonly OrderBookLevel[],
  bids: readonly OrderBookLevel[],
  instrument: InstrumentIdentifier,
): void {
  for (let index = 1; index < asks.length; index += 1) {
    const previous = asks[index - 1];
    const current = asks[index];
    if (previous && current && compareNonNegativeDecimals(previous.price, current.price) >= 0) {
      fail(
        "ORDERBOOK_ORDER_INVALID",
        `${instrument.symbol} 매도호가는 가격 오름차순이어야 합니다.`,
      );
    }
  }
  for (let index = 1; index < bids.length; index += 1) {
    const previous = bids[index - 1];
    const current = bids[index];
    if (previous && current && compareNonNegativeDecimals(previous.price, current.price) <= 0) {
      fail(
        "ORDERBOOK_ORDER_INVALID",
        `${instrument.symbol} 매수호가는 가격 내림차순이어야 합니다.`,
      );
    }
  }
  const bestAsk = asks[0];
  const bestBid = bids[0];
  if (bestAsk && bestBid && compareNonNegativeDecimals(bestBid.price, bestAsk.price) >= 0) {
    fail("ORDERBOOK_CROSSED", `${instrument.symbol} 최우선 매수호가가 매도호가 이상입니다.`);
  }
}

function normalizeKrMarketDay(day: TossKrMarketDay): MarketCalendarDay {
  const sessions: MarketSessionInterval[] = [];
  const integrated = day.integrated;
  if (integrated?.preMarket) {
    sessions.push(normalizeKrPreMarketSession(integrated.preMarket, day.date));
  }
  if (integrated?.regularMarket) {
    sessions.push(normalizeKrRegularMarketSession(integrated.regularMarket, day.date));
  }
  if (integrated?.afterMarket) {
    sessions.push(normalizeKrAfterMarketSession(integrated.afterMarket, day.date));
  }
  return { date: day.date as IsoDate, sessions };
}

function normalizeKrPreMarketSession(
  session: TossKrPreMarketSession,
  date: string,
): MarketSessionInterval {
  return normalizeMarketSession(
    "PRE_MARKET",
    session,
    session.singlePriceAuctionStartTime ?? null,
    null,
    `KR ${date}`,
  );
}

function normalizeKrRegularMarketSession(
  session: TossKrRegularMarketSession,
  date: string,
): MarketSessionInterval {
  return normalizeMarketSession(
    "REGULAR_MARKET",
    session,
    session.singlePriceAuctionStartTime ?? null,
    null,
    `KR ${date}`,
  );
}

function normalizeKrAfterMarketSession(
  session: TossKrAfterMarketSession,
  date: string,
): MarketSessionInterval {
  return normalizeMarketSession(
    "AFTER_MARKET",
    session,
    null,
    session.singlePriceAuctionEndTime ?? null,
    `KR ${date}`,
  );
}

function normalizeUsMarketDay(day: TossUsMarketDay): MarketCalendarDay {
  const sessions: MarketSessionInterval[] = [];
  pushUsSession(sessions, "DAY_MARKET", day.dayMarket, day.date);
  pushUsSession(sessions, "PRE_MARKET", day.preMarket, day.date);
  pushUsSession(sessions, "REGULAR_MARKET", day.regularMarket, day.date);
  pushUsSession(sessions, "AFTER_MARKET", day.afterMarket, day.date);
  return { date: day.date as IsoDate, sessions };
}

function pushUsSession(
  sessions: MarketSessionInterval[],
  kind: MarketSessionKind,
  session: TossUsMarketSession | null | undefined,
  date: string,
): void {
  if (!session) return;
  sessions.push(normalizeMarketSession(kind, session, null, null, `US ${date}`));
}

function assertCalendarOrdering(calendar: MarketCalendar): void {
  if (
    calendar.previousBusinessDay.date >= calendar.today.date ||
    calendar.today.date >= calendar.nextBusinessDay.date
  ) {
    fail(
      "CALENDAR_DATE_ORDER_INVALID",
      `${calendar.marketCountry} 캘린더의 이전일·기준일·다음일 순서가 올바르지 않습니다.`,
    );
  }
  for (const day of [calendar.previousBusinessDay, calendar.today, calendar.nextBusinessDay]) {
    const sorted = [...day.sessions].sort((left, right) =>
      left.startAt.localeCompare(right.startAt),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (previous && current && previous.endAt > current.startAt) {
        fail("SESSION_OVERLAP", `${calendar.marketCountry} ${day.date} 시장 세션이 서로 겹칩니다.`);
      }
    }
  }
}

function normalizeMarketSession(
  kind: MarketSessionKind,
  session: TossUsMarketSession,
  auctionStartAt: string | null,
  auctionEndAt: string | null,
  context: string,
): MarketSessionInterval {
  const startEpoch = Date.parse(session.startTime);
  const endEpoch = Date.parse(session.endTime);
  if (startEpoch >= endEpoch) {
    fail(
      "SESSION_INTERVAL_INVALID",
      `${context} ${kind} 세션의 시작 시각은 종료 시각보다 빨라야 합니다.`,
    );
  }

  assertAuctionBoundaryInInterval(
    auctionStartAt,
    startEpoch,
    endEpoch,
    `${context} ${kind} 단일가 시작`,
    "START",
  );
  assertAuctionBoundaryInInterval(
    auctionEndAt,
    startEpoch,
    endEpoch,
    `${context} ${kind} 단일가 종료`,
    "END",
  );

  return {
    kind,
    startAt: session.startTime as IsoDateTime,
    endAt: session.endTime as IsoDateTime,
    auctionStartAt: auctionStartAt as IsoDateTime | null,
    auctionEndAt: auctionEndAt as IsoDateTime | null,
  };
}

function assertAuctionBoundaryInInterval(
  boundary: string | null,
  startEpoch: number,
  endEpoch: number,
  context: string,
  boundaryKind: "START" | "END",
): void {
  if (boundary === null) return;
  const boundaryEpoch = Date.parse(boundary);
  const invalid =
    boundaryKind === "START"
      ? boundaryEpoch < startEpoch || boundaryEpoch >= endEpoch
      : boundaryEpoch <= startEpoch || boundaryEpoch > endEpoch;
  if (invalid) {
    fail("AUCTION_BOUNDARY_INVALID", `${context} 시각이 세션 구간 밖에 있습니다.`);
  }
}

function assertCurrencyMatchesMarket(
  market: MarketCountry,
  currency: Currency,
  symbol: string,
): void {
  const expectedCurrency: Currency = market === "KR" ? "KRW" : "USD";
  if (currency !== expectedCurrency) {
    fail(
      "MARKET_CURRENCY_MISMATCH",
      `${market}:${symbol} 종목 통화는 ${expectedCurrency}여야 하지만 ${currency}가 반환되었습니다.`,
    );
  }
}

function assertPositivePrice(value: string, context: string): void {
  if (hasNegativeSign(value) || isZeroDecimal(value)) {
    fail("PRICE_NON_POSITIVE", `${context} 가격은 0보다 커야 합니다.`);
  }
}

function assertCommissionPeriodsDoNotOverlap(periods: readonly CommissionRatePeriod[]): void {
  for (const market of ["KR", "US"] as const) {
    const marketPeriods = periods
      .filter((period) => period.marketCountry === market)
      .toSorted((left, right) => compareNullableStartDates(left.startDate, right.startDate));

    for (let index = 1; index < marketPeriods.length; index += 1) {
      const previous = marketPeriods[index - 1];
      const current = marketPeriods[index];
      if (!previous || !current) continue;

      if (
        previous.endDate === null ||
        current.startDate === null ||
        current.startDate <= previous.endDate
      ) {
        fail("COMMISSION_PERIOD_OVERLAP", `${market} 시장 수수료 적용 기간이 서로 겹칩니다.`);
      }
    }
  }
}

function compareNullableStartDates(left: IsoDate | null, right: IsoDate | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

function compareNonNegativeDecimals(left: string, right: string): number {
  const [leftInteger = "", leftFraction = ""] = left.split(".");
  const [rightInteger = "", rightFraction = ""] = right.split(".");
  const normalizedLeftInteger = leftInteger.replace(/^0+(?=\d)/, "");
  const normalizedRightInteger = rightInteger.replace(/^0+(?=\d)/, "");

  if (normalizedLeftInteger.length !== normalizedRightInteger.length) {
    return normalizedLeftInteger.length < normalizedRightInteger.length ? -1 : 1;
  }
  if (normalizedLeftInteger !== normalizedRightInteger) {
    return normalizedLeftInteger < normalizedRightInteger ? -1 : 1;
  }

  const fractionLength = Math.max(leftFraction.length, rightFraction.length);
  const normalizedLeftFraction = leftFraction.padEnd(fractionLength, "0");
  const normalizedRightFraction = rightFraction.padEnd(fractionLength, "0");
  if (normalizedLeftFraction === normalizedRightFraction) return 0;
  return normalizedLeftFraction < normalizedRightFraction ? -1 : 1;
}

function hasNegativeSign(value: string): boolean {
  return value.startsWith("-");
}

function isZeroDecimal(value: string): boolean {
  return value
    .replaceAll("-", "")
    .replaceAll(".", "")
    .split("")
    .every((digit) => digit === "0");
}

function fail(issue: TossNeutralReadModelIssue, message: string): never {
  throw new TossNeutralReadModelError(issue, message);
}
