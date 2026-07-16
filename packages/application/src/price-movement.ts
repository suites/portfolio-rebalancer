import type { PriceQuote } from "@portfolio-rebalancer/broker";

export type PriceMovementStatus = "READY" | "BLOCKED" | "UNKNOWN";

export type PriceMovementReasonCode =
  | "PRICE_MOVEMENT_ACCEPTABLE"
  | "PRICE_MOVEMENT_POLICY_INVALID"
  | "PRICE_MOVEMENT_INSTRUMENT_MISMATCH"
  | "PRICE_MOVEMENT_CURRENCY_MISMATCH"
  | "PRICE_MOVEMENT_VALUE_INVALID"
  | "PRICE_MOVEMENT_TIME_UNKNOWN"
  | "PRICE_MOVEMENT_TIME_INVALID"
  | "PRICE_MOVEMENT_TIME_ORDER_INVALID"
  | "PRICE_MOVEMENT_LIMIT_EXCEEDED";

export interface PriceMovementDecision {
  readonly status: PriceMovementStatus;
  readonly canProceed: boolean;
  readonly reasonCode: PriceMovementReasonCode;
  readonly message: string;
  readonly protectiveAction: string;
  readonly nextAction: string;
  readonly changeBasisPointsFloor: bigint | null;
}

export function evaluatePriceMovement(input: {
  readonly previous: PriceQuote;
  readonly current: PriceQuote;
  readonly maxAbsoluteChangeBasisPoints: bigint;
}): PriceMovementDecision {
  if (input.maxAbsoluteChangeBasisPoints < 0n || input.maxAbsoluteChangeBasisPoints > 10_000n) {
    return decision(
      "BLOCKED",
      "PRICE_MOVEMENT_POLICY_INVALID",
      "가격 급변 허용 범위가 0bp 이상 10000bp 이하가 아닙니다.",
      null,
      "가격 급변 정책을 확인하세요.",
    );
  }
  if (
    input.previous.marketCountry !== input.current.marketCountry ||
    input.previous.symbol !== input.current.symbol
  ) {
    return decision(
      "BLOCKED",
      "PRICE_MOVEMENT_INSTRUMENT_MISMATCH",
      "직전 시세와 현재 시세의 종목이 일치하지 않습니다.",
      null,
      "같은 정규 종목 키의 시세를 다시 조회하세요.",
    );
  }
  if (input.previous.currency !== input.current.currency) {
    return decision(
      "BLOCKED",
      "PRICE_MOVEMENT_CURRENCY_MISMATCH",
      "직전 시세와 현재 시세의 통화가 일치하지 않습니다.",
      null,
      "같은 통화의 시세를 다시 조회하세요.",
    );
  }

  const previous = parsePositiveDecimal(input.previous.price);
  const current = parsePositiveDecimal(input.current.price);
  if (!previous || !current) {
    return decision(
      "UNKNOWN",
      "PRICE_MOVEMENT_VALUE_INVALID",
      "가격 급변 비교에 필요한 양수 시세를 안전하게 해석할 수 없습니다.",
      null,
      "양수 decimal 가격이 포함된 시세를 다시 조회하세요.",
    );
  }
  if (input.previous.observedAt === null || input.current.observedAt === null) {
    return decision(
      "UNKNOWN",
      "PRICE_MOVEMENT_TIME_UNKNOWN",
      "직전 또는 현재 시세의 관측 시각을 확인할 수 없습니다.",
      null,
      "관측 시각이 포함된 두 시세를 다시 조회하세요.",
    );
  }
  const previousTime = Date.parse(input.previous.observedAt);
  const currentTime = Date.parse(input.current.observedAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) {
    return decision(
      "UNKNOWN",
      "PRICE_MOVEMENT_TIME_INVALID",
      "가격 급변 비교 시각을 안전하게 해석할 수 없습니다.",
      null,
      "offset이 포함된 관측 시각으로 다시 조회하세요.",
    );
  }
  if (currentTime <= previousTime) {
    return decision(
      "BLOCKED",
      "PRICE_MOVEMENT_TIME_ORDER_INVALID",
      "현재 시세 관측 시각이 직전 시세보다 늦지 않습니다.",
      null,
      "더 최신의 시세를 다시 조회하세요.",
    );
  }

  const scale = previous.scale > current.scale ? previous.scale : current.scale;
  const previousScaled = previous.numerator * (scale / previous.scale);
  const currentScaled = current.numerator * (scale / current.scale);
  const absoluteChange =
    currentScaled >= previousScaled
      ? currentScaled - previousScaled
      : previousScaled - currentScaled;
  const changeBasisPointsFloor = (absoluteChange * 10_000n) / previousScaled;
  const exceeds = absoluteChange * 10_000n > input.maxAbsoluteChangeBasisPoints * previousScaled;
  if (exceeds) {
    return decision(
      "BLOCKED",
      "PRICE_MOVEMENT_LIMIT_EXCEEDED",
      "현재 가격이 직전 관측 가격에서 허용 범위 이상 변했습니다.",
      changeBasisPointsFloor,
      "가격과 시장 상태를 사람이 확인하고 새 계획을 생성하세요.",
    );
  }
  return decision(
    "READY",
    "PRICE_MOVEMENT_ACCEPTABLE",
    "직전 시세 대비 가격 변화가 허용 범위 안입니다.",
    changeBasisPointsFloor,
    "현재 시세를 계획 입력으로 고정하고 주문 직전에 다시 비교하세요.",
  );
}

function parsePositiveDecimal(
  value: string,
): { readonly numerator: bigint; readonly scale: bigint } | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 30) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= 0n) return null;
  return {
    numerator,
    scale: 10n ** BigInt(fraction.length),
  };
}

function decision(
  status: PriceMovementStatus,
  reasonCode: PriceMovementReasonCode,
  message: string,
  changeBasisPointsFloor: bigint | null,
  nextAction: string,
): PriceMovementDecision {
  return {
    status,
    canProceed: status === "READY",
    reasonCode,
    message,
    protectiveAction:
      status === "READY"
        ? "현재 가격을 계획 입력으로만 사용하고 제출 전에 다시 검증합니다."
        : "가격 급변 여부를 확인할 때까지 주문 계획과 실행을 차단했습니다.",
    nextAction,
    changeBasisPointsFloor,
  };
}
