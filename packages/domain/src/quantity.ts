import { decimal, fromScaledInteger, toScaledInteger, type DecimalString } from "./decimal";

export interface Quantity {
  readonly atoms: bigint;
  readonly fractionDigits: number;
}

export function quantity(value: string, fractionDigits: number): Quantity {
  const atoms = toScaledInteger(decimal(value), fractionDigits);
  if (atoms < 0n) throw new Error("수량은 음수일 수 없습니다.");
  return { atoms, fractionDigits };
}

export function integerQuantity(value: string): Quantity {
  return quantity(value, 0);
}

export function formatQuantity(value: Quantity): DecimalString {
  validateFractionDigits(value.fractionDigits);
  if (value.atoms < 0n) throw new Error("수량은 음수일 수 없습니다.");
  return fromScaledInteger(value.atoms, value.fractionDigits);
}

export function assertIntegerQuantity(value: Quantity): void {
  validateFractionDigits(value.fractionDigits);
  if (value.fractionDigits !== 0) {
    throw new Error("첫 운영 시장인 한국 주문 수량은 정수여야 합니다.");
  }
}

function validateFractionDigits(fractionDigits: number): void {
  if (!Number.isSafeInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error("수량 소수 자릿수는 0 이상의 안전한 정수여야 합니다.");
  }
}
