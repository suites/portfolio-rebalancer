import { decimal, toScaledInteger } from "@portfolio-rebalancer/domain";

const CALCULATION_SCALE = 10;
const SCALE_FACTOR = 10n ** BigInt(CALCULATION_SCALE);

export function krwAmountToMinor(value: string): bigint {
  const result = toScaledInteger(decimal(value), 0);
  if (result < 0n) throw new Error("평가금액은 0 이상이어야 합니다.");
  return result;
}

export function usdAmountToKrwMinor(usdAmount: string, usdKrwRate: string): bigint {
  const amount = toScaledInteger(decimal(usdAmount), CALCULATION_SCALE);
  const rate = toScaledInteger(decimal(usdKrwRate), CALCULATION_SCALE);
  if (amount < 0n || rate <= 0n) throw new Error("평가금액과 환율은 양수여야 합니다.");
  const product = amount * rate;
  const divisor = SCALE_FACTOR * SCALE_FACTOR;
  return (product + divisor / 2n) / divisor;
}
