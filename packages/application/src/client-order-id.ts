import { createHash } from "node:crypto";

export const CLIENT_ORDER_ID_VERSION = "TOSS_CLIENT_ORDER_ID_V1" as const;

export interface CanonicalOrderIntent {
  readonly logicalOrderId: string;
  readonly rebalanceRunId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly phase: "SELL" | "BUY";
  readonly marketCountry: "KR" | "US";
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly orderType: "LIMIT" | "MARKET";
  readonly timeInForce: "DAY" | "CLS";
  readonly quantity: string;
  readonly price: string | null;
}

export function createTossClientOrderId(intent: CanonicalOrderIntent): string {
  const canonical = createCanonicalOrderIntent(intent);
  const digest = createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
  const clientOrderId = `pr1_${digest}`;
  if (clientOrderId.length !== 36 || !/^[A-Za-z0-9_-]+$/.test(clientOrderId)) {
    throw new Error("결정적 clientOrderId 생성 결과가 토스 제약을 만족하지 않습니다.");
  }
  return clientOrderId;
}

export function createCanonicalOrderIntent(intent: CanonicalOrderIntent): string {
  validateIntent(intent);
  return JSON.stringify({
    version: CLIENT_ORDER_ID_VERSION,
    logicalOrderId: intent.logicalOrderId,
    rebalanceRunId: intent.rebalanceRunId,
    planId: intent.planId,
    planVersion: intent.planVersion,
    planHash: intent.planHash,
    phase: intent.phase,
    marketCountry: intent.marketCountry,
    symbol: intent.symbol,
    side: intent.side,
    orderType: intent.orderType,
    timeInForce: intent.timeInForce,
    quantity: intent.quantity,
    price: intent.price,
  });
}

export function createCanonicalOrderIntentDigest(intent: CanonicalOrderIntent): string {
  return createHash("sha256").update(createCanonicalOrderIntent(intent)).digest("hex");
}

function validateIntent(intent: CanonicalOrderIntent): void {
  if (
    !isUuid(intent.logicalOrderId) ||
    !isUuid(intent.rebalanceRunId) ||
    !isUuid(intent.planId) ||
    !Number.isSafeInteger(intent.planVersion) ||
    intent.planVersion < 1 ||
    !/^[a-f0-9]{64}$/.test(intent.planHash) ||
    !/^[A-Za-z0-9.-]+$/.test(intent.symbol) ||
    !isPositiveDecimal(intent.quantity) ||
    (intent.orderType === "LIMIT" && (intent.price === null || !isPositiveDecimal(intent.price))) ||
    (intent.orderType === "MARKET" && intent.price !== null)
  ) {
    throw new Error("canonical 주문 의도가 clientOrderId 생성 규칙을 만족하지 않습니다.");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPositiveDecimal(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 30) return false;
  return value
    .replace(".", "")
    .split("")
    .some((digit) => digit !== "0");
}
