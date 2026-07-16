export type RiskLimitStatus = "READY" | "BLOCKED";

export type TradeLimitReasonCode =
  | "TRADE_LIMITS_OK"
  | "TRADE_LIMIT_POLICY_INVALID"
  | "TRADE_LIMIT_INPUT_INVALID"
  | "SINGLE_ORDER_LIMIT_EXCEEDED"
  | "DAILY_GROSS_LIMIT_EXCEEDED"
  | "DAILY_TURNOVER_LIMIT_EXCEEDED";

export interface TradeLimitDecision {
  readonly status: RiskLimitStatus;
  readonly canProceed: boolean;
  readonly reasonCode: TradeLimitReasonCode;
  readonly message: string;
  readonly subjectKey: string | null;
  readonly projectedDailyGrossMinor: bigint | null;
  readonly projectedTurnoverBasisPointsFloor: bigint | null;
}

export interface PlannedTradeNotional {
  readonly logicalOrderId: string;
  readonly grossNotionalMinor: bigint;
}

export function evaluateTradeNotionalLimits(input: {
  readonly baselinePortfolioValueMinor: bigint;
  readonly tradeDayFilledGrossMinor: bigint;
  readonly reservedPendingGrossMinor: bigint;
  readonly plannedOrders: readonly PlannedTradeNotional[];
  readonly maxSingleOrderMinor: bigint;
  readonly maxDailyGrossMinor: bigint;
  readonly maxDailyTurnoverBasisPoints: bigint;
}): TradeLimitDecision {
  if (
    input.maxSingleOrderMinor < 0n ||
    input.maxDailyGrossMinor < input.maxSingleOrderMinor ||
    input.maxDailyTurnoverBasisPoints < 0n ||
    input.maxDailyTurnoverBasisPoints > 10_000n
  ) {
    return tradeDecision(
      "BLOCKED",
      "TRADE_LIMIT_POLICY_INVALID",
      "주문별·일일 총액 또는 회전율 한도 정책이 올바르지 않습니다.",
      null,
      null,
      null,
    );
  }
  const ids = input.plannedOrders.map(({ logicalOrderId }) => logicalOrderId);
  if (
    input.baselinePortfolioValueMinor <= 0n ||
    input.tradeDayFilledGrossMinor < 0n ||
    input.reservedPendingGrossMinor < 0n ||
    ids.some((id) => id.trim().length === 0) ||
    new Set(ids).size !== ids.length ||
    input.plannedOrders.some(({ grossNotionalMinor }) => grossNotionalMinor < 0n)
  ) {
    return tradeDecision(
      "BLOCKED",
      "TRADE_LIMIT_INPUT_INVALID",
      "거래 한도 계산 입력을 안전하게 해석할 수 없습니다.",
      null,
      null,
      null,
    );
  }

  const oversized = input.plannedOrders.find(
    ({ grossNotionalMinor }) => grossNotionalMinor > input.maxSingleOrderMinor,
  );
  const plannedGrossMinor = input.plannedOrders.reduce(
    (sum, order) => sum + order.grossNotionalMinor,
    0n,
  );
  const projectedDailyGrossMinor =
    input.tradeDayFilledGrossMinor + input.reservedPendingGrossMinor + plannedGrossMinor;
  const projectedTurnoverBasisPointsFloor =
    (projectedDailyGrossMinor * 10_000n) / input.baselinePortfolioValueMinor;
  if (oversized) {
    return tradeDecision(
      "BLOCKED",
      "SINGLE_ORDER_LIMIT_EXCEEDED",
      `${oversized.logicalOrderId} 주문 금액이 단일 주문 한도를 초과합니다.`,
      oversized.logicalOrderId,
      projectedDailyGrossMinor,
      projectedTurnoverBasisPointsFloor,
    );
  }
  if (projectedDailyGrossMinor > input.maxDailyGrossMinor) {
    return tradeDecision(
      "BLOCKED",
      "DAILY_GROSS_LIMIT_EXCEEDED",
      "체결·예약·신규 계획을 합한 일일 거래금액이 한도를 초과합니다.",
      null,
      projectedDailyGrossMinor,
      projectedTurnoverBasisPointsFloor,
    );
  }
  if (
    projectedDailyGrossMinor * 10_000n >
    input.maxDailyTurnoverBasisPoints * input.baselinePortfolioValueMinor
  ) {
    return tradeDecision(
      "BLOCKED",
      "DAILY_TURNOVER_LIMIT_EXCEEDED",
      "보수적으로 예약한 일일 회전율이 한도를 초과합니다.",
      null,
      projectedDailyGrossMinor,
      projectedTurnoverBasisPointsFloor,
    );
  }
  return tradeDecision(
    "READY",
    "TRADE_LIMITS_OK",
    "주문별·일일 총액과 회전율이 허용 범위 안입니다.",
    null,
    projectedDailyGrossMinor,
    projectedTurnoverBasisPointsFloor,
  );
}

export type ExposureLimitReasonCode =
  | "EXPOSURE_LIMITS_OK"
  | "EXPOSURE_LIMIT_POLICY_INVALID"
  | "EXPOSURE_LIMIT_INPUT_INVALID"
  | "INSTRUMENT_WEIGHT_LIMIT_EXCEEDED"
  | "ASSET_CLASS_WEIGHT_LIMIT_EXCEEDED"
  | "RISKY_ASSET_WEIGHT_LIMIT_EXCEEDED";

export interface ExposureValue {
  readonly key: string;
  readonly valueMinor: bigint;
}

export interface ExposureLimitDecision {
  readonly status: RiskLimitStatus;
  readonly canProceed: boolean;
  readonly reasonCode: ExposureLimitReasonCode;
  readonly message: string;
  readonly subjectKey: string | null;
  readonly observedBasisPointsFloor: bigint | null;
}

export function evaluateExposureLimits(input: {
  readonly portfolioValueMinor: bigint;
  readonly instruments: readonly ExposureValue[];
  readonly assetClasses: readonly ExposureValue[];
  readonly riskyAssetValueMinor: bigint;
  readonly maxInstrumentBasisPoints: bigint;
  readonly maxAssetClassBasisPoints: bigint;
  readonly maxRiskyAssetBasisPoints: bigint;
}): ExposureLimitDecision {
  if (
    !basisPointLimitIsValid(input.maxInstrumentBasisPoints) ||
    !basisPointLimitIsValid(input.maxAssetClassBasisPoints) ||
    !basisPointLimitIsValid(input.maxRiskyAssetBasisPoints)
  ) {
    return exposureDecision(
      "BLOCKED",
      "EXPOSURE_LIMIT_POLICY_INVALID",
      "종목·자산군·위험자산 비중 한도가 올바르지 않습니다.",
      null,
      null,
    );
  }
  if (
    input.portfolioValueMinor <= 0n ||
    input.riskyAssetValueMinor < 0n ||
    input.riskyAssetValueMinor > input.portfolioValueMinor ||
    !exposuresAreValid(input.instruments, input.portfolioValueMinor) ||
    !exposuresAreValid(input.assetClasses, input.portfolioValueMinor)
  ) {
    return exposureDecision(
      "BLOCKED",
      "EXPOSURE_LIMIT_INPUT_INVALID",
      "예상 비중 한도 계산 입력을 안전하게 해석할 수 없습니다.",
      null,
      null,
    );
  }

  const instrument = input.instruments.find(
    ({ valueMinor }) =>
      valueMinor * 10_000n > input.maxInstrumentBasisPoints * input.portfolioValueMinor,
  );
  if (instrument) {
    return exposureDecision(
      "BLOCKED",
      "INSTRUMENT_WEIGHT_LIMIT_EXCEEDED",
      `${instrument.key} 종목의 예상 비중이 종목 한도를 초과합니다.`,
      instrument.key,
      basisPointsFloor(instrument.valueMinor, input.portfolioValueMinor),
    );
  }
  const assetClass = input.assetClasses.find(
    ({ valueMinor }) =>
      valueMinor * 10_000n > input.maxAssetClassBasisPoints * input.portfolioValueMinor,
  );
  if (assetClass) {
    return exposureDecision(
      "BLOCKED",
      "ASSET_CLASS_WEIGHT_LIMIT_EXCEEDED",
      `${assetClass.key} 자산군의 예상 비중이 자산군 한도를 초과합니다.`,
      assetClass.key,
      basisPointsFloor(assetClass.valueMinor, input.portfolioValueMinor),
    );
  }
  if (
    input.riskyAssetValueMinor * 10_000n >
    input.maxRiskyAssetBasisPoints * input.portfolioValueMinor
  ) {
    return exposureDecision(
      "BLOCKED",
      "RISKY_ASSET_WEIGHT_LIMIT_EXCEEDED",
      "전체 위험자산의 예상 비중이 한도를 초과합니다.",
      "RISKY_ASSETS",
      basisPointsFloor(input.riskyAssetValueMinor, input.portfolioValueMinor),
    );
  }
  return exposureDecision(
    "READY",
    "EXPOSURE_LIMITS_OK",
    "종목·자산군·위험자산 예상 비중이 허용 범위 안입니다.",
    null,
    null,
  );
}

function exposuresAreValid(exposures: readonly ExposureValue[], portfolioValueMinor: bigint) {
  const keys = exposures.map(({ key }) => key);
  return (
    keys.every((key) => key.trim().length > 0) &&
    new Set(keys).size === keys.length &&
    exposures.every(({ valueMinor }) => valueMinor >= 0n && valueMinor <= portfolioValueMinor)
  );
}

function basisPointLimitIsValid(value: bigint): boolean {
  return value >= 0n && value <= 10_000n;
}

function basisPointsFloor(valueMinor: bigint, totalMinor: bigint): bigint {
  return (valueMinor * 10_000n) / totalMinor;
}

function tradeDecision(
  status: RiskLimitStatus,
  reasonCode: TradeLimitReasonCode,
  message: string,
  subjectKey: string | null,
  projectedDailyGrossMinor: bigint | null,
  projectedTurnoverBasisPointsFloor: bigint | null,
): TradeLimitDecision {
  return {
    status,
    canProceed: status === "READY",
    reasonCode,
    message,
    subjectKey,
    projectedDailyGrossMinor,
    projectedTurnoverBasisPointsFloor,
  };
}

function exposureDecision(
  status: RiskLimitStatus,
  reasonCode: ExposureLimitReasonCode,
  message: string,
  subjectKey: string | null,
  observedBasisPointsFloor: bigint | null,
): ExposureLimitDecision {
  return {
    status,
    canProceed: status === "READY",
    reasonCode,
    message,
    subjectKey,
    observedBasisPointsFloor,
  };
}
