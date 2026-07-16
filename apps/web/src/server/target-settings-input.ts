import { TargetSettingsDraftInputSchema } from "@portfolio-rebalancer/contracts";

export function targetSettingsInputFromFormData(formData: FormData) {
  const assetKeys = formData.getAll("assetKey");
  const targets = formData.getAll("targetPercent");
  if (assetKeys.length === 0 || targets.length !== assetKeys.length) {
    throw new Error("모든 보유자산의 목표 비중을 입력하세요.");
  }

  return TargetSettingsDraftInputSchema.parse({
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

function requiredString(value: FormDataEntryValue | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("필수 입력값이 비어 있습니다.");
  }
  return value;
}
