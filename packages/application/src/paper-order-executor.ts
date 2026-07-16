import type {
  BrokerReadResult,
  CommissionRateSchedule,
  IsoDate,
  IsoDateTime,
  OrderBookLevel,
  OrderBookSnapshot,
  PriceQuote,
  SymbolCode,
} from "@portfolio-rebalancer/broker";
import { toScaledInteger } from "@portfolio-rebalancer/domain";

import { estimateCommission } from "./commission";

export const PAPER_EXECUTION_FIXTURE_VERSION = "PAPER_EXECUTION_FIXTURE_V1" as const;
export const PAPER_LIMIT_FILL_POLICY_VERSION = "KR_LIMIT_DAY_BOOK_V1" as const;

const BASIS_POINT_SCALE = 10_000n;

export type ExecutableOrderState = "PENDING" | "PARTIAL_FILLED";
export type NormalizedOrderState = ExecutableOrderState | "FILLED";
export type PaperExecutionDecision = "FILLED" | "PARTIAL_FILLED" | "NO_FILL" | "BLOCKED";

export type PaperExecutionReasonCode =
  | "LIMIT_FULLY_FILLED"
  | "LIMIT_PARTIALLY_FILLED"
  | "LIMIT_NOT_CROSSED"
  | "FILLABLE_LIQUIDITY_INSUFFICIENT"
  | "ORDER_INPUT_INVALID"
  | "UNSUPPORTED_MARKET"
  | "UNSUPPORTED_CURRENCY"
  | "UNSUPPORTED_ORDER_TYPE"
  | "UNSUPPORTED_TIME_IN_FORCE"
  | "PARTIAL_FILL_POLICY_INVALID"
  | "EVALUATION_TIME_INVALID"
  | "FRESHNESS_POLICY_INVALID"
  | "QUOTE_MISSING"
  | "ORDERBOOK_MISSING"
  | "EVIDENCE_IDENTITY_MISMATCH"
  | "QUOTE_PRICE_INVALID"
  | "QUOTE_OBSERVED_AT_MISSING"
  | "QUOTE_TIME_INVALID"
  | "QUOTE_NOT_LATER_THAN_ORDER"
  | "QUOTE_STALE"
  | "ORDERBOOK_SIDE_MISSING"
  | "ORDERBOOK_LEVEL_INVALID"
  | "ORDERBOOK_OBSERVED_AT_MISSING"
  | "ORDERBOOK_TIME_INVALID"
  | "ORDERBOOK_NOT_LATER_THAN_ORDER"
  | "ORDERBOOK_STALE"
  | "COMMISSION_UNVERIFIED";

export type PaperSourceRawState =
  | "PAPER_LIMIT_FULL_FILL"
  | "PAPER_LIMIT_PARTIAL_FILL"
  | "PAPER_LIMIT_NOT_CROSSED"
  | "PAPER_LIQUIDITY_INSUFFICIENT"
  | "PAPER_EXECUTION_BLOCKED";

export interface OrderExecutor<Input, Result> {
  execute(input: Input): Promise<Result>;
}

export interface PaperLimitDayOrder {
  readonly logicalOrderId: string;
  readonly currentState: ExecutableOrderState;
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  /** The quantity still open at the start of this replay step. */
  readonly remainingQuantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly submittedAt: IsoDateTime;
  readonly tradeDate: IsoDate;
}

export interface PaperPartialFillPolicy {
  /**
   * When false, evidence with less simulated liquidity than the remaining
   * quantity produces no fill. When true, that liquidity produces a partial
   * fill.
   */
  readonly enabled: boolean;
  /**
   * Conservative share of each qualifying order-book level that the paper
   * order may consume. 10000 means 100%; values are floored per level.
   */
  readonly bookParticipationBasisPoints: bigint;
}

export interface PaperFreshnessPolicy {
  readonly maxEvidenceAgeMs: number;
  readonly futureToleranceMs: number;
}

export interface PaperLimitExecutionInput {
  readonly fixtureVersion: typeof PAPER_EXECUTION_FIXTURE_VERSION;
  readonly order: PaperLimitDayOrder;
  /** Explicit replay time. The executor never reads the system clock. */
  readonly evaluatedAt: IsoDateTime;
  readonly freshnessPolicy: PaperFreshnessPolicy;
  readonly partialFillPolicy: PaperPartialFillPolicy;
  readonly quote: BrokerReadResult<PriceQuote> | null;
  readonly orderBook: BrokerReadResult<OrderBookSnapshot> | null;
  readonly commissionSchedule: CommissionRateSchedule;
}

export interface PaperExecutionFill {
  readonly quantity: bigint;
  readonly remainingQuantity: bigint;
  readonly grossNotionalMinor: bigint;
  readonly commissionMinor: bigint;
  /**
   * Positive means cash added to the account; negative means cash consumed.
   * BUY includes commission and SELL subtracts commission.
   */
  readonly netCashDeltaMinor: bigint;
  readonly executions: readonly PaperLevelExecution[];
}

export interface PaperLevelExecution {
  readonly priceMinor: bigint;
  readonly quantity: bigint;
  readonly notionalMinor: bigint;
}

export interface PaperExecutionEvidence {
  readonly quoteObservedAt: IsoDateTime | null;
  readonly orderBookObservedAt: IsoDateTime | null;
  readonly quotePriceMinor: bigint | null;
  readonly bestRelevantBookPriceMinor: bigint | null;
  readonly qualifyingBookQuantity: bigint;
  readonly simulatedAvailableQuantity: bigint;
  readonly quoteAuditReference: string | null;
  readonly orderBookAuditReference: string | null;
  readonly limitations: readonly [
    "NO_OHLC_FILL_INFERENCE",
    "ORDERBOOK_SNAPSHOT_LIQUIDITY_ONLY",
    "NO_QUEUE_POSITION_INFERENCE",
  ];
}

export interface PaperOrderExecutionResult {
  readonly policyVersion: typeof PAPER_LIMIT_FILL_POLICY_VERSION;
  readonly logicalOrderId: string;
  readonly decision: PaperExecutionDecision;
  readonly reasonCode: PaperExecutionReasonCode;
  readonly normalizedTransition: {
    readonly from: ExecutableOrderState;
    readonly to: NormalizedOrderState;
    readonly applied: boolean;
  };
  readonly fill: PaperExecutionFill;
  readonly evidence: PaperExecutionEvidence;
  /**
   * Paper execution has no broker order state. The simulator's source state is
   * retained separately so it can never be mistaken for a normalized state.
   */
  readonly rawState: {
    readonly broker: null;
    readonly source: {
      readonly kind: "PAPER_ORDERBOOK_REPLAY";
      readonly value: PaperSourceRawState;
      readonly quoteOperationId: string | null;
      readonly quoteRequestId: string | null;
      readonly orderBookOperationId: string | null;
      readonly orderBookRequestId: string | null;
    };
  };
}

interface ValidatedEvidence {
  readonly quotePriceMinor: bigint;
  readonly quoteObservedAt: IsoDateTime;
  readonly orderBookObservedAt: IsoDateTime;
  readonly relevantLevels: readonly ParsedBookLevel[];
}

interface ParsedBookLevel {
  readonly originalIndex: number;
  readonly priceMinor: bigint;
  readonly quantity: bigint;
}

interface FillSimulation {
  readonly fillQuantity: bigint;
  readonly qualifyingBookQuantity: bigint;
  readonly simulatedAvailableQuantity: bigint;
  readonly executions: readonly PaperLevelExecution[];
}

const LIMITATIONS = [
  "NO_OHLC_FILL_INFERENCE",
  "ORDERBOOK_SNAPSHOT_LIQUIDITY_ONLY",
  "NO_QUEUE_POSITION_INFERENCE",
] as const;

/**
 * Async adapter for the common executor boundary. All decisions are delegated
 * to the pure replay function and no broker, network or clock is consulted.
 */
export class PaperOrderExecutor implements OrderExecutor<
  PaperLimitExecutionInput,
  PaperOrderExecutionResult
> {
  execute(input: PaperLimitExecutionInput): Promise<PaperOrderExecutionResult> {
    return Promise.resolve(simulatePaperLimitDayOrder(input));
  }
}

/**
 * Replays one KR LIMIT DAY execution step from pinned quote and order-book
 * evidence. The quote is freshness evidence only; fills come exclusively from
 * the executable side of the order book.
 */
export function simulatePaperLimitDayOrder(
  input: PaperLimitExecutionInput,
): PaperOrderExecutionResult {
  const inputIssue = validateInput(input);
  if (inputIssue !== null) return blockedResult(input, inputIssue);

  const evidence = validateEvidence(input);
  if ("reasonCode" in evidence) return blockedResult(input, evidence.reasonCode);

  const simulation = simulateBookFill(input, evidence.relevantLevels);
  const bestRelevantBookPriceMinor = evidence.relevantLevels[0]?.priceMinor ?? null;
  const evidenceResult = createEvidence(input, {
    quoteObservedAt: evidence.quoteObservedAt,
    orderBookObservedAt: evidence.orderBookObservedAt,
    quotePriceMinor: evidence.quotePriceMinor,
    bestRelevantBookPriceMinor,
    qualifyingBookQuantity: simulation.qualifyingBookQuantity,
    simulatedAvailableQuantity: simulation.simulatedAvailableQuantity,
  });

  const quoteCrossed =
    input.order.side === "BUY"
      ? evidence.quotePriceMinor <= input.order.limitPriceMinor
      : evidence.quotePriceMinor >= input.order.limitPriceMinor;
  if (!quoteCrossed) {
    return noFillResult(
      input,
      "LIMIT_NOT_CROSSED",
      "PAPER_LIMIT_NOT_CROSSED",
      evidenceResult,
    );
  }

  if (simulation.fillQuantity === 0n) {
    const crossed = simulation.qualifyingBookQuantity > 0n;
    return noFillResult(
      input,
      crossed ? "FILLABLE_LIQUIDITY_INSUFFICIENT" : "LIMIT_NOT_CROSSED",
      crossed ? "PAPER_LIQUIDITY_INSUFFICIENT" : "PAPER_LIMIT_NOT_CROSSED",
      evidenceResult,
    );
  }

  const grossNotionalMinor = simulation.executions.reduce(
    (sum, execution) => sum + execution.notionalMinor,
    0n,
  );
  let commissionMinor: bigint;
  try {
    commissionMinor = estimateCommission({
      schedule: input.commissionSchedule,
      marketCountry: input.order.marketCountry,
      tradeDate: input.order.tradeDate,
      notionalMinor: grossNotionalMinor,
    }).commissionMinor;
  } catch {
    return blockedResult(input, "COMMISSION_UNVERIFIED", evidenceResult);
  }

  const remainingQuantity = input.order.remainingQuantity - simulation.fillQuantity;
  const fullyFilled = remainingQuantity === 0n;
  const netCashDeltaMinor =
    input.order.side === "BUY"
      ? -(grossNotionalMinor + commissionMinor)
      : grossNotionalMinor - commissionMinor;

  return {
    policyVersion: PAPER_LIMIT_FILL_POLICY_VERSION,
    logicalOrderId: input.order.logicalOrderId,
    decision: fullyFilled ? "FILLED" : "PARTIAL_FILLED",
    reasonCode: fullyFilled ? "LIMIT_FULLY_FILLED" : "LIMIT_PARTIALLY_FILLED",
    normalizedTransition: {
      from: input.order.currentState,
      to: fullyFilled ? "FILLED" : "PARTIAL_FILLED",
      applied: true,
    },
    fill: {
      quantity: simulation.fillQuantity,
      remainingQuantity,
      grossNotionalMinor,
      commissionMinor,
      netCashDeltaMinor,
      executions: simulation.executions,
    },
    evidence: evidenceResult,
    rawState: createRawState(
      input,
      fullyFilled ? "PAPER_LIMIT_FULL_FILL" : "PAPER_LIMIT_PARTIAL_FILL",
    ),
  };
}

function validateInput(input: PaperLimitExecutionInput): PaperExecutionReasonCode | null {
  const order = input.order as Partial<PaperLimitDayOrder>;
  if (
    input.fixtureVersion !== PAPER_EXECUTION_FIXTURE_VERSION ||
    typeof order.logicalOrderId !== "string" ||
    order.logicalOrderId.trim() === "" ||
    (order.currentState !== "PENDING" && order.currentState !== "PARTIAL_FILLED") ||
    typeof order.remainingQuantity !== "bigint" ||
    order.remainingQuantity <= 0n ||
    typeof order.limitPriceMinor !== "bigint" ||
    order.limitPriceMinor <= 0n
  ) {
    return "ORDER_INPUT_INVALID";
  }
  if (order.marketCountry !== "KR") return "UNSUPPORTED_MARKET";
  if (order.currency !== "KRW") return "UNSUPPORTED_CURRENCY";
  if (order.orderType !== "LIMIT") return "UNSUPPORTED_ORDER_TYPE";
  if (order.timeInForce !== "DAY") return "UNSUPPORTED_TIME_IN_FORCE";
  if (
    typeof input.partialFillPolicy.enabled !== "boolean" ||
    typeof input.partialFillPolicy.bookParticipationBasisPoints !== "bigint" ||
    input.partialFillPolicy.bookParticipationBasisPoints < 0n ||
    input.partialFillPolicy.bookParticipationBasisPoints > BASIS_POINT_SCALE
  ) {
    return "PARTIAL_FILL_POLICY_INVALID";
  }
  if (parseOffsetDateTime(input.evaluatedAt) === null) return "EVALUATION_TIME_INVALID";
  if (
    !Number.isSafeInteger(input.freshnessPolicy.maxEvidenceAgeMs) ||
    input.freshnessPolicy.maxEvidenceAgeMs < 0 ||
    !Number.isSafeInteger(input.freshnessPolicy.futureToleranceMs) ||
    input.freshnessPolicy.futureToleranceMs < 0
  ) {
    return "FRESHNESS_POLICY_INVALID";
  }
  return null;
}

function validateEvidence(
  input: PaperLimitExecutionInput,
): ValidatedEvidence | { readonly reasonCode: PaperExecutionReasonCode } {
  if (input.quote === null) return { reasonCode: "QUOTE_MISSING" };
  if (input.orderBook === null) return { reasonCode: "ORDERBOOK_MISSING" };

  if (
    !sameInstrument(input.order, input.quote.value) ||
    !sameInstrument(input.order, input.orderBook.value) ||
    input.quote.value.currency !== input.order.currency ||
    input.orderBook.value.currency !== input.order.currency
  ) {
    return { reasonCode: "EVIDENCE_IDENTITY_MISMATCH" };
  }

  const quotePriceMinor = parsePositiveWholeUnit(input.quote.value.price);
  if (quotePriceMinor === null) return { reasonCode: "QUOTE_PRICE_INVALID" };

  const evaluatedAtMs = getRequiredParsedTime(input.evaluatedAt);
  const submittedAtMs = parseOffsetDateTime(input.order.submittedAt);
  if (submittedAtMs === null) return { reasonCode: "ORDER_INPUT_INVALID" };

  const quoteTimeIssue = validateEvidenceTime({
    observedAt: input.quote.value.observedAt,
    receivedAt: input.quote.metadata.receivedAt,
    evaluatedAtMs,
    submittedAtMs,
    freshnessPolicy: input.freshnessPolicy,
    missingCode: "QUOTE_OBSERVED_AT_MISSING",
    invalidCode: "QUOTE_TIME_INVALID",
    notLaterCode: "QUOTE_NOT_LATER_THAN_ORDER",
    staleCode: "QUOTE_STALE",
  });
  if ("reasonCode" in quoteTimeIssue) return quoteTimeIssue;

  const orderBookTimeIssue = validateEvidenceTime({
    observedAt: input.orderBook.value.observedAt,
    receivedAt: input.orderBook.metadata.receivedAt,
    evaluatedAtMs,
    submittedAtMs,
    freshnessPolicy: input.freshnessPolicy,
    missingCode: "ORDERBOOK_OBSERVED_AT_MISSING",
    invalidCode: "ORDERBOOK_TIME_INVALID",
    notLaterCode: "ORDERBOOK_NOT_LATER_THAN_ORDER",
    staleCode: "ORDERBOOK_STALE",
  });
  if ("reasonCode" in orderBookTimeIssue) return orderBookTimeIssue;

  const sourceLevels =
    input.order.side === "BUY" ? input.orderBook.value.asks : input.orderBook.value.bids;
  if (sourceLevels.length === 0) return { reasonCode: "ORDERBOOK_SIDE_MISSING" };

  const relevantLevels: ParsedBookLevel[] = [];
  for (const [originalIndex, level] of sourceLevels.entries()) {
    const parsed = parseBookLevel(level, originalIndex);
    if (parsed === null) return { reasonCode: "ORDERBOOK_LEVEL_INVALID" };
    relevantLevels.push(parsed);
  }
  relevantLevels.sort((left, right) => compareBookLevels(input.order.side, left, right));

  return {
    quotePriceMinor,
    quoteObservedAt: quoteTimeIssue.observedAt,
    orderBookObservedAt: orderBookTimeIssue.observedAt,
    relevantLevels,
  };
}

function validateEvidenceTime(input: {
  readonly observedAt: IsoDateTime | null;
  readonly receivedAt: IsoDateTime;
  readonly evaluatedAtMs: number;
  readonly submittedAtMs: number;
  readonly freshnessPolicy: PaperFreshnessPolicy;
  readonly missingCode: PaperExecutionReasonCode;
  readonly invalidCode: PaperExecutionReasonCode;
  readonly notLaterCode: PaperExecutionReasonCode;
  readonly staleCode: PaperExecutionReasonCode;
}): { readonly observedAt: IsoDateTime } | { readonly reasonCode: PaperExecutionReasonCode } {
  if (input.observedAt === null) return { reasonCode: input.missingCode };
  const observedAtMs = parseOffsetDateTime(input.observedAt);
  const receivedAtMs = parseOffsetDateTime(input.receivedAt);
  if (observedAtMs === null || receivedAtMs === null) {
    return { reasonCode: input.invalidCode };
  }
  if (observedAtMs <= input.submittedAtMs || receivedAtMs <= input.submittedAtMs) {
    return { reasonCode: input.notLaterCode };
  }
  const tolerance = input.freshnessPolicy.futureToleranceMs;
  if (
    observedAtMs - input.evaluatedAtMs > tolerance ||
    receivedAtMs - input.evaluatedAtMs > tolerance ||
    observedAtMs - receivedAtMs > tolerance
  ) {
    return { reasonCode: input.invalidCode };
  }
  if (
    input.evaluatedAtMs - observedAtMs > input.freshnessPolicy.maxEvidenceAgeMs ||
    input.evaluatedAtMs - receivedAtMs > input.freshnessPolicy.maxEvidenceAgeMs
  ) {
    return { reasonCode: input.staleCode };
  }
  return { observedAt: input.observedAt };
}

function simulateBookFill(
  input: PaperLimitExecutionInput,
  levels: readonly ParsedBookLevel[],
): FillSimulation {
  const qualifyingLevels = levels.filter((level) =>
    input.order.side === "BUY"
      ? level.priceMinor <= input.order.limitPriceMinor
      : level.priceMinor >= input.order.limitPriceMinor,
  );
  const qualifyingBookQuantity = qualifyingLevels.reduce((sum, level) => sum + level.quantity, 0n);
  const simulatedLevels = qualifyingLevels.map((level) => ({
    ...level,
    quantity:
      (level.quantity * input.partialFillPolicy.bookParticipationBasisPoints) / BASIS_POINT_SCALE,
  }));
  const simulatedAvailableQuantity = simulatedLevels.reduce(
    (sum, level) => sum + level.quantity,
    0n,
  );
  const desiredFillQuantity =
    !input.partialFillPolicy.enabled && simulatedAvailableQuantity < input.order.remainingQuantity
      ? 0n
      : minBigInt(simulatedAvailableQuantity, input.order.remainingQuantity);

  const executions: PaperLevelExecution[] = [];
  let quantityLeft = desiredFillQuantity;
  for (const level of simulatedLevels) {
    if (quantityLeft === 0n) break;
    const quantity = minBigInt(level.quantity, quantityLeft);
    if (quantity === 0n) continue;
    executions.push({
      priceMinor: level.priceMinor,
      quantity,
      notionalMinor: level.priceMinor * quantity,
    });
    quantityLeft -= quantity;
  }

  return {
    fillQuantity: desiredFillQuantity,
    qualifyingBookQuantity,
    simulatedAvailableQuantity,
    executions,
  };
}

function noFillResult(
  input: PaperLimitExecutionInput,
  reasonCode: Extract<
    PaperExecutionReasonCode,
    "LIMIT_NOT_CROSSED" | "FILLABLE_LIQUIDITY_INSUFFICIENT"
  >,
  rawState: Extract<
    PaperSourceRawState,
    "PAPER_LIMIT_NOT_CROSSED" | "PAPER_LIQUIDITY_INSUFFICIENT"
  >,
  evidence: PaperExecutionEvidence,
): PaperOrderExecutionResult {
  return {
    policyVersion: PAPER_LIMIT_FILL_POLICY_VERSION,
    logicalOrderId: input.order.logicalOrderId,
    decision: "NO_FILL",
    reasonCode,
    normalizedTransition: {
      from: input.order.currentState,
      to: input.order.currentState,
      applied: false,
    },
    fill: emptyFill(input.order.remainingQuantity),
    evidence,
    rawState: createRawState(input, rawState),
  };
}

function blockedResult(
  input: PaperLimitExecutionInput,
  reasonCode: PaperExecutionReasonCode,
  evidence = createEvidence(input),
): PaperOrderExecutionResult {
  return {
    policyVersion: PAPER_LIMIT_FILL_POLICY_VERSION,
    logicalOrderId: input.order.logicalOrderId,
    decision: "BLOCKED",
    reasonCode,
    normalizedTransition: {
      from: input.order.currentState,
      to: input.order.currentState,
      applied: false,
    },
    fill: emptyFill(input.order.remainingQuantity),
    evidence,
    rawState: createRawState(input, "PAPER_EXECUTION_BLOCKED"),
  };
}

function emptyFill(remainingQuantity: bigint): PaperExecutionFill {
  return {
    quantity: 0n,
    remainingQuantity,
    grossNotionalMinor: 0n,
    commissionMinor: 0n,
    netCashDeltaMinor: 0n,
    executions: [],
  };
}

function createEvidence(
  input: PaperLimitExecutionInput,
  values: Partial<
    Omit<PaperExecutionEvidence, "quoteAuditReference" | "orderBookAuditReference" | "limitations">
  > = {},
): PaperExecutionEvidence {
  return {
    quoteObservedAt: values.quoteObservedAt ?? input.quote?.value.observedAt ?? null,
    orderBookObservedAt: values.orderBookObservedAt ?? input.orderBook?.value.observedAt ?? null,
    quotePriceMinor: values.quotePriceMinor ?? null,
    bestRelevantBookPriceMinor: values.bestRelevantBookPriceMinor ?? null,
    qualifyingBookQuantity: values.qualifyingBookQuantity ?? 0n,
    simulatedAvailableQuantity: values.simulatedAvailableQuantity ?? 0n,
    quoteAuditReference: input.quote?.metadata.auditReference ?? null,
    orderBookAuditReference: input.orderBook?.metadata.auditReference ?? null,
    limitations: LIMITATIONS,
  };
}

function createRawState(
  input: PaperLimitExecutionInput,
  value: PaperSourceRawState,
): PaperOrderExecutionResult["rawState"] {
  return {
    broker: null,
    source: {
      kind: "PAPER_ORDERBOOK_REPLAY",
      value,
      quoteOperationId: input.quote?.metadata.operationId ?? null,
      quoteRequestId: input.quote?.metadata.requestId ?? null,
      orderBookOperationId: input.orderBook?.metadata.operationId ?? null,
      orderBookRequestId: input.orderBook?.metadata.requestId ?? null,
    },
  };
}

function parseBookLevel(level: OrderBookLevel, originalIndex: number): ParsedBookLevel | null {
  const priceMinor = parsePositiveWholeUnit(level.price);
  const quantity = parsePositiveWholeUnit(level.quantity);
  if (priceMinor === null || quantity === null) return null;
  return { originalIndex, priceMinor, quantity };
}

function parsePositiveWholeUnit(value: Parameters<typeof toScaledInteger>[0]): bigint | null {
  try {
    const parsed = toScaledInteger(value, 0);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function compareBookLevels(
  side: PaperLimitDayOrder["side"],
  left: ParsedBookLevel,
  right: ParsedBookLevel,
): number {
  if (left.priceMinor !== right.priceMinor) {
    if (side === "BUY") return left.priceMinor < right.priceMinor ? -1 : 1;
    return left.priceMinor > right.priceMinor ? -1 : 1;
  }
  return left.originalIndex - right.originalIndex;
}

function sameInstrument(
  order: PaperLimitDayOrder,
  evidence: Pick<PriceQuote | OrderBookSnapshot, "marketCountry" | "symbol">,
): boolean {
  return order.marketCountry === evidence.marketCountry && order.symbol === evidence.symbol;
}

function parseOffsetDateTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRequiredParsedTime(value: IsoDateTime): number {
  const parsed = parseOffsetDateTime(value);
  if (parsed === null) throw new Error("검증된 실행 평가 시각을 다시 해석할 수 없습니다.");
  return parsed;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
