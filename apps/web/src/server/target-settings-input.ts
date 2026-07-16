import { TargetSettingsDraftInputSchema } from "@portfolio-rebalancer/contracts";

export function targetSettingsInputFromFormData(formData: FormData) {
  const assetKeys = formData.getAll("assetKey");
  const targets = formData.getAll("targetPercent");
  if (assetKeys.length === 0 || targets.length !== assetKeys.length) {
    throw new Error("모든 보유자산의 목표 비중을 입력하세요.");
  }
  const cashMode = requiredString(formData.get("cashMode"));
  const cashPolicy =
    cashMode === "EXCLUDED"
      ? { mode: "EXCLUDED" as const, version: "CASH_V1" as const }
      : cashMode === "FIXED_KRW"
        ? {
            mode: "FIXED_KRW" as const,
            version: "CASH_V1" as const,
            amountMinor: wonToMinor(requiredString(formData.get("managedCashWon"))),
          }
        : (() => {
            throw new Error("관리 현금 처리 방식을 선택하세요.");
          })();

  return TargetSettingsDraftInputSchema.parse({
    cashPolicy,
    allocations: assetKeys.map((key, index) => ({
      assetKey: requiredString(key),
      targetBasisPoints: percentToBasisPoints(requiredString(targets[index])),
      bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
    })),
  });
}

export function percentToBasisPoints(value: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("비중은 소수점 둘째 자리까지 입력하세요.");
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100n + fraction;
  if (basisPoints > 10_000n) throw new Error("비중은 100%를 넘을 수 없습니다.");
  return Number(basisPoints);
}

export function wonToMinor(value: string): string {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) {
    throw new Error("관리 현금은 0원 이상의 정수로 입력하세요.");
  }
  if (BigInt(normalized) > 9_223_372_036_854_775_807n) {
    throw new Error("관리 현금이 저장 가능한 범위를 넘었습니다.");
  }
  return normalized;
}

function requiredString(value: FormDataEntryValue | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("필수 입력값이 비어 있습니다.");
  }
  return value;
}
