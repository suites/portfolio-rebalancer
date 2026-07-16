import { createHash } from "node:crypto";

export const CLIENT_ORDER_ID_VERSION = "TOSS_CLIENT_ORDER_ID_V1" as const;

export interface CanonicalOrderIntent {
  readonly logicalOrderId: string;
  readonly rebalanceRunId: string;
  readonly planVersion: number;
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
  validateIntent(intent);
  const canonical = JSON.stringify({
    version: CLIENT_ORDER_ID_VERSION,
    logicalOrderId: intent.logicalOrderId,
    rebalanceRunId: intent.rebalanceRunId,
    planVersion: intent.planVersion,
    phase: intent.phase,
    marketCountry: intent.marketCountry,
    symbol: intent.symbol,
    side: intent.side,
    orderType: intent.orderType,
    timeInForce: intent.timeInForce,
    quantity: intent.quantity,
    price: intent.price,
  });
  const digest = createHash("sha256").update(canonical).digest("base64url").slice(0, 32);
  const clientOrderId = `pr1_${digest}`;
  if (clientOrderId.length !== 36 || !/^[A-Za-z0-9_-]+$/.test(clientOrderId)) {
    throw new Error("결정적 clientOrderId 생성 결과가 토스 제약을 만족하지 않습니다.");
  }
  return clientOrderId;
}

function validateIntent(intent: CanonicalOrderIntent): void {
  if (
    intent.logicalOrderId.trim().length === 0 ||
    intent.rebalanceRunId.trim().length === 0 ||
    !Number.isSafeInteger(intent.planVersion) ||
    intent.planVersion < 1 ||
    !/^[A-Za-z0-9.-]+$/.test(intent.symbol) ||
    !isPositiveDecimal(intent.quantity) ||
    (intent.orderType === "LIMIT" && (intent.price === null || !isPositiveDecimal(intent.price))) ||
    (intent.orderType === "MARKET" && intent.price !== null)
  ) {
    throw new Error("canonical 주문 의도가 clientOrderId 생성 규칙을 만족하지 않습니다.");
  }
}

function isPositiveDecimal(value: string): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 30) return false;
  return value
    .replace(".", "")
    .split("")
    .some((digit) => digit !== "0");
}
