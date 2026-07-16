import { decimal, toScaledInteger } from "@portfolio-rebalancer/domain";

const CALCULATION_SCALE = 10;
const SCALE_FACTOR = 10n ** BigInt(CALCULATION_SCALE);

export interface InstrumentValueInput {
  readonly marketCountry: string;
  readonly currency: string;
  readonly quantity: string;
  readonly lastPrice: string;
  readonly usdKrwRate?: string;
}

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

export function instrumentValueKrwMinor(input: InstrumentValueInput): bigint {
  if (input.marketCountry === "KR" && input.currency === "KRW") {
    const quantity = toScaledInteger(decimal(input.quantity), 0);
    const price = toScaledInteger(decimal(input.lastPrice), 0);
    if (quantity < 0n || price <= 0n) {
      throw new Error("한국 종목 수량은 0 이상이고 가격은 0보다 커야 합니다.");
    }
    return quantity * price;
  }

  if (input.marketCountry === "US" && input.currency === "USD") {
    if (!input.usdKrwRate) {
      throw new Error("미국 종목 평가에는 USD/KRW 환율이 필요합니다.");
    }
    const quantity = toScaledInteger(decimal(input.quantity), CALCULATION_SCALE);
    const price = toScaledInteger(decimal(input.lastPrice), CALCULATION_SCALE);
    const rate = toScaledInteger(decimal(input.usdKrwRate), CALCULATION_SCALE);
    if (quantity < 0n || price <= 0n || rate <= 0n) {
      throw new Error("미국 종목 수량은 0 이상이고 가격과 환율은 0보다 커야 합니다.");
    }
    const product = quantity * price * rate;
    const divisor = SCALE_FACTOR * SCALE_FACTOR * SCALE_FACTOR;
    return (product + divisor / 2n) / divisor;
  }

  throw new Error(
    `지원하지 않는 종목 시장·통화 조합입니다: ${input.marketCountry}/${input.currency}`,
  );
}
