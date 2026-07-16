import { createHash } from "node:crypto";

import type { AccountId, BrokerId, IsoDateTime, SymbolCode } from "./models";

export const LIVE_ORDER_AUTHORIZATION_MAX_LIFETIME_MS = 30_000;

export type LiveOrderAction = "SUBMIT" | "CANCEL";

export const LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES = [
  "EXECUTION_MODE_MATCHED",
  "KILL_SWITCH_RELEASED",
  "PLAN_MODE_MATCHED",
  "MINIMUM_ORDER_GROSS_OK",
  "PLAN_IDENTITY_CURRENT",
  "NO_UNRESOLVED_ORDERS",
  "TRADE_LIMITS_OK",
  "EXPOSURE_LIMITS_OK",
  "LIVE_EXPLICITLY_ENABLED",
  "LIVE_ACCOUNT_ALLOWLISTED",
  "LIVE_ORDER_SHAPE_ALLOWED",
  "LIVE_TRADE_LIMITS_OK",
  "TINY_LIVE_GROSS_LIMIT_OK",
  "LIVE_MANUAL_APPROVAL_VALID",
  "PRE_SUBMIT_EVIDENCE_IDENTITY_MATCHED",
  "QUOTE_FRESH",
  "PRICE_MOVEMENT_ACCEPTABLE",
  "PRICE_LIMIT_FRESH",
  "MARKET_SESSION_OPEN",
  "ORDER_PRICE_WITHIN_DAILY_LIMITS",
  "ORDER_RESERVATION_READY",
  "INSTRUMENT_WARNING_EVIDENCE_FRESH",
  "INSTRUMENT_TRADE_RESTRICTIONS_CLEAR",
  "BROKER_OPEN_ORDERS_RECONCILED",
  "NO_CONFLICTING_BROKER_OPEN_ORDER",
] as const;

export const LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES = [
  "BUYING_POWER_FRESH",
  "BUYING_POWER_SUFFICIENT",
] as const;

export const LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES = [
  "SELLABLE_QUANTITY_FRESH",
  "SELLABLE_QUANTITY_SUFFICIENT",
] as const;

export const LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES = [
  "CANCEL_ORIGINAL_ORDER_MATCHED",
  "CANCEL_ORDER_STATE_ALLOWED",
  "CANCEL_REQUEST_AUTHORIZED",
] as const;

export const TOSS_CANONICAL_CLIENT_ORDER_ID_PATTERN = /^pr1_[A-Za-z0-9_-]{32}$/;

export interface PassedLiveOrderRiskCheck {
  readonly code: string;
  readonly outcome: "PASSED";
  readonly message: string;
  readonly subjectKey: string | null;
}

export interface ReadyLiveOrderRiskDecision {
  readonly scope: LiveOrderAction;
  readonly planOrderId: string;
  readonly canonicalRequestDigest: string;
  readonly evaluatedAt: IsoDateTime;
  readonly validUntil: IsoDateTime;
  readonly evidenceReferences: readonly string[];
  readonly status: "READY";
  readonly canExecute: true;
  readonly checks: readonly PassedLiveOrderRiskCheck[];
}

export interface LiveOrderEconomicTerms {
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  readonly quantity: string;
  readonly limitPriceMinor: string;
}

export interface LiveOrderAuditIntent {
  readonly action: LiveOrderAction;
  readonly authorizationId: string;
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly brokerOrderId: string | null;
  readonly economicTerms: LiveOrderEconomicTerms | null;
  readonly canonicalRequestDigest: string;
  readonly evidenceReferences: readonly string[];
  readonly authorizedAt: IsoDateTime;
}

/**
 * Persists the exact authorized write intent before any broker request is sent.
 * Returning a non-empty reference is mandatory; failure keeps the network closed.
 */
export type LiveOrderAuditCallback = (intent: LiveOrderAuditIntent) => string | Promise<string>;

interface LiveOrderAuthorizationCommon {
  readonly authorizationId: string;
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly riskDecision: ReadyLiveOrderRiskDecision;
  readonly issuedAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly audit: LiveOrderAuditCallback;
}

const authorizationBrand: unique symbol = Symbol("live-order-authorization");

export interface LiveOrderSubmitAuthorization extends LiveOrderAuthorizationCommon {
  readonly action: "SUBMIT";
  readonly ledgerState: "SUBMITTING";
  readonly brokerOrderId: null;
  readonly economicTerms: LiveOrderEconomicTerms;
  readonly [authorizationBrand]: true;
}

export interface LiveOrderCancelAuthorization extends LiveOrderAuthorizationCommon {
  readonly action: "CANCEL";
  readonly ledgerState: "PENDING" | "PARTIAL_FILLED";
  readonly brokerOrderId: string;
  readonly economicTerms: null;
  readonly [authorizationBrand]: true;
}

export type LiveOrderAuthorization = LiveOrderSubmitAuthorization | LiveOrderCancelAuthorization;

export interface IssueLiveOrderSubmitAuthorizationInput extends Omit<
  LiveOrderAuthorizationCommon,
  "issuedAt" | "expiresAt"
> {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly ledgerState: "SUBMITTING";
  readonly economicTerms: LiveOrderEconomicTerms;
}

export interface IssueLiveOrderCancelAuthorizationInput extends Omit<
  LiveOrderAuthorizationCommon,
  "issuedAt" | "expiresAt"
> {
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly ledgerState: "PENDING" | "PARTIAL_FILLED";
  readonly brokerOrderId: string;
}

interface LiveOrderAuthorizationBindingCommon {
  readonly action: LiveOrderAction;
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly brokerOrderId: string | null;
}

export type LiveOrderAuthorizationBinding =
  | (LiveOrderAuthorizationBindingCommon & {
      readonly action: "SUBMIT";
      readonly brokerOrderId: null;
      readonly economicTerms: LiveOrderEconomicTerms;
    })
  | (LiveOrderAuthorizationBindingCommon & {
      readonly action: "CANCEL";
      readonly brokerOrderId: string;
      readonly economicTerms: null;
    });

export type LiveOrderAuthorizationConsumption =
  | { readonly status: "AUTHORIZED" }
  | {
      readonly status:
        "NOT_ISSUED" | "ALREADY_CONSUMED" | "EXPIRED" | "INVALID_TIME" | "BINDING_MISMATCH";
    };

const issuedAuthorizations = new WeakSet<object>();
const consumedAuthorizations = new WeakSet<object>();

export function issueLiveOrderSubmitAuthorization(
  input: IssueLiveOrderSubmitAuthorizationInput,
): LiveOrderSubmitAuthorization {
  validateEconomicTerms(input.economicTerms);
  const binding = submitAuthorizationBinding(input);
  validateCommonAuthorization(input, binding);
  if (input.ledgerState !== "SUBMITTING") {
    throw new Error("Live 주문 제출 권한은 SUBMITTING 원장 상태에서만 발급할 수 있습니다.");
  }

  return issueAuthorization({
    ...copyCommonAuthorization(input),
    action: "SUBMIT",
    ledgerState: "SUBMITTING",
    brokerOrderId: null,
    economicTerms: copyEconomicTerms(input.economicTerms),
    [authorizationBrand]: true,
  });
}

export function issueLiveOrderCancelAuthorization(
  input: IssueLiveOrderCancelAuthorizationInput,
): LiveOrderCancelAuthorization {
  assertNonEmpty(input.brokerOrderId, "brokerOrderId");
  const binding = cancelAuthorizationBinding(input);
  validateCommonAuthorization(input, binding);

  return issueAuthorization({
    ...copyCommonAuthorization(input),
    action: "CANCEL",
    ledgerState: input.ledgerState,
    brokerOrderId: input.brokerOrderId,
    economicTerms: null,
    [authorizationBrand]: true,
  });
}

export function consumeLiveOrderAuthorization(
  authorization: LiveOrderAuthorization,
  binding: LiveOrderAuthorizationBinding,
  now: Date,
): LiveOrderAuthorizationConsumption {
  if (!issuedAuthorizations.has(authorization)) return { status: "NOT_ISSUED" };
  if (consumedAuthorizations.has(authorization)) return { status: "ALREADY_CONSUMED" };

  consumedAuthorizations.add(authorization);

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return { status: "INVALID_TIME" };
  if (nowMs < Date.parse(authorization.issuedAt)) return { status: "INVALID_TIME" };
  if (nowMs >= Date.parse(authorization.expiresAt)) return { status: "EXPIRED" };
  if (nowMs >= Date.parse(authorization.riskDecision.validUntil)) return { status: "EXPIRED" };

  const matches =
    authorization.action === binding.action &&
    authorization.planId === binding.planId &&
    authorization.planOrderId === binding.planOrderId &&
    authorization.logicalOrderId === binding.logicalOrderId &&
    authorization.accountId === binding.accountId &&
    authorization.brokerAccountReference === binding.brokerAccountReference &&
    authorization.clientOrderId === binding.clientOrderId &&
    authorization.brokerOrderId === binding.brokerOrderId &&
    economicTermsMatch(authorization.economicTerms, binding.economicTerms);

  return matches ? { status: "AUTHORIZED" } : { status: "BINDING_MISMATCH" };
}

function issueAuthorization<Authorization extends LiveOrderAuthorization>(
  authorization: Authorization,
): Authorization {
  const frozen = Object.freeze(authorization);
  issuedAuthorizations.add(frozen);
  return frozen;
}

function copyCommonAuthorization(
  input: IssueLiveOrderSubmitAuthorizationInput | IssueLiveOrderCancelAuthorizationInput,
): LiveOrderAuthorizationCommon {
  return {
    authorizationId: input.authorizationId,
    planId: input.planId,
    planOrderId: input.planOrderId,
    logicalOrderId: input.logicalOrderId,
    accountId: input.accountId,
    brokerAccountReference: input.brokerAccountReference,
    clientOrderId: input.clientOrderId,
    riskDecision: Object.freeze({
      ...input.riskDecision,
      evidenceReferences: Object.freeze([...input.riskDecision.evidenceReferences]),
      checks: Object.freeze(input.riskDecision.checks.map((check) => Object.freeze({ ...check }))),
    }),
    issuedAt: input.issuedAt.toISOString() as IsoDateTime,
    expiresAt: input.expiresAt.toISOString() as IsoDateTime,
    audit: input.audit,
  };
}

function validateCommonAuthorization(
  input: IssueLiveOrderSubmitAuthorizationInput | IssueLiveOrderCancelAuthorizationInput,
  binding: LiveOrderAuthorizationBinding,
): void {
  const action = binding.action;
  assertNonEmpty(input.authorizationId, "authorizationId");
  assertNonEmpty(input.planId, "planId");
  assertNonEmpty(input.planOrderId, "planOrderId");
  assertNonEmpty(input.logicalOrderId, "logicalOrderId");
  assertNonEmpty(input.accountId, "accountId");
  assertNonEmpty(input.brokerAccountReference, "brokerAccountReference");
  if (!TOSS_CANONICAL_CLIENT_ORDER_ID_PATTERN.test(input.clientOrderId)) {
    throw new Error("clientOrderId가 결정적 pr1 형식과 길이를 만족하지 않습니다.");
  }
  if (typeof input.audit !== "function") {
    throw new Error("Live 주문 전 감사 callback이 필요합니다.");
  }

  const issuedAtMs = input.issuedAt.getTime();
  const expiresAtMs = input.expiresAt.getTime();
  if (
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > LIVE_ORDER_AUTHORIZATION_MAX_LIFETIME_MS
  ) {
    throw new Error("Live 주문 권한은 30초 이하의 유효한 만료시간을 가져야 합니다.");
  }

  const { riskDecision } = input;
  if (
    riskDecision.scope !== action ||
    riskDecision.status !== "READY" ||
    riskDecision.canExecute !== true ||
    riskDecision.checks.length === 0 ||
    riskDecision.checks.some(
      ({ code, outcome }) => code.trim().length === 0 || outcome !== "PASSED",
    )
  ) {
    throw new Error("모든 위험 검사가 통과한 READY 결정만 Live 주문 권한으로 바꿀 수 있습니다.");
  }
  const codes = riskDecision.checks.map(({ code }) => code);
  if (new Set(codes).size !== codes.length) {
    throw new Error("Live 주문 위험 검사 코드는 중복될 수 없습니다.");
  }
  const requiredCodes: readonly string[] =
    action === "SUBMIT"
      ? [
          ...LIVE_ORDER_SUBMIT_REQUIRED_RISK_CHECK_CODES,
          ...(binding.economicTerms.side === "BUY"
            ? LIVE_ORDER_SUBMIT_BUY_REQUIRED_RISK_CHECK_CODES
            : LIVE_ORDER_SUBMIT_SELL_REQUIRED_RISK_CHECK_CODES),
        ]
      : LIVE_ORDER_CANCEL_REQUIRED_RISK_CHECK_CODES;
  const observedCodes = new Set(codes);
  const missingCodes = requiredCodes.filter((code) => !observedCodes.has(code));
  if (missingCodes.length > 0) {
    throw new Error(
      `Live ${action} 권한에 필요한 통과 검사가 누락되었습니다: ${missingCodes.join(", ")}`,
    );
  }
  if (
    riskDecision.planOrderId !== input.planOrderId ||
    !/^[a-f0-9]{64}$/.test(riskDecision.canonicalRequestDigest) ||
    riskDecision.canonicalRequestDigest !== createLiveOrderRequestDigest(binding)
  ) {
    throw new Error(
      "Live 주문 위험 결정이 현재 계획 주문과 canonical request에 고정되지 않았습니다.",
    );
  }
  if (
    riskDecision.evidenceReferences.length === 0 ||
    riskDecision.evidenceReferences.some((reference) => reference.trim().length === 0) ||
    new Set(riskDecision.evidenceReferences).size !== riskDecision.evidenceReferences.length
  ) {
    throw new Error("Live 주문 위험 결정에는 중복 없는 DB 증거 참조가 필요합니다.");
  }
  if (riskDecision.checks.some(({ subjectKey }) => subjectKey !== input.planOrderId)) {
    throw new Error("Live 주문의 모든 통과 검사는 현재 planOrderId에 고정되어야 합니다.");
  }

  const evaluatedAtMs = Date.parse(riskDecision.evaluatedAt);
  const validUntilMs = Date.parse(riskDecision.validUntil);
  if (
    !Number.isFinite(evaluatedAtMs) ||
    !Number.isFinite(validUntilMs) ||
    evaluatedAtMs > issuedAtMs ||
    issuedAtMs >= validUntilMs ||
    expiresAtMs > validUntilMs
  ) {
    throw new Error("Live 주문 권한은 위험 증거의 유효기간을 넘을 수 없습니다.");
  }
}

export function createLiveOrderRequestDigest(binding: LiveOrderAuthorizationBinding): string {
  const canonical = JSON.stringify({
    version: "LIVE_ORDER_REQUEST_V1",
    action: binding.action,
    planId: binding.planId,
    planOrderId: binding.planOrderId,
    logicalOrderId: binding.logicalOrderId,
    accountId: binding.accountId,
    brokerAccountReference: binding.brokerAccountReference,
    clientOrderId: binding.clientOrderId,
    brokerOrderId: binding.brokerOrderId,
    economicTerms: binding.economicTerms,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function submitAuthorizationBinding(
  input: IssueLiveOrderSubmitAuthorizationInput,
): Extract<LiveOrderAuthorizationBinding, { readonly action: "SUBMIT" }> {
  return {
    action: "SUBMIT",
    planId: input.planId,
    planOrderId: input.planOrderId,
    logicalOrderId: input.logicalOrderId,
    accountId: input.accountId,
    brokerAccountReference: input.brokerAccountReference,
    clientOrderId: input.clientOrderId,
    brokerOrderId: null,
    economicTerms: input.economicTerms,
  };
}

function cancelAuthorizationBinding(
  input: IssueLiveOrderCancelAuthorizationInput,
): Extract<LiveOrderAuthorizationBinding, { readonly action: "CANCEL" }> {
  return {
    action: "CANCEL",
    planId: input.planId,
    planOrderId: input.planOrderId,
    logicalOrderId: input.logicalOrderId,
    accountId: input.accountId,
    brokerAccountReference: input.brokerAccountReference,
    clientOrderId: input.clientOrderId,
    brokerOrderId: input.brokerOrderId,
    economicTerms: null,
  };
}

function copyEconomicTerms(terms: LiveOrderEconomicTerms): LiveOrderEconomicTerms {
  return Object.freeze({ ...terms });
}

function economicTermsMatch(
  left: LiveOrderEconomicTerms | null,
  right: LiveOrderEconomicTerms | null,
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.marketCountry === right.marketCountry &&
      left.currency === right.currency &&
      left.symbol === right.symbol &&
      left.side === right.side &&
      left.orderType === right.orderType &&
      left.timeInForce === right.timeInForce &&
      left.quantity === right.quantity &&
      left.limitPriceMinor === right.limitPriceMinor)
  );
}

function validateEconomicTerms(terms: LiveOrderEconomicTerms): void {
  if (
    terms.marketCountry !== "KR" ||
    terms.currency !== "KRW" ||
    !/^\d{6}$/.test(terms.symbol) ||
    (terms.side !== "BUY" && terms.side !== "SELL") ||
    terms.orderType !== "LIMIT" ||
    terms.timeInForce !== "DAY" ||
    !/^[1-9]\d*$/.test(terms.quantity) ||
    !/^[1-9]\d*$/.test(terms.limitPriceMinor)
  ) {
    throw new Error("Live 주문 경제조건은 KR/KRW LIMIT DAY 양수 정수 계약을 만족해야 합니다.");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new Error(`${name}은(는) 비어 있을 수 없습니다.`);
}

export interface KrwLimitDayOrderRequest {
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  /** Broker-specific opaque reference. Toss uses the decimal accountSeq string. */
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
}

export interface BrokerOrderLookup {
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly brokerOrderId: string;
}

export interface BrokerOpenOrdersQuery {
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
}

export interface BrokerOrderCancelRequest {
  readonly planId: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: AccountId;
  readonly brokerAccountReference: string;
  readonly clientOrderId: string;
  readonly brokerOrderId: string;
  readonly primaryLedgerState: "PENDING" | "PARTIAL_FILLED";
}

export interface BrokerOrderAttemptMetadata {
  readonly brokerId: BrokerId;
  readonly operationId: "createOrder" | "getOrder" | "getOrders" | "cancelOrder";
  readonly requestId: string | null;
  readonly httpStatus: number | null;
  readonly rateLimitGroup: string | null;
  readonly receivedAt: IsoDateTime;
  readonly dispatchStage: "PRE_DISPATCH" | "BROKER_RESPONSE" | "BROKER_OUTCOME_UNKNOWN";
  readonly upstreamOperationId: string | null;
  /** Pre-request append-only authorization audit reference. */
  readonly auditReference: string | null;
  /** Optional transport response audit reference, kept separately if provided. */
  readonly transportAuditReference: string | null;
}

export type BrokerOrderWriteOutcome =
  "ACKNOWLEDGED" | "REJECTED" | "AMBIGUOUS" | "INTEGRITY_BLOCKED";

interface BrokerOrderOperationEvidence {
  readonly reasonCode: string;
  readonly metadata: BrokerOrderAttemptMetadata;
  readonly rawPayload: unknown;
}

export type BrokerOrderSubmissionResult =
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "ACKNOWLEDGED";
      readonly normalizedState: "PENDING";
      readonly brokerOrderId: string;
      readonly clientOrderId: string;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "REJECTED";
      readonly normalizedState: "REJECTED";
      readonly brokerOrderId: null;
      readonly clientOrderId: string;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "AMBIGUOUS";
      readonly normalizedState: "UNKNOWN";
      readonly brokerOrderId: string | null;
      readonly clientOrderId: string;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "INTEGRITY_BLOCKED";
      readonly normalizedState: "UNKNOWN_BLOCKED";
      readonly brokerOrderId: string | null;
      readonly clientOrderId: string;
    });

export type BrokerCancelLifecycle =
  "NONE" | "PENDING" | "REQUEST_ACCEPTED" | "REJECTED" | "AMBIGUOUS" | "UNSUPPORTED_BLOCKED";

export type BrokerOrderCancellationResult =
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "ACKNOWLEDGED";
      readonly primaryState: "PENDING" | "PARTIAL_FILLED";
      readonly cancelLifecycle: "REQUEST_ACCEPTED";
      readonly brokerOrderId: string;
      readonly brokerActionOrderId: string;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "REJECTED";
      readonly primaryState: "PENDING" | "PARTIAL_FILLED";
      readonly cancelLifecycle: "REJECTED";
      readonly brokerOrderId: string;
      readonly brokerActionOrderId: null;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "AMBIGUOUS";
      readonly primaryState: "UNKNOWN";
      readonly cancelLifecycle: "AMBIGUOUS";
      readonly brokerOrderId: string;
      readonly brokerActionOrderId: null;
    })
  | (BrokerOrderOperationEvidence & {
      readonly outcome: "INTEGRITY_BLOCKED";
      readonly primaryState: "UNKNOWN_BLOCKED";
      readonly cancelLifecycle: "UNSUPPORTED_BLOCKED";
      readonly brokerOrderId: string;
      readonly brokerActionOrderId: string | null;
    });

export type BrokerPrimaryOrderState =
  "PENDING" | "PARTIAL_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN_BLOCKED";

export type BrokerAuxiliaryOrderStatus = "CANCEL_REJECTED" | "REPLACE_REJECTED";

export interface BrokerOrderObservation {
  readonly brokerOrderId: string;
  readonly marketCountry: "KR" | "UNKNOWN";
  readonly currency: string;
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL" | "UNKNOWN";
  readonly orderType: string;
  readonly timeInForce: string;
  readonly brokerStatusRaw: string;
  /** Null for auxiliary action records, which must never overwrite the original order. */
  readonly primaryState: BrokerPrimaryOrderState | null;
  readonly cancelLifecycle: BrokerCancelLifecycle;
  readonly auxiliaryStatus: BrokerAuxiliaryOrderStatus | null;
  readonly mayOverwritePrimary: boolean;
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint | null;
  readonly filledQuantity: bigint;
  readonly averageFilledPriceMinor: bigint | null;
  readonly filledGrossNotionalMinor: bigint | null;
  readonly feeMinor: bigint | null;
  readonly taxMinor: bigint | null;
  readonly orderedAt: IsoDateTime;
  readonly canceledAt: IsoDateTime | null;
  readonly filledAt: IsoDateTime | null;
}

export type BrokerOrderReadResult<Value> =
  | {
      readonly outcome: "OBSERVED";
      readonly value: Value;
      readonly reasonCode: "ORDER_OBSERVED";
      readonly metadata: BrokerOrderAttemptMetadata;
      readonly rawPayload: unknown;
    }
  | {
      readonly outcome: "UNAVAILABLE" | "INTEGRITY_BLOCKED";
      readonly value: null;
      readonly reasonCode: string;
      readonly metadata: BrokerOrderAttemptMetadata;
      readonly rawPayload: unknown;
    };

export interface BrokerLiveOrderPort {
  submitOrder(
    authorization: LiveOrderSubmitAuthorization,
    request: KrwLimitDayOrderRequest,
  ): Promise<BrokerOrderSubmissionResult>;

  getOrder(request: BrokerOrderLookup): Promise<BrokerOrderReadResult<BrokerOrderObservation>>;

  listOpenOrders(
    request: BrokerOpenOrdersQuery,
  ): Promise<BrokerOrderReadResult<readonly BrokerOrderObservation[]>>;

  cancelOrder(
    authorization: LiveOrderCancelAuthorization,
    request: BrokerOrderCancelRequest,
  ): Promise<BrokerOrderCancellationResult>;
}
