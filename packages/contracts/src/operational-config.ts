import { z } from "zod";

const MAX_SIGNED_64 = 9_223_372_036_854_775_807n;
export const FIRST_LIVE_HARD_MAX_SINGLE_ORDER_MINOR = 100_000n;
export const FIRST_LIVE_HARD_MAX_DAILY_GROSS_MINOR = 300_000n;
export const FIRST_LIVE_HARD_MAX_TINY_ORDER_MINOR = 50_000n;
export const MAX_PLAN_QUOTE_AGE_SECONDS = 300;
export const MAX_PRE_SUBMIT_QUOTE_AGE_SECONDS = 30;
export const MAX_CALENDAR_AGE_SECONDS = 172_800;
export const MAX_CLOCK_FUTURE_TOLERANCE_SECONDS = 60;
export const MAX_MANUAL_APPROVAL_TTL_SECONDS = 600;

const nonNegativeMinorString = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/, "금액은 음수가 아닌 minor-unit 정수 문자열이어야 합니다.")
  .refine((value) => BigInt(value) <= MAX_SIGNED_64, {
    message: "금액이 저장 가능한 범위를 넘었습니다.",
  });

const positiveMinorString = nonNegativeMinorString.refine((value) => BigInt(value) > 0n, {
  message: "금액은 0보다 커야 합니다.",
});

const basisPoints = z.number().int().min(0).max(10_000);
const accountReferenceHmac = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "계좌 허용 목록에는 64자리 SHA-256 HMAC만 사용할 수 있습니다.")
  .transform((value) => value.toLowerCase());

const QuoteFreshnessSchema = z.strictObject({
  planMaxAgeSeconds: z.number().int().min(1).max(MAX_PLAN_QUOTE_AGE_SECONDS),
  preSubmitMaxAgeSeconds: z.number().int().min(1).max(MAX_PRE_SUBMIT_QUOTE_AGE_SECONDS),
  futureToleranceSeconds: z.number().int().min(0).max(MAX_CLOCK_FUTURE_TOLERANCE_SECONDS),
});

const CalendarFreshnessSchema = z.strictObject({
  maxAgeSeconds: z.number().int().min(1).max(MAX_CALENDAR_AGE_SECONDS),
  futureToleranceSeconds: z.number().int().min(0).max(MAX_CLOCK_FUTURE_TOLERANCE_SECONDS),
});

const OperationalLimitsSchema = z.strictObject({
  minimumOrderGrossMinor: positiveMinorString,
  feeBufferMinor: nonNegativeMinorString,
  maxSingleOrderGrossMinor: positiveMinorString,
  maxDailyGrossMinor: positiveMinorString,
  maxDailyTurnoverBasisPoints: basisPoints,
  maxAbsolutePriceChangeBasisPoints: basisPoints,
  maxInstrumentWeightBasisPoints: basisPoints,
  maxAssetClassWeightBasisPoints: basisPoints,
  maxRiskyWeightBasisPoints: basisPoints,
});

const LiveOperationalConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  marketCountry: z.literal("KR"),
  allowedSession: z.literal("REGULAR_MARKET"),
  orderType: z.literal("LIMIT"),
  timeInForce: z.literal("DAY"),
  accountAllowlistHmacs: z
    .array(accountReferenceHmac)
    .max(20)
    .refine((values) => new Set(values).size === values.length, {
      message: "계좌 허용 목록 HMAC을 중복해서 설정할 수 없습니다.",
    }),
  manualApprovalRequired: z.boolean(),
  approvalTtlSeconds: z.number().int().min(1).max(MAX_MANUAL_APPROVAL_TTL_SECONDS),
  maxSingleOrderGrossMinor: boundedPositiveMinorString(
    FIRST_LIVE_HARD_MAX_SINGLE_ORDER_MINOR,
    "첫 live 단일 주문 한도는 100,000원을 넘을 수 없습니다.",
  ),
  maxDailyGrossMinor: boundedPositiveMinorString(
    FIRST_LIVE_HARD_MAX_DAILY_GROSS_MINOR,
    "첫 live 일일 총거래 한도는 300,000원을 넘을 수 없습니다.",
  ),
  tinyLiveMaxGrossMinor: boundedPositiveMinorString(
    FIRST_LIVE_HARD_MAX_TINY_ORDER_MINOR,
    "극소액 live 검증 한도는 50,000원을 넘을 수 없습니다.",
  ),
});

export const OperationalConfigV1Schema = z
  .strictObject({
    schemaVersion: z.literal("OPERATIONAL_CONFIG_V1"),
    mode: z.enum(["PAPER", "LIVE"]).default("PAPER"),
    killSwitch: z.boolean(),
    freshness: z.strictObject({
      quote: QuoteFreshnessSchema,
      calendar: CalendarFreshnessSchema,
    }),
    limits: OperationalLimitsSchema,
    live: LiveOperationalConfigSchema,
  })
  .superRefine((config, context) => {
    const minimumOrder = BigInt(config.limits.minimumOrderGrossMinor);
    const maxSingleOrder = BigInt(config.limits.maxSingleOrderGrossMinor);
    const maxDailyGross = BigInt(config.limits.maxDailyGrossMinor);
    const liveMaxSingleOrder = BigInt(config.live.maxSingleOrderGrossMinor);
    const liveMaxDailyGross = BigInt(config.live.maxDailyGrossMinor);
    const tinyLiveMax = BigInt(config.live.tinyLiveMaxGrossMinor);

    if (minimumOrder > maxSingleOrder) {
      issue(
        context,
        ["limits", "maxSingleOrderGrossMinor"],
        "최소 주문금액은 단일 주문 한도보다 클 수 없습니다.",
      );
    }
    if (maxSingleOrder > maxDailyGross) {
      issue(
        context,
        ["limits", "maxDailyGrossMinor"],
        "단일 주문 한도는 일일 총거래 한도보다 클 수 없습니다.",
      );
    }
    if (config.freshness.quote.preSubmitMaxAgeSeconds > config.freshness.quote.planMaxAgeSeconds) {
      issue(
        context,
        ["freshness", "quote", "preSubmitMaxAgeSeconds"],
        "주문 직전 quote 최대 나이는 계획 생성 quote 최대 나이 이하여야 합니다.",
      );
    }
    if (liveMaxSingleOrder > maxSingleOrder) {
      issue(
        context,
        ["live", "maxSingleOrderGrossMinor"],
        "live 단일 주문 한도는 일반 단일 주문 한도를 넘을 수 없습니다.",
      );
    }
    if (liveMaxDailyGross > maxDailyGross) {
      issue(
        context,
        ["live", "maxDailyGrossMinor"],
        "live 일일 총거래 한도는 일반 일일 총거래 한도를 넘을 수 없습니다.",
      );
    }
    if (liveMaxSingleOrder > liveMaxDailyGross) {
      issue(
        context,
        ["live", "maxDailyGrossMinor"],
        "live 단일 주문 한도는 live 일일 총거래 한도보다 클 수 없습니다.",
      );
    }
    if (tinyLiveMax > liveMaxSingleOrder) {
      issue(
        context,
        ["live", "tinyLiveMaxGrossMinor"],
        "극소액 live 검증 한도는 live 단일 주문 한도를 넘을 수 없습니다.",
      );
    }
    if (config.live.enabled && tinyLiveMax < minimumOrder) {
      issue(
        context,
        ["live", "tinyLiveMaxGrossMinor"],
        "극소액 live 검증 한도는 최소 주문금액 이상이어야 합니다.",
      );
    }

    if (config.live.enabled) {
      if (config.live.accountAllowlistHmacs.length === 0) {
        issue(
          context,
          ["live", "accountAllowlistHmacs"],
          "live 활성화에는 계좌 허용 목록 HMAC이 하나 이상 필요합니다.",
        );
      }
      if (!config.live.manualApprovalRequired) {
        issue(
          context,
          ["live", "manualApprovalRequired"],
          "live 활성화에는 수동 승인이 필수입니다.",
        );
      }
      if (config.killSwitch !== false) {
        issue(context, ["killSwitch"], "live 활성화 시 킬 스위치를 명시적으로 해제해야 합니다.");
      }
    }
    if (config.mode === "LIVE" && !config.live.enabled) {
      issue(
        context,
        ["live", "enabled"],
        "LIVE 모드는 live.enabled=true일 때만 사용할 수 있습니다.",
      );
    }
  });

export const OperationalConfigSchema = OperationalConfigV1Schema;

export const OperationalConfigVersionSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "ACTIVE"]),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime({ offset: true }),
  config: OperationalConfigSchema,
});

export const OperationalConfigSnapshotSchema = z
  .strictObject({
    state: z.enum(["READY", "EMPTY", "UNAVAILABLE"]),
    activeVersion: OperationalConfigVersionSchema.nullable(),
    draftVersion: OperationalConfigVersionSchema.nullable(),
    killSwitch: z.enum(["ENGAGED", "DISENGAGED", "UNKNOWN"]),
    livePromotion: z.enum(["GRANTED", "REVOKED", "UNKNOWN"]),
    liveOrdersEnabled: z.boolean(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.activeVersion?.status === "DRAFT") {
      issue(
        context,
        ["activeVersion", "status"],
        "활성 운영 설정 슬롯에는 ACTIVE 버전만 허용합니다.",
      );
    }
    if (snapshot.draftVersion?.status === "ACTIVE") {
      issue(
        context,
        ["draftVersion", "status"],
        "운영 설정 초안 슬롯에는 DRAFT 버전만 허용합니다.",
      );
    }
    if (
      snapshot.liveOrdersEnabled &&
      (snapshot.state !== "READY" ||
        snapshot.activeVersion === null ||
        snapshot.activeVersion.config.mode !== "LIVE" ||
        !snapshot.activeVersion.config.live.enabled ||
        snapshot.killSwitch !== "DISENGAGED" ||
        snapshot.livePromotion !== "GRANTED")
    ) {
      issue(
        context,
        ["liveOrdersEnabled"],
        "Live 주문 활성 상태는 ACTIVE LIVE 설정, 해제된 킬 스위치와 별도 승격을 모두 요구합니다.",
      );
    }
  });

export const SaveOperationalConfigDraftInputSchema = OperationalConfigSchema;

export const ActivateOperationalConfigDraftInputSchema = z.strictObject({
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmation: z.literal("운영 설정을 적용합니다"),
});

export const LivePromotionCommandSchema = z
  .strictObject({
    state: z.enum(["GRANTED", "REVOKED"]),
    reason: z.string().trim().min(8).max(500),
    confirmation: z.enum(["극소액 Live 승격", "Live 권한 회수"]),
  })
  .superRefine((input, context) => {
    const expected = input.state === "GRANTED" ? "극소액 Live 승격" : "Live 권한 회수";
    if (input.confirmation !== expected) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: `${expected} 문구를 정확히 선택해야 합니다.`,
      });
    }
  });

export type OperationalConfigV1Contract = z.infer<typeof OperationalConfigV1Schema>;
export type OperationalConfigContract = z.infer<typeof OperationalConfigSchema>;
export type OperationalConfigVersionContract = z.infer<typeof OperationalConfigVersionSchema>;
export type OperationalConfigSnapshotContract = z.infer<typeof OperationalConfigSnapshotSchema>;
export type SaveOperationalConfigDraftInputContract = z.infer<
  typeof SaveOperationalConfigDraftInputSchema
>;
export type ActivateOperationalConfigDraftInputContract = z.infer<
  typeof ActivateOperationalConfigDraftInputSchema
>;
export type LivePromotionCommandContract = z.infer<typeof LivePromotionCommandSchema>;

function issue(context: z.RefinementCtx, path: PropertyKey[], message: string): void {
  context.addIssue({ code: "custom", path, message });
}

function boundedPositiveMinorString(maximum: bigint, message: string) {
  return positiveMinorString.refine((value) => BigInt(value) <= maximum, { message });
}
