const MAX_SIGNED_64 = 9_223_372_036_854_775_807n;

export type OrderReservationReasonCode =
  | "ORDER_RESERVATION_READY"
  | "ORDER_RESERVATION_INPUT_INVALID"
  | "SELL_UPPER_PRICE_LIMIT_MISSING"
  | "SELL_UPPER_PRICE_LIMIT_INVALID"
  | "ORDER_RESERVATION_OVERFLOW";

export interface OrderGrossReservationDecision {
  readonly status: "READY" | "BLOCKED";
  readonly canReserve: boolean;
  readonly reasonCode: OrderReservationReasonCode;
  readonly message: string;
  readonly plannedGrossMinor: bigint | null;
  readonly reservedGrossMinor: bigint | null;
}

/**
 * Reserves a conservative KR gross turnover amount before an order is exposed
 * to an executor.
 *
 * BUY cannot fill above its limit price. SELL can receive price improvement,
 * so its verified daily upper price limit is used to keep the daily turnover
 * reservation from understating a later fill.
 */
export function calculateOrderGrossReservation(input: {
  readonly side: "BUY" | "SELL";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly upperPriceLimitMinor: bigint | null;
}): OrderGrossReservationDecision {
  if (input.quantity <= 0n || input.limitPriceMinor <= 0n) {
    return blocked(
      "ORDER_RESERVATION_INPUT_INVALID",
      "주문 수량과 지정가는 0보다 커야 합니다.",
    );
  }

  const plannedGrossMinor = multiplyWithinSigned64(input.quantity, input.limitPriceMinor);
  if (plannedGrossMinor === null) {
    return blocked(
      "ORDER_RESERVATION_OVERFLOW",
      "계획 주문금액이 저장 가능한 범위를 넘었습니다.",
    );
  }

  if (input.side === "BUY") {
    return ready(
      plannedGrossMinor,
      plannedGrossMinor,
      "매수 지정가를 최대 체결가격으로 사용해 거래금액을 예약했습니다.",
    );
  }

  if (input.upperPriceLimitMinor === null) {
    return blocked(
      "SELL_UPPER_PRICE_LIMIT_MISSING",
      "매도 가격 개선까지 포함할 상한가를 확인하지 못했습니다.",
      plannedGrossMinor,
    );
  }
  if (input.upperPriceLimitMinor < input.limitPriceMinor || input.upperPriceLimitMinor <= 0n) {
    return blocked(
      "SELL_UPPER_PRICE_LIMIT_INVALID",
      "매도 상한가가 지정가보다 낮거나 올바르지 않습니다.",
      plannedGrossMinor,
    );
  }
  const reservedGrossMinor = multiplyWithinSigned64(
    input.quantity,
    input.upperPriceLimitMinor,
  );
  if (reservedGrossMinor === null) {
    return blocked(
      "ORDER_RESERVATION_OVERFLOW",
      "보수적으로 계산한 매도 거래금액 예약이 저장 가능한 범위를 넘었습니다.",
      plannedGrossMinor,
    );
  }
  return ready(
    plannedGrossMinor,
    reservedGrossMinor,
    "검증된 상한가를 사용해 매도 가격 개선까지 포함한 거래금액을 예약했습니다.",
  );
}

function multiplyWithinSigned64(left: bigint, right: bigint): bigint | null {
  const product = left * right;
  return product <= MAX_SIGNED_64 ? product : null;
}

function ready(
  plannedGrossMinor: bigint,
  reservedGrossMinor: bigint,
  message: string,
): OrderGrossReservationDecision {
  return {
    status: "READY",
    canReserve: true,
    reasonCode: "ORDER_RESERVATION_READY",
    message,
    plannedGrossMinor,
    reservedGrossMinor,
  };
}

function blocked(
  reasonCode: Exclude<OrderReservationReasonCode, "ORDER_RESERVATION_READY">,
  message: string,
  plannedGrossMinor: bigint | null = null,
): OrderGrossReservationDecision {
  return {
    status: "BLOCKED",
    canReserve: false,
    reasonCode,
    message,
    plannedGrossMinor,
    reservedGrossMinor: null,
  };
}
