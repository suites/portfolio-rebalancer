import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { OperationalConfigSchema } from "./operational-config";

const validConfig = {
  schemaVersion: "OPERATIONAL_CONFIG_V1" as const,
  mode: "PAPER" as const,
  killSwitch: true,
  freshness: {
    quote: {
      planMaxAgeSeconds: 30,
      preSubmitMaxAgeSeconds: 5,
      futureToleranceSeconds: 2,
    },
    calendar: {
      maxAgeSeconds: 86_400,
      futureToleranceSeconds: 2,
    },
  },
  limits: {
    minimumOrderGrossMinor: "10000",
    feeBufferMinor: "5000",
    maxSingleOrderGrossMinor: "100000",
    maxDailyGrossMinor: "500000",
    maxDailyTurnoverBasisPoints: 500,
    maxAbsolutePriceChangeBasisPoints: 100,
    maxInstrumentWeightBasisPoints: 3000,
    maxAssetClassWeightBasisPoints: 7000,
    maxRiskyWeightBasisPoints: 8000,
  },
  live: {
    enabled: false,
    marketCountry: "KR" as const,
    allowedSession: "REGULAR_MARKET" as const,
    orderType: "LIMIT" as const,
    timeInForce: "DAY" as const,
    accountAllowlistHmacs: [],
    manualApprovalRequired: true,
    approvalTtlSeconds: 300,
    maxSingleOrderGrossMinor: "10000",
    maxDailyGrossMinor: "20000",
    tinyLiveMaxGrossMinor: "10000",
  },
};

describe("OperationalConfigSchema", () => {
  it("기본 실행 모드는 PAPER이고 live는 기본 비활성화한다", () => {
    const parsed = OperationalConfigSchema.parse({
      ...validConfig,
      mode: undefined,
      live: { ...validConfig.live, enabled: undefined },
    });

    expect(parsed.mode).toBe("PAPER");
    expect(parsed.live.enabled).toBe(false);
  });

  it("첫 live 범위를 KR 정규장 LIMIT+DAY로 고정하고 알 수 없는 키를 거부한다", () => {
    for (const liveOverride of [
      { marketCountry: "US" },
      { allowedSession: "PRE_MARKET" },
      { orderType: "MARKET" },
      { timeInForce: "GTC" },
    ]) {
      expect(
        OperationalConfigSchema.safeParse({
          ...validConfig,
          live: { ...validConfig.live, ...liveOverride },
        }).success,
      ).toBe(false);
    }
    expect(OperationalConfigSchema.safeParse({ ...validConfig, unexpected: true }).success).toBe(
      false,
    );
    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        freshness: { ...validConfig.freshness, hiddenDefault: 1 },
      }).success,
    ).toBe(false);
  });

  it("최소 주문, 단일 주문과 일일 총거래 한도의 순서를 검증한다", () => {
    const minimumAboveSingle = parseWith({
      limits: {
        ...validConfig.limits,
        minimumOrderGrossMinor: "100001",
      },
    });
    expect(issueMessages(minimumAboveSingle)).toContain(
      "최소 주문금액은 단일 주문 한도보다 클 수 없습니다.",
    );

    const singleAboveDaily = parseWith({
      limits: {
        ...validConfig.limits,
        maxSingleOrderGrossMinor: "500001",
      },
      live: {
        ...validConfig.live,
        maxSingleOrderGrossMinor: "10000",
      },
    });
    expect(issueMessages(singleAboveDaily)).toContain(
      "단일 주문 한도는 일일 총거래 한도보다 클 수 없습니다.",
    );
  });

  it("주문 직전 quote 허용 나이는 계획 생성 허용 나이 이하여야 한다", () => {
    const result = parseWith({
      freshness: {
        ...validConfig.freshness,
        quote: {
          ...validConfig.freshness.quote,
          planMaxAgeSeconds: 5,
          preSubmitMaxAgeSeconds: 6,
        },
      },
    });

    expect(issueMessages(result)).toContain(
      "주문 직전 quote 최대 나이는 계획 생성 quote 최대 나이 이하여야 합니다.",
    );
  });

  it("live 활성화에는 HMAC allowlist, 수동 승인과 명시적인 kill switch 해제가 모두 필요하다", () => {
    const invalid = parseWith({
      live: {
        ...validConfig.live,
        enabled: true,
        manualApprovalRequired: false,
      },
    });
    expect(issueMessages(invalid)).toEqual(
      expect.arrayContaining([
        "live 활성화에는 계좌 허용 목록 HMAC이 하나 이상 필요합니다.",
        "live 활성화에는 수동 승인이 필수입니다.",
        "live 활성화 시 킬 스위치를 명시적으로 해제해야 합니다.",
      ]),
    );

    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        killSwitch: false,
        live: {
          ...validConfig.live,
          enabled: true,
          accountAllowlistHmacs: ["A".repeat(64)],
        },
      }).success,
    ).toBe(true);
  });

  it("LIVE 모드는 live 활성화 없이는 사용할 수 없다", () => {
    const result = parseWith({ mode: "LIVE" });

    expect(issueMessages(result)).toContain(
      "LIVE 모드는 live.enabled=true일 때만 사용할 수 있습니다.",
    );
    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        mode: "LIVE",
        killSwitch: false,
        live: {
          ...validConfig.live,
          enabled: true,
          accountAllowlistHmacs: ["a".repeat(64)],
        },
      }).success,
    ).toBe(true);
  });

  it("live 주문별·일별·극소액 한도를 일반 한도 안으로 제한한다", () => {
    const result = parseWith({
      live: {
        ...validConfig.live,
        maxSingleOrderGrossMinor: "100001",
        maxDailyGrossMinor: "500001",
        tinyLiveMaxGrossMinor: "100002",
      },
    });

    expect(issueMessages(result)).toEqual(
      expect.arrayContaining([
        "live 단일 주문 한도는 일반 단일 주문 한도를 넘을 수 없습니다.",
        "live 일일 총거래 한도는 일반 일일 총거래 한도를 넘을 수 없습니다.",
        "극소액 live 검증 한도는 live 단일 주문 한도를 넘을 수 없습니다.",
      ]),
    );
  });

  it("신선도·승인 TTL과 첫 live 금액에는 완화할 수 없는 안전 상한을 둔다", () => {
    const freshness = parseWith({
      freshness: {
        quote: {
          planMaxAgeSeconds: 301,
          preSubmitMaxAgeSeconds: 31,
          futureToleranceSeconds: 61,
        },
        calendar: {
          maxAgeSeconds: 172_801,
          futureToleranceSeconds: 61,
        },
      },
    });
    expect(freshness.success).toBe(false);

    const live = parseWith({
      live: {
        ...validConfig.live,
        approvalTtlSeconds: 601,
        maxSingleOrderGrossMinor: "100001",
        maxDailyGrossMinor: "300001",
        tinyLiveMaxGrossMinor: "50001",
      },
    });
    expect(issueMessages(live)).toEqual(
      expect.arrayContaining([
        "첫 live 단일 주문 한도는 100,000원을 넘을 수 없습니다.",
        "첫 live 일일 총거래 한도는 300,000원을 넘을 수 없습니다.",
        "극소액 live 검증 한도는 50,000원을 넘을 수 없습니다.",
      ]),
    );
  });

  it("PAPER 전용 설정은 첫 live 극소액 상한보다 큰 최소 주문금액도 저장할 수 있다", () => {
    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        limits: {
          ...validConfig.limits,
          minimumOrderGrossMinor: "50001",
        },
      }).success,
    ).toBe(true);
    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        killSwitch: false,
        limits: {
          ...validConfig.limits,
          minimumOrderGrossMinor: "50001",
        },
        live: {
          ...validConfig.live,
          enabled: true,
          accountAllowlistHmacs: ["a".repeat(64)],
        },
      }).success,
    ).toBe(false);
  });

  it("계좌번호나 토큰 대신 64자리 HMAC만 허용하고 중복을 거부한다", () => {
    for (const value of ["123-456-7890", "token-secret", "a".repeat(63)]) {
      expect(
        OperationalConfigSchema.safeParse({
          ...validConfig,
          live: { ...validConfig.live, accountAllowlistHmacs: [value] },
        }).success,
      ).toBe(false);
    }
    expect(
      OperationalConfigSchema.safeParse({
        ...validConfig,
        live: {
          ...validConfig.live,
          accountAllowlistHmacs: ["a".repeat(64), "A".repeat(64)],
        },
      }).success,
    ).toBe(false);
  });

  it("루트 config.example.yaml을 직접 파싱하고 계약과 일치시킨다", async () => {
    const exampleText = await readFile(
      new URL("../../../config.example.yaml", import.meta.url),
      "utf8",
    );
    const parsedYaml: unknown = parseYaml(exampleText);

    expect(OperationalConfigSchema.safeParse(parsedYaml).success).toBe(true);
    expect(exampleText).not.toMatch(/client[_-]?secret|access[_-]?token|account[_-]?no/i);
  });
});

function parseWith(overrides: Record<string, unknown>) {
  return OperationalConfigSchema.safeParse({
    ...validConfig,
    ...overrides,
  });
}

function issueMessages(result: ReturnType<typeof OperationalConfigSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map(({ message }) => message);
}
