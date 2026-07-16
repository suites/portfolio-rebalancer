import type {
  BrokerReadResult,
  MarketCalendar,
  PriceLimitQuote,
  PriceQuote,
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
}

export function evaluatePreSubmitOrderEvidence(input: {
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
  readonly now: Date;
  readonly quoteMaxAgeMs: number;
  readonly calendarMaxAgeMs: number;
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
  checks.push({
    code: freshness.reasonCode,
    outcome: freshness.canProceed ? "PASSED" : "BLOCKED",
    message: freshness.message,
  });

  const movement = evaluatePriceMovement({
    previous: input.plannedQuote.value,
    current: input.currentQuote.value,
    maxAbsoluteChangeBasisPoints: input.maxAbsolutePriceChangeBasisPoints,
  });
  checks.push({
    code: movement.reasonCode,
    outcome: movement.canProceed ? "PASSED" : "BLOCKED",
    message: movement.message,
  });

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
  checks.push({
    code: calendar.reasonCode,
    outcome: calendar.canProceed ? "PASSED" : "BLOCKED",
    message: calendar.message,
  });

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
  checks.push({
    code: reservation.reasonCode,
    outcome: reservation.canReserve ? "PASSED" : "BLOCKED",
    message: reservation.message,
  });

  const canSubmit = checks.every(({ outcome }) => outcome === "PASSED");
  return {
    status: canSubmit ? "READY" : "BLOCKED",
    canSubmit,
    checks,
    reservation,
  };
}

function parsePositiveWholeUnit(value: string | null): bigint | null {
  if (value === null || !/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value)) return null;
  const parsed = BigInt(value.split(".")[0]!);
  return parsed > 0n ? parsed : null;
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
