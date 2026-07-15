const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export type DecimalString = string & { readonly __decimalString: unique symbol };

export function decimal(value: string): DecimalString {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new Error(`올바르지 않은 decimal 문자열입니다: ${value}`);
  }
  return value as DecimalString;
}

export function toScaledInteger(value: DecimalString, fractionDigits: number): bigint {
  if (!Number.isSafeInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error("fractionDigits는 0 이상의 안전한 정수여야 합니다.");
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const excess = fraction.slice(fractionDigits);
  if (/[1-9]/.test(excess)) {
    throw new Error(`${value}는 소수점 ${fractionDigits}자리를 초과합니다.`);
  }

  const paddedFraction = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const scaled = BigInt(`${whole}${paddedFraction}` || "0");
  return negative ? -scaled : scaled;
}

export function fromScaledInteger(value: bigint, fractionDigits: number): DecimalString {
  if (!Number.isSafeInteger(fractionDigits) || fractionDigits < 0) {
    throw new Error("fractionDigits는 0 이상의 안전한 정수여야 합니다.");
  }

  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(fractionDigits + 1, "0");
  if (fractionDigits === 0) {
    return decimal(`${negative ? "-" : ""}${digits}`);
  }

  const whole = digits.slice(0, -fractionDigits);
  const fraction = digits.slice(-fractionDigits);
  return decimal(`${negative ? "-" : ""}${whole}.${fraction}`);
}
