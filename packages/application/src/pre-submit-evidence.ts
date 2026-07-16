import type {
  AccountId,
  BrokerOrderSummary,
  BrokerReadResult,
  BuyingPowerQuote,
  IsoDateTime,
  MarketCalendar,
  PriceLimitQuote,
  PriceQuote,
  SellableQuantityQuote,
  SymbolCode,
} from "@portfolio-rebalancer/broker";

import { classifyMarketCalendarReadiness, evaluateQuoteFreshness } from "./market-readiness";
import {
  calculateOrderGrossReservation,
  type OrderGrossReservationDecision,
} from "./order-reservation";
import { evaluatePriceMovement } from "./price-movement";

export interface PreSubmitEvidenceCheck {
  readonly code: string;
  readonly outcome: "PASSED" | "BLOCKED";
  readonly message: string;
}

export interface PreSubmitOrderEvidenceDecision {
  readonly status: "READY" | "BLOCKED";
  readonly canSubmit: boolean;
  readonly checks: readonly PreSubmitEvidenceCheck[];
  readonly reservation: OrderGrossReservationDecision;
  readonly evaluatedAt: Date;
  readonly validUntil: Date | null;
}

export interface InstrumentTradeEvidence {
  readonly validationId: string;
  readonly marketCountry: "KR";
  readonly symbol: SymbolCode;
  readonly tradeBlockedNow: boolean;
  readonly requiresOrderRevalidation: boolean;
  readonly observedAt: IsoDateTime;
}

export function evaluatePreSubmitOrderEvidence(input: {
  readonly accountId: AccountId;
  readonly order: {
    readonly marketCountry: "KR";
    readonly currency: "KRW";
    readonly symbol: SymbolCode;
    readonly side: "BUY" | "SELL";
    readonly quantity: bigint;
    readonly limitPriceMinor: bigint;
  };
  readonly plannedQuote: BrokerReadResult<PriceQuote>;
  readonly currentQuote: BrokerReadResult<PriceQuote>;
  readonly priceLimit: BrokerReadResult<PriceLimitQuote>;
  readonly calendar: BrokerReadResult<MarketCalendar>;
  readonly instrumentTradeEvidence: BrokerReadResult<InstrumentTradeEvidence>;
  readonly brokerOpenOrders: BrokerReadResult<readonly BrokerOrderSummary[]>;
  readonly buyingPower: BrokerReadResult<BuyingPowerQuote> | null;
  readonly sellableQuantity: BrokerReadResult<SellableQuantityQuote> | null;
  readonly requiredBuyingPowerMinor: bigint | null;
  readonly now: Date;
  readonly quoteMaxAgeMs: number;
  readonly calendarMaxAgeMs: number;
  readonly pretradeMaxAgeMs: number;
  readonly futureToleranceMs: number;
  readonly maxAbsolutePriceChangeBasisPoints: bigint;
}): PreSubmitOrderEvidenceDecision {
  const checks: PreSubmitEvidenceCheck[] = [];
  const identityMatches =
    [input.plannedQuote.value, input.currentQuote.value, input.priceLimit.value].every(
      (value) =>
        value.marketCountry === input.order.marketCountry &&
        value.symbol === input.order.symbol &&
        value.currency === input.order.currency,
    ) && input.calendar.value.marketCountry === input.order.marketCountry;
  checks.push(
    check(
      identityMatches,
      "PRE_SUBMIT_EVIDENCE_IDENTITY_MATCHED",
      "PRE_SUBMIT_EVIDENCE_IDENTITY_MISMATCH",
      "계획·현재 시세와 가격 제한의 종목·통화가 주문과 일치합니다.",
      "주문과 계획·현재 시세 또는 가격 제한의 종목·통화가 일치하지 않습니다.",
    ),
  );

  const freshness = evaluateQuoteFreshness({
    quote: input.currentQuote.value,
    metadata: input.currentQuote.metadata,
    policy: {
      now: input.now,
      maxAgeMs: input.quoteMaxAgeMs,
      futureToleranceMs: input.futureToleranceMs,
    },
  });
  checks.push(decisionCheck(freshness.reasonCode, freshness.canProceed, freshness.message));

  const movement = evaluatePriceMovement({
    previous: input.plannedQuote.value,
    current: input.currentQuote.value,
    maxAbsoluteChangeBasisPoints: input.maxAbsolutePriceChangeBasisPoints,
  });
  checks.push(decisionCheck(movement.reasonCode, movement.canProceed, movement.message));

  const priceLimitFreshness = evaluateQuoteFreshness({
    quote: {
      marketCountry: input.priceLimit.value.marketCountry,
      symbol: input.priceLimit.value.symbol,
      currency: input.priceLimit.value.currency,
      price: input.currentQuote.value.price,
      observedAt: input.priceLimit.value.observedAt,
    },
    metadata: input.priceLimit.metadata,
    policy: {
      now: input.now,
      maxAgeMs: input.quoteMaxAgeMs,
      futureToleranceMs: input.futureToleranceMs,
    },
  });
  checks.push({
    code: priceLimitFreshness.canProceed
      ? "PRICE_LIMIT_FRESH"
      : `PRICE_LIMIT_${priceLimitFreshness.reasonCode}`,
    outcome: priceLimitFreshness.canProceed ? "PASSED" : "BLOCKED",
    message: priceLimitFreshness.canProceed
      ? "가격 제한 관측시각과 수신시각이 주문 직전 허용 범위 안입니다."
      : `가격 제한 증거 차단: ${priceLimitFreshness.message}`,
  });

  const calendar = classifyMarketCalendarReadiness({
    calendar: input.calendar.value,
    metadata: input.calendar.metadata,
    allowedSessionKinds: ["REGULAR_MARKET"],
    policy: {
      now: input.now,
      maxAgeMs: input.calendarMaxAgeMs,
      futureToleranceMs: input.futureToleranceMs,
    },
  });
  checks.push(decisionCheck(calendar.reasonCode, calendar.canProceed, calendar.message));

  const lowerPriceLimitMinor = parsePositiveWholeUnit(input.priceLimit.value.lowerLimitPrice);
  const upperPriceLimitMinor = parsePositiveWholeUnit(input.priceLimit.value.upperLimitPrice);
  const orderInsidePriceLimits =
    lowerPriceLimitMinor !== null &&
    upperPriceLimitMinor !== null &&
    lowerPriceLimitMinor <= input.order.limitPriceMinor &&
    input.order.limitPriceMinor <= upperPriceLimitMinor;
  checks.push(
    check(
      orderInsidePriceLimits,
      "ORDER_PRICE_WITHIN_DAILY_LIMITS",
      "ORDER_PRICE_OUTSIDE_DAILY_LIMITS",
      "지정가가 검증된 당일 하한가와 상한가 사이입니다.",
      "당일 가격 제한을 확인할 수 없거나 지정가가 허용 범위 밖입니다.",
    ),
  );

  const reservation = calculateOrderGrossReservation({
    side: input.order.side,
    quantity: input.order.quantity,
    limitPriceMinor: input.order.limitPriceMinor,
    upperPriceLimitMinor,
  });
  checks.push(decisionCheck(reservation.reasonCode, reservation.canReserve, reservation.message));

  const instrumentFreshness = evaluateTimedEvidence({
    successCode: "INSTRUMENT_WARNING_EVIDENCE_FRESH",
    blockedPrefix: "INSTRUMENT_WARNING_EVIDENCE",
    label: "종목 경고·거래제한",
    observedAt: input.instrumentTradeEvidence.value.observedAt,
    receivedAt: input.instrumentTradeEvidence.metadata.receivedAt,
    now: input.now,
    maxAgeMs: input.pretradeMaxAgeMs,
    futureToleranceMs: input.futureToleranceMs,
  });
  checks.push(instrumentFreshness.check);
  const instrumentIdentityMatches =
    input.instrumentTradeEvidence.value.marketCountry === input.order.marketCountry &&
    input.instrumentTradeEvidence.value.symbol === input.order.symbol &&
    input.instrumentTradeEvidence.value.validationId.trim().length > 0;
  checks.push(
    check(
      instrumentIdentityMatches &&
        !input.instrumentTradeEvidence.value.tradeBlockedNow &&
        !input.instrumentTradeEvidence.value.requiresOrderRevalidation,
      "INSTRUMENT_TRADE_RESTRICTIONS_CLEAR",
      instrumentIdentityMatches
        ? "INSTRUMENT_TRADE_RESTRICTION_ACTIVE"
        : "INSTRUMENT_TRADE_EVIDENCE_IDENTITY_MISMATCH",
      "최신 종목 경고와 거래 제한에서 현재 주문 차단 사유가 없습니다.",
      instrumentIdentityMatches
        ? "현재 종목 경고 또는 거래 제한이 있어 주문을 차단합니다."
        : "종목 경고 증거가 현재 주문 종목과 일치하지 않습니다.",
    ),
  );

  const openOrdersFreshness = evaluateTimedEvidence({
    successCode: "BROKER_OPEN_ORDERS_RECONCILED",
    blockedPrefix: "BROKER_OPEN_ORDERS",
    label: "브로커 미체결 주문",
    observedAt: null,
    receivedAt: input.brokerOpenOrders.metadata.receivedAt,
    now: input.now,
    maxAgeMs: input.pretradeMaxAgeMs,
    futureToleranceMs: input.futureToleranceMs,
  });
  checks.push(openOrdersFreshness.check);
  const conflictingOrder = input.brokerOpenOrders.value.find(
    (order) =>
      order.marketCountry === input.order.marketCountry && order.symbol === input.order.symbol,
  );
  checks.push(
    check(
      conflictingOrder === undefined,
      "NO_CONFLICTING_BROKER_OPEN_ORDER",
      "CONFLICTING_BROKER_OPEN_ORDER_EXISTS",
      "브로커에 현재 종목의 충돌 가능한 미체결 주문이 없습니다.",
      conflictingOrder
        ? `${conflictingOrder.brokerOrderId} 미체결 주문이 있어 신규 주문을 차단합니다.`
        : "브로커 미체결 주문 충돌 여부를 확인할 수 없습니다.",
    ),
  );

  const directionalFreshness = evaluateDirectionalPretrade(input, checks, reservation);
  const canSubmit = checks.every(({ outcome }) => outcome === "PASSED");
  const validUntilCandidates = [
    freshness.canProceed
      ? evidenceValidUntil(
          input.currentQuote.value.observedAt,
          input.currentQuote.metadata.receivedAt,
          input.quoteMaxAgeMs,
        )
      : null,
    priceLimitFreshness.canProceed
      ? evidenceValidUntil(
          input.priceLimit.value.observedAt,
          input.priceLimit.metadata.receivedAt,
          input.quoteMaxAgeMs,
        )
      : null,
    calendar.canProceed
      ? evidenceValidUntil(null, input.calendar.metadata.receivedAt, input.calendarMaxAgeMs)
      : null,
    calendar.canProceed ? marketSessionValidUntil(input.calendar.value, input.now) : null,
    instrumentFreshness.validUntilMs,
    openOrdersFreshness.validUntilMs,
    directionalFreshness.validUntilMs,
  ];
  const validUntilMs =
    canSubmit && validUntilCandidates.every((candidate) => candidate !== null)
      ? Math.min(...validUntilCandidates)
      : null;

  return {
    status: canSubmit ? "READY" : "BLOCKED",
    canSubmit,
    checks,
    reservation,
    evaluatedAt: new Date(input.now),
    validUntil: validUntilMs === null ? null : new Date(validUntilMs),
  };
}

function evaluateDirectionalPretrade(
  input: Parameters<typeof evaluatePreSubmitOrderEvidence>[0],
  checks: PreSubmitEvidenceCheck[],
  reservation: OrderGrossReservationDecision,
): { readonly validUntilMs: number | null } {
  if (input.order.side === "BUY") {
    const buyingPower = input.buyingPower;
    const identityMatches =
      buyingPower !== null &&
      buyingPower.value.accountId === input.accountId &&
      buyingPower.value.currency === input.order.currency;
    const freshness =
      buyingPower === null
        ? blockedTimedEvidence(
            "BUYING_POWER_UNAVAILABLE",
            "매수 가능 금액 증거가 없어 주문을 차단합니다.",
          )
        : evaluateTimedEvidence({
            successCode: "BUYING_POWER_FRESH",
            blockedPrefix: "BUYING_POWER",
            label: "매수 가능 금액",
            observedAt: null,
            receivedAt: buyingPower.metadata.receivedAt,
            now: input.now,
            maxAgeMs: input.pretradeMaxAgeMs,
            futureToleranceMs: input.futureToleranceMs,
          });
    checks.push(freshness.check);

    const availableMinor =
      identityMatches && buyingPower !== null
        ? parseNonNegativeWholeUnit(buyingPower.value.cashBuyingPower)
        : null;
    const requiredMinor = input.requiredBuyingPowerMinor;
    checks.push(
      check(
        availableMinor !== null &&
          requiredMinor !== null &&
          reservation.reservedGrossMinor !== null &&
          requiredMinor >= reservation.reservedGrossMinor &&
          availableMinor >= requiredMinor,
        "BUYING_POWER_SUFFICIENT",
        identityMatches ? "BUYING_POWER_INSUFFICIENT_OR_INVALID" : "BUYING_POWER_IDENTITY_MISMATCH",
        "최신 매수 가능 금액이 주문금액과 비용 예약을 충당합니다.",
        identityMatches
          ? "매수 가능 금액이 부족하거나 필요한 예약금액을 확인할 수 없습니다."
          : "매수 가능 금액의 계좌 또는 통화가 주문과 일치하지 않습니다.",
      ),
    );
    return { validUntilMs: freshness.validUntilMs };
  }

  const sellable = input.sellableQuantity;
  const identityMatches =
    sellable !== null &&
    sellable.value.accountId === input.accountId &&
    sellable.value.marketCountry === input.order.marketCountry &&
    sellable.value.symbol === input.order.symbol;
  const freshness =
    sellable === null
      ? blockedTimedEvidence(
          "SELLABLE_QUANTITY_UNAVAILABLE",
          "매도 가능 수량 증거가 없어 주문을 차단합니다.",
        )
      : evaluateTimedEvidence({
          successCode: "SELLABLE_QUANTITY_FRESH",
          blockedPrefix: "SELLABLE_QUANTITY",
          label: "매도 가능 수량",
          observedAt: null,
          receivedAt: sellable.metadata.receivedAt,
          now: input.now,
          maxAgeMs: input.pretradeMaxAgeMs,
          futureToleranceMs: input.futureToleranceMs,
        });
  checks.push(freshness.check);

  const quantity =
    identityMatches && sellable !== null
      ? parseNonNegativeWholeUnit(sellable.value.quantity)
      : null;
  checks.push(
    check(
      quantity !== null && quantity >= input.order.quantity,
      "SELLABLE_QUANTITY_SUFFICIENT",
      identityMatches
        ? "SELLABLE_QUANTITY_INSUFFICIENT_OR_INVALID"
        : "SELLABLE_QUANTITY_IDENTITY_MISMATCH",
      "최신 매도 가능 수량이 계획 주문 수량 이상입니다.",
      identityMatches
        ? "매도 가능 수량이 부족하거나 안전하게 해석할 수 없습니다."
        : "매도 가능 수량의 계좌 또는 종목이 주문과 일치하지 않습니다.",
    ),
  );
  return { validUntilMs: freshness.validUntilMs };
}

function evaluateTimedEvidence(input: {
  readonly successCode: string;
  readonly blockedPrefix: string;
  readonly label: string;
  readonly observedAt: string | null;
  readonly receivedAt: string;
  readonly now: Date;
  readonly maxAgeMs: number;
  readonly futureToleranceMs: number;
}): { readonly check: PreSubmitEvidenceCheck; readonly validUntilMs: number | null } {
  const nowMs = input.now.getTime();
  const receivedAtMs = Date.parse(input.receivedAt);
  const observedAtMs = input.observedAt === null ? null : Date.parse(input.observedAt);
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(input.maxAgeMs) ||
    input.maxAgeMs < 0 ||
    !Number.isSafeInteger(input.futureToleranceMs) ||
    input.futureToleranceMs < 0 ||
    !Number.isFinite(receivedAtMs) ||
    (observedAtMs !== null && !Number.isFinite(observedAtMs))
  ) {
    return blockedTimedEvidence(
      `${input.blockedPrefix}_TIME_INVALID`,
      `${input.label} 증거의 시각 또는 freshness 정책을 해석할 수 없습니다.`,
    );
  }
  const oldestAtMs = Math.min(receivedAtMs, observedAtMs ?? receivedAtMs);
  const newestAtMs = Math.max(receivedAtMs, observedAtMs ?? receivedAtMs);
  if (newestAtMs - nowMs > input.futureToleranceMs) {
    return blockedTimedEvidence(
      `${input.blockedPrefix}_TIME_FUTURE`,
      `${input.label} 증거 시각이 현재보다 허용 오차 이상 미래입니다.`,
    );
  }
  if (nowMs - oldestAtMs > input.maxAgeMs) {
    return blockedTimedEvidence(
      `${input.blockedPrefix}_STALE`,
      `${input.label} 증거가 허용된 최대 나이보다 오래되었습니다.`,
    );
  }
  return {
    check: {
      code: input.successCode,
      outcome: "PASSED",
      message: `${input.label} 증거가 주문 직전 freshness 범위 안입니다.`,
    },
    validUntilMs: oldestAtMs + input.maxAgeMs,
  };
}

function blockedTimedEvidence(
  code: string,
  message: string,
): { readonly check: PreSubmitEvidenceCheck; readonly validUntilMs: null } {
  return { check: { code, outcome: "BLOCKED", message }, validUntilMs: null };
}

function evidenceValidUntil(
  observedAt: string | null,
  receivedAt: string,
  maxAgeMs: number,
): number | null {
  const receivedAtMs = Date.parse(receivedAt);
  const observedAtMs = observedAt === null ? null : Date.parse(observedAt);
  if (
    !Number.isFinite(receivedAtMs) ||
    (observedAtMs !== null && !Number.isFinite(observedAtMs)) ||
    !Number.isSafeInteger(maxAgeMs) ||
    maxAgeMs < 0
  ) {
    return null;
  }
  return Math.min(receivedAtMs, observedAtMs ?? receivedAtMs) + maxAgeMs;
}

function marketSessionValidUntil(calendar: MarketCalendar, now: Date): number | null {
  const nowMs = now.getTime();
  const session = calendar.today.sessions.find((candidate) => {
    const startAtMs = Date.parse(candidate.startAt);
    const endAtMs = Date.parse(candidate.endAt);
    return (
      candidate.kind === "REGULAR_MARKET" &&
      Number.isFinite(startAtMs) &&
      Number.isFinite(endAtMs) &&
      startAtMs <= nowMs &&
      nowMs < endAtMs
    );
  });
  if (!session) return null;
  const endAtMs = Date.parse(session.endAt);
  const auctionStartAtMs =
    session.auctionStartAt === null ? null : Date.parse(session.auctionStartAt);
  return auctionStartAtMs !== null && Number.isFinite(auctionStartAtMs) && nowMs < auctionStartAtMs
    ? Math.min(endAtMs, auctionStartAtMs)
    : endAtMs;
}

function parsePositiveWholeUnit(value: string | null): bigint | null {
  if (value === null || !/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) return null;
  const parsed = BigInt(value.split(".")[0]!);
  return parsed > 0n ? parsed : null;
}

function parseNonNegativeWholeUnit(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) return null;
  return BigInt(value.split(".")[0]!);
}

function decisionCheck(code: string, passed: boolean, message: string): PreSubmitEvidenceCheck {
  return { code, outcome: passed ? "PASSED" : "BLOCKED", message };
}

function check(
  condition: boolean,
  passedCode: string,
  blockedCode: string,
  passedMessage: string,
  blockedMessage: string,
): PreSubmitEvidenceCheck {
  return condition
    ? { code: passedCode, outcome: "PASSED", message: passedMessage }
    : { code: blockedCode, outcome: "BLOCKED", message: blockedMessage };
}
