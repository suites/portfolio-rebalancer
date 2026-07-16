import { TargetSettingsDraftInputSchema } from "@portfolio-rebalancer/contracts";

export function targetSettingsInputFromFormData(formData: FormData) {
  const assetKeys = formData.getAll("assetKey");
  const targets = formData.getAll("targetPercent");
  const compositionModes = formData.getAll("compositionMode");
  if (
    assetKeys.length === 0 ||
    targets.length !== assetKeys.length ||
    compositionModes.length !== assetKeys.length
  ) {
    throw new Error("모든 자산군의 목표 비중을 입력하세요.");
  }
  const instrumentKeys = formData.getAll("instrumentKey");
  const instrumentClasses = formData.getAll("instrumentClass");
  if (instrumentKeys.length !== instrumentClasses.length) {
    throw new Error("모든 보유종목의 자산군을 선택하세요.");
  }
  const memberships = new Map<string, string[]>();
  instrumentKeys.forEach((rawKey, index) => {
    const instrumentKey = requiredString(rawKey);
    const assetClass = requiredString(instrumentClasses[index]);
    if (assetClass !== "SAFE" && assetClass !== "CORE" && assetClass !== "SATELLITE") {
      throw new Error("보유종목은 안전자산, 핵심 공격자산 또는 위성 공격자산으로 분류하세요.");
    }
    const assigned = memberships.get(assetClass) ?? [];
    assigned.push(instrumentKey);
    memberships.set(assetClass, assigned);
  });
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
    allocations: assetKeys.map((key, index) => {
      const assetKey = requiredString(key);
      const compositionMode = requiredString(compositionModes[index]);
      if (compositionMode !== "PRESERVE_CURRENT" && compositionMode !== "EQUAL") {
        throw new Error("자산군 내부 배분 방식을 다시 선택하세요.");
      }
      return {
        assetKey,
        targetBasisPoints: percentToBasisPoints(requiredString(targets[index])),
        instrumentKeys: memberships.get(assetKey) ?? [],
        compositionPolicy:
          compositionMode === "EQUAL"
            ? ({ mode: "EQUAL", version: "EQUAL_V1" } as const)
            : ({
                mode: "PRESERVE_CURRENT",
                version: "PRESERVE_CURRENT_V1",
              } as const),
        bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
      };
    }),
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
