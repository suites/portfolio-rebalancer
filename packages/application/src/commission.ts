import type {
  CommissionRatePeriod,
  CommissionRateSchedule,
  IsoDate,
  MarketCountry,
} from "@portfolio-rebalancer/broker";
import type { DecimalString } from "@portfolio-rebalancer/domain";

export const COMMISSION_ESTIMATE_POLICY_VERSION = "COMMISSION_CEIL_V1" as const;

export type CommissionEstimateIssue =
  | "NOTIONAL_INVALID"
  | "TRADE_DATE_INVALID"
  | "COMMISSION_RATE_MISSING"
  | "COMMISSION_RATE_AMBIGUOUS"
  | "COMMISSION_RATE_INVALID";

export class CommissionEstimateError extends Error {
  readonly code = "COMMISSION_ESTIMATE_BLOCKED";

  constructor(
    readonly issue: CommissionEstimateIssue,
    message: string,
  ) {
    super(message);
    this.name = "CommissionEstimateError";
  }
}

export interface CommissionEstimate {
  readonly policyVersion: typeof COMMISSION_ESTIMATE_POLICY_VERSION;
  readonly marketCountry: MarketCountry;
  readonly tradeDate: IsoDate;
  readonly notionalMinor: bigint;
  readonly commissionRatePercent: DecimalString;
  readonly commissionMinor: bigint;
  readonly taxIncluded: false;
}

/**
 * Applies an account-level commission percentage to a trade notional.
 *
 * Toss rates use percentage points: "0.015" means 0.015%, not 1.5% and not
 * a monetary amount. The estimate rounds upward to the next minor unit so a
 * reservation cannot understate the commission. Tax remains a separate,
 * unverified policy input.
 */
export function estimateCommission(input: {
  readonly schedule: CommissionRateSchedule;
  readonly marketCountry: MarketCountry;
  readonly tradeDate: IsoDate;
  readonly notionalMinor: bigint;
}): CommissionEstimate {
  if (input.notionalMinor < 0n) {
    throw new CommissionEstimateError("NOTIONAL_INVALID", "거래 예정 금액은 음수일 수 없습니다.");
  }
  if (!isIsoDate(input.tradeDate)) {
    throw new CommissionEstimateError(
      "TRADE_DATE_INVALID",
      "수수료 적용 거래일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.",
    );
  }

  const applicable = input.schedule.periods.filter(
    (period) =>
      period.marketCountry === input.marketCountry &&
      (period.startDate === null || period.startDate <= input.tradeDate) &&
      (period.endDate === null || input.tradeDate <= period.endDate),
  );
  if (applicable.length === 0) {
    throw new CommissionEstimateError(
      "COMMISSION_RATE_MISSING",
      `${input.marketCountry} 시장 거래일에 적용할 수수료율이 없습니다.`,
    );
  }
  if (applicable.length !== 1) {
    throw new CommissionEstimateError(
      "COMMISSION_RATE_AMBIGUOUS",
      `${input.marketCountry} 시장 거래일에 둘 이상의 수수료율이 적용됩니다.`,
    );
  }
  const period = applicable[0] as CommissionRatePeriod;
  const rate = parseNonNegativeDecimal(period.commissionRatePercent);
  if (!rate) {
    throw new CommissionEstimateError(
      "COMMISSION_RATE_INVALID",
      `${input.marketCountry} 시장 수수료율을 안전하게 해석할 수 없습니다.`,
    );
  }

  const denominator = rate.scale * 100n;
  const numerator = input.notionalMinor * rate.numerator;
  const commissionMinor = numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
  return {
    policyVersion: COMMISSION_ESTIMATE_POLICY_VERSION,
    marketCountry: input.marketCountry,
    tradeDate: input.tradeDate,
    notionalMinor: input.notionalMinor,
    commissionRatePercent: period.commissionRatePercent,
    commissionMinor,
    taxIncluded: false,
  };
}

function parseNonNegativeDecimal(
  value: string,
): { readonly numerator: bigint; readonly scale: bigint } | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 30) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return {
    numerator: BigInt(`${whole}${fraction}`),
    scale: 10n ** BigInt(fraction.length),
  };
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1000 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}
