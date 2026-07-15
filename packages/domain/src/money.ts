import { decimal, fromScaledInteger, toScaledInteger, type DecimalString } from "./decimal";

export type Currency = "KRW" | "USD";

const MINOR_DIGITS: Readonly<Record<Currency, number>> = {
  KRW: 0,
  USD: 2,
};

export interface Money {
  readonly currency: Currency;
  readonly minor: bigint;
}

export function money(currency: Currency, amount: string): Money {
  return {
    currency,
    minor: toScaledInteger(decimal(amount), MINOR_DIGITS[currency]),
  };
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { currency: left.currency, minor: left.minor + right.minor };
}

export function formatMoney(value: Money): DecimalString {
  return fromScaledInteger(value.minor, MINOR_DIGITS[value.currency]);
}

export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`통화가 다릅니다: ${left.currency}, ${right.currency}`);
  }
}
