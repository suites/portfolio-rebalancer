import {
  evaluateExposureLimits,
  evaluateTradeNotionalLimits,
  type ExposureValue,
  type PlannedTradeNotional,
} from "./risk-limits";

export type ExecutionMode = "PAPER" | "LIVE";

export interface ExecutionOperationalConfig {
  readonly mode: ExecutionMode;
  readonly killSwitch: boolean;
  readonly limits: {
    readonly minimumOrderGrossMinor: string;
    readonly maxSingleOrderGrossMinor: string;
    readonly maxDailyGrossMinor: string;
    readonly maxDailyTurnoverBasisPoints: number;
    readonly maxInstrumentWeightBasisPoints: number;
    readonly maxAssetClassWeightBasisPoints: number;
    readonly maxRiskyWeightBasisPoints: number;
  };
  readonly live: {
    readonly enabled: boolean;
    readonly accountAllowlistHmacs: readonly string[];
    readonly approvalTtlSeconds: number;
    readonly maxSingleOrderGrossMinor: string;
    readonly maxDailyGrossMinor: string;
    readonly tinyLiveMaxGrossMinor: string;
  };
}

/**
 * The engine must produce this discriminated value from OperationalConfigSchema.
 * Keeping validation at the input boundary avoids duplicating the Zod policy in
 * the pure application package while still making invalid input fail closed.
 */
export type ValidatedExecutionOperationalConfig =
  | {
      readonly status: "VALID";
      readonly value: ExecutionOperationalConfig;
    }
  | {
      readonly status: "INVALID";
    };

export interface PlannedExecutionOrder extends PlannedTradeNotional {
  readonly marketCountry: "KR" | "US";
  readonly orderType: "LIMIT" | "MARKET";
  readonly timeInForce: "DAY" | "CLS";
}

export interface ExecutionPlanIdentity {
  readonly planId: string;
  readonly planHash: string;
  readonly mode: ExecutionMode;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly targetConfigVersionId: string;
  readonly targetConfigContentHash: string;
  readonly orders: readonly PlannedExecutionOrder[];
}

export interface CurrentExecutionIdentity {
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly targetConfigVersionId: string;
  readonly targetConfigContentHash: string;
}

export interface ExistingOrderSummary {
  readonly logicalOrderId: string;
  readonly state:
    | "PLANNED"
    | "SUBMITTING"
    | "PENDING"
    | "PARTIAL_FILLED"
    | "FILLED"
    | "CANCELED"
    | "REJECTED"
    | "UNKNOWN"
    | "UNKNOWN_BLOCKED";
}

export interface ManualLiveApprovalEvidence {
  readonly approvalId: string;
  readonly approvalDigest: string;
  readonly expectedApprovalDigest: string;
  readonly approvedPlanHash: string;
  readonly approvedAccountHmac: string;
  readonly approvedAt: Date;
  readonly consumedAt: Date | null;
}

export interface ExecutionRiskCheck {
  readonly code: string;
  readonly outcome: "PASSED" | "BLOCKED";
  readonly message: string;
  readonly subjectKey: string | null;
}

export interface ExecutionRiskGateDecision {
  readonly status: "READY" | "BLOCKED";
  readonly canExecute: boolean;
  readonly checks: readonly ExecutionRiskCheck[];
}

export interface ExecutionRiskGateInput {
  readonly operationalConfig: ValidatedExecutionOperationalConfig;
  readonly requestedMode: ExecutionMode;
  readonly now: Date;
  readonly accountExternalRefHmac: string;
  readonly plan: ExecutionPlanIdentity;
  readonly currentIdentity: CurrentExecutionIdentity;
  readonly existingOrders: readonly ExistingOrderSummary[];
  readonly tradeDayFilledGrossMinor: bigint;
  readonly reservedPendingGrossMinor: bigint;
  readonly baselinePortfolioValueMinor: bigint;
  readonly projectedExposure: {
    readonly portfolioValueMinor: bigint;
    readonly instruments: readonly ExposureValue[];
    readonly assetClasses: readonly ExposureValue[];
    readonly riskyAssetValueMinor: bigint;
  };
  readonly manualApproval: ManualLiveApprovalEvidence | null;
}

const UNRESOLVED_STATES: ReadonlySet<ExistingOrderSummary["state"]> = new Set([
  "PLANNED",
  "SUBMITTING",
  "PENDING",
  "PARTIAL_FILLED",
  "UNKNOWN",
  "UNKNOWN_BLOCKED",
]);

export function evaluateExecutionRiskGate(
  input: ExecutionRiskGateInput,
): ExecutionRiskGateDecision {
  if (input.operationalConfig.status === "INVALID") {
    return decision([
      blocked(
        "OPERATIONAL_CONFIG_INVALID",
        "운영 설정을 검증할 수 없어 주문 실행을 차단합니다.",
        null,
      ),
    ]);
  }

  const config = input.operationalConfig.value;
  const checks: ExecutionRiskCheck[] = [];
  checks.push(
    passOrBlock(
      config.mode === input.requestedMode,
      "EXECUTION_MODE_MATCHED",
      "EXECUTION_MODE_MISMATCH",
      "요청한 실행 모드와 운영 설정이 일치합니다.",
      "요청한 실행 모드와 운영 설정이 일치하지 않습니다.",
      input.requestedMode,
    ),
  );
  checks.push(
    passOrBlock(
      config.killSwitch === false,
      "KILL_SWITCH_RELEASED",
      "KILL_SWITCH_ACTIVE",
      "킬 스위치가 명시적으로 해제되어 있습니다.",
      "킬 스위치가 켜져 있어 Paper와 Live 주문 실행을 모두 차단합니다.",
      null,
    ),
  );
  checks.push(
    passOrBlock(
      input.plan.mode === input.requestedMode,
      "PLAN_MODE_MATCHED",
      "PLAN_MODE_MISMATCH",
      "저장된 계획의 실행 모드가 요청과 일치합니다.",
      "다른 모드로 만든 계획을 실행할 수 없습니다.",
      input.plan.planId,
    ),
  );
  checks.push(evaluateExecutableOrderSet(input.plan.orders, config));
  checks.push(evaluatePlanIdentity(input.plan, input.currentIdentity));
  checks.push(evaluateExistingOrders(input.existingOrders));
  checks.push(evaluateGeneralTradeLimits(input, config));
  checks.push(evaluateProjectedExposure(input, config));

  if (input.requestedMode === "LIVE") {
    checks.push(
      passOrBlock(
        config.live.enabled,
        "LIVE_EXPLICITLY_ENABLED",
        "LIVE_NOT_ENABLED",
        "Live 실행이 운영 설정에서 명시적으로 활성화되어 있습니다.",
        "Live 실행이 운영 설정에서 활성화되지 않았습니다.",
        null,
      ),
    );
    checks.push(
      passOrBlock(
        config.live.accountAllowlistHmacs.includes(input.accountExternalRefHmac.toLowerCase()),
        "LIVE_ACCOUNT_ALLOWLISTED",
        "LIVE_ACCOUNT_NOT_ALLOWLISTED",
        "현재 계좌가 Live 허용 목록과 일치합니다.",
        "현재 계좌가 Live 허용 목록에 없습니다.",
        input.accountExternalRefHmac,
      ),
    );
    checks.push(evaluateLiveOrderShape(input.plan.orders));
    checks.push(evaluateLiveTradeLimits(input, config));
    checks.push(evaluateTinyLiveLimit(input.plan.orders, config));
    checks.push(evaluateManualApproval(input, config));
  }

  return decision(checks);
}

function evaluateExecutableOrderSet(
  orders: readonly PlannedExecutionOrder[],
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  if (orders.length === 0) {
    return blocked(
      "PLAN_HAS_NO_EXECUTABLE_ORDERS",
      "실행할 주문이 없는 계획은 주문 실행 단계로 넘기지 않습니다.",
      null,
    );
  }
  const minimum = BigInt(config.limits.minimumOrderGrossMinor);
  const belowMinimum = orders.find(({ grossNotionalMinor }) => grossNotionalMinor < minimum);
  return passOrBlock(
    belowMinimum === undefined,
    "MINIMUM_ORDER_GROSS_OK",
    "ORDER_BELOW_MINIMUM_GROSS",
    "모든 주문이 설정된 최소 주문금액 이상입니다.",
    belowMinimum
      ? `${belowMinimum.logicalOrderId} 주문이 최소 주문금액보다 작습니다.`
      : "최소 주문금액을 확인할 수 없습니다.",
    belowMinimum?.logicalOrderId ?? null,
  );
}

function evaluatePlanIdentity(
  plan: ExecutionPlanIdentity,
  current: CurrentExecutionIdentity,
): ExecutionRiskCheck {
  const matches =
    plan.snapshotId === current.snapshotId &&
    plan.snapshotDigest === current.snapshotDigest &&
    plan.targetConfigVersionId === current.targetConfigVersionId &&
    plan.targetConfigContentHash === current.targetConfigContentHash;
  return passOrBlock(
    matches,
    "PLAN_IDENTITY_CURRENT",
    "PLAN_IDENTITY_STALE",
    "계획이 현재 스냅샷과 목표 설정에 고정되어 있습니다.",
    "계획 생성 이후 계좌 스냅샷 또는 목표 설정이 바뀌었습니다.",
    plan.planId,
  );
}

function evaluateExistingOrders(
  existingOrders: readonly ExistingOrderSummary[],
): ExecutionRiskCheck {
  const unresolved = existingOrders.find(({ state }) => UNRESOLVED_STATES.has(state));
  return passOrBlock(
    unresolved === undefined,
    "NO_UNRESOLVED_ORDERS",
    "UNRESOLVED_ORDER_EXISTS",
    "기존 미종결·불명확 주문이 없습니다.",
    unresolved
      ? `${unresolved.logicalOrderId} 주문이 ${unresolved.state} 상태라 신규 실행을 차단합니다.`
      : "기존 미종결·불명확 주문이 없습니다.",
    unresolved?.logicalOrderId ?? null,
  );
}

function evaluateGeneralTradeLimits(
  input: ExecutionRiskGateInput,
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  const result = evaluateTradeNotionalLimits({
    baselinePortfolioValueMinor: input.baselinePortfolioValueMinor,
    tradeDayFilledGrossMinor: input.tradeDayFilledGrossMinor,
    reservedPendingGrossMinor: input.reservedPendingGrossMinor,
    plannedOrders: input.plan.orders,
    maxSingleOrderMinor: BigInt(config.limits.maxSingleOrderGrossMinor),
    maxDailyGrossMinor: BigInt(config.limits.maxDailyGrossMinor),
    maxDailyTurnoverBasisPoints: BigInt(config.limits.maxDailyTurnoverBasisPoints),
  });
  return {
    code: result.reasonCode,
    outcome: result.canProceed ? "PASSED" : "BLOCKED",
    message: result.message,
    subjectKey: result.subjectKey,
  };
}

function evaluateProjectedExposure(
  input: ExecutionRiskGateInput,
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  const result = evaluateExposureLimits({
    ...input.projectedExposure,
    maxInstrumentBasisPoints: BigInt(config.limits.maxInstrumentWeightBasisPoints),
    maxAssetClassBasisPoints: BigInt(config.limits.maxAssetClassWeightBasisPoints),
    maxRiskyAssetBasisPoints: BigInt(config.limits.maxRiskyWeightBasisPoints),
  });
  return {
    code: result.reasonCode,
    outcome: result.canProceed ? "PASSED" : "BLOCKED",
    message: result.message,
    subjectKey: result.subjectKey,
  };
}

function evaluateLiveOrderShape(orders: readonly PlannedExecutionOrder[]): ExecutionRiskCheck {
  const invalid = orders.find(
    (order) =>
      order.marketCountry !== "KR" || order.orderType !== "LIMIT" || order.timeInForce !== "DAY",
  );
  return passOrBlock(
    invalid === undefined,
    "LIVE_ORDER_SHAPE_ALLOWED",
    "LIVE_ORDER_SHAPE_BLOCKED",
    "Live 주문은 국내 정규장 지정가 DAY 정책을 만족합니다.",
    invalid
      ? `${invalid.logicalOrderId} 주문이 첫 Live 허용 주문 형태를 벗어났습니다.`
      : "Live 주문 형태를 확인할 수 없습니다.",
    invalid?.logicalOrderId ?? null,
  );
}

function evaluateLiveTradeLimits(
  input: ExecutionRiskGateInput,
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  const result = evaluateTradeNotionalLimits({
    baselinePortfolioValueMinor: input.baselinePortfolioValueMinor,
    tradeDayFilledGrossMinor: input.tradeDayFilledGrossMinor,
    reservedPendingGrossMinor: input.reservedPendingGrossMinor,
    plannedOrders: input.plan.orders,
    maxSingleOrderMinor: BigInt(config.live.maxSingleOrderGrossMinor),
    maxDailyGrossMinor: BigInt(config.live.maxDailyGrossMinor),
    maxDailyTurnoverBasisPoints: BigInt(config.limits.maxDailyTurnoverBasisPoints),
  });
  return {
    code: result.canProceed ? "LIVE_TRADE_LIMITS_OK" : `LIVE_${result.reasonCode}`,
    outcome: result.canProceed ? "PASSED" : "BLOCKED",
    message: result.canProceed
      ? "첫 Live 전용 단일·일일 주문 한도를 만족합니다."
      : `Live 전용 한도 차단: ${result.message}`,
    subjectKey: result.subjectKey,
  };
}

function evaluateTinyLiveLimit(
  orders: readonly PlannedExecutionOrder[],
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  const grossMinor = orders.reduce((sum, order) => sum + order.grossNotionalMinor, 0n);
  const maximum = BigInt(config.live.tinyLiveMaxGrossMinor);
  return passOrBlock(
    grossMinor <= maximum,
    "TINY_LIVE_GROSS_LIMIT_OK",
    "TINY_LIVE_GROSS_LIMIT_EXCEEDED",
    "이번 Live 계획 총액이 극소액 검증 한도 안입니다.",
    "이번 Live 계획 총액이 극소액 검증 한도를 초과합니다.",
    null,
  );
}

function evaluateManualApproval(
  input: ExecutionRiskGateInput,
  config: ExecutionOperationalConfig,
): ExecutionRiskCheck {
  const approval = input.manualApproval;
  if (approval === null) {
    return blocked(
      "LIVE_MANUAL_APPROVAL_MISSING",
      "계획 해시에 연결된 Live 수동 승인이 없습니다.",
      input.plan.planId,
    );
  }

  const approvedAt = approval.approvedAt.getTime();
  const now = input.now.getTime();
  const expiresAt = approvedAt + config.live.approvalTtlSeconds * 1_000;
  const valid =
    approval.approvalId.trim().length > 0 &&
    /^[a-f0-9]{64}$/i.test(approval.approvalDigest) &&
    approval.approvalDigest === approval.expectedApprovalDigest &&
    approval.approvedPlanHash === input.plan.planHash &&
    approval.approvedAccountHmac.toLowerCase() === input.accountExternalRefHmac.toLowerCase() &&
    approval.consumedAt === null &&
    Number.isFinite(approvedAt) &&
    Number.isFinite(now) &&
    approvedAt <= now &&
    now < expiresAt;
  return passOrBlock(
    valid,
    "LIVE_MANUAL_APPROVAL_VALID",
    "LIVE_MANUAL_APPROVAL_INVALID",
    "계획·계좌에 고정된 미사용 수동 승인이 유효합니다.",
    "수동 승인이 만료·소비되었거나 계획·계좌·해시와 일치하지 않습니다.",
    approval.approvalId,
  );
}

function passOrBlock(
  condition: boolean,
  passedCode: string,
  blockedCode: string,
  passedMessage: string,
  blockedMessage: string,
  subjectKey: string | null,
): ExecutionRiskCheck {
  return condition
    ? { code: passedCode, outcome: "PASSED", message: passedMessage, subjectKey }
    : { code: blockedCode, outcome: "BLOCKED", message: blockedMessage, subjectKey };
}

function blocked(code: string, message: string, subjectKey: string | null): ExecutionRiskCheck {
  return { code, outcome: "BLOCKED", message, subjectKey };
}

function decision(checks: readonly ExecutionRiskCheck[]): ExecutionRiskGateDecision {
  const canExecute = checks.every(({ outcome }) => outcome === "PASSED");
  return {
    status: canExecute ? "READY" : "BLOCKED",
    canExecute,
    checks,
  };
}
