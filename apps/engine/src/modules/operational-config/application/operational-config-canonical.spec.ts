import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { liveConfig } from "../testing/operational-config.fixture";
import { canonicalizeOperationalConfig } from "./operational-config-canonical";

describe("canonicalizeOperationalConfig", () => {
  it("필드 순서와 allowlist 입력 순서에 관계없이 동일한 canonical SHA-256을 만든다", () => {
    const first = canonicalizeOperationalConfig(liveConfig(["b".repeat(64), "a".repeat(64)]));
    const second = canonicalizeOperationalConfig(liveConfig(["a".repeat(64), "b".repeat(64)]));

    expect(first).toEqual(second);
    expect(first.canonicalContent).toBe(
      JSON.stringify({
        schemaVersion: "OPERATIONAL_CONFIG_V1",
        mode: "LIVE",
        killSwitch: false,
        freshness: {
          quote: {
            planMaxAgeSeconds: 300,
            preSubmitMaxAgeSeconds: 30,
            futureToleranceSeconds: 10,
          },
          calendar: { maxAgeSeconds: 86_400, futureToleranceSeconds: 10 },
        },
        limits: {
          minimumOrderGrossMinor: "10000",
          feeBufferMinor: "1000",
          maxSingleOrderGrossMinor: "100000",
          maxDailyGrossMinor: "300000",
          maxDailyTurnoverBasisPoints: 1_000,
          maxAbsolutePriceChangeBasisPoints: 500,
          maxInstrumentWeightBasisPoints: 4_000,
          maxAssetClassWeightBasisPoints: 7_000,
          maxRiskyWeightBasisPoints: 8_000,
        },
        live: {
          enabled: true,
          marketCountry: "KR",
          allowedSession: "REGULAR_MARKET",
          orderType: "LIMIT",
          timeInForce: "DAY",
          accountAllowlistHmacs: ["a".repeat(64), "b".repeat(64)],
          manualApprovalRequired: true,
          approvalTtlSeconds: 600,
          maxSingleOrderGrossMinor: "100000",
          maxDailyGrossMinor: "300000",
          tinyLiveMaxGrossMinor: "50000",
        },
      }),
    );
    expect(first.contentHash).toBe(
      createHash("sha256").update(first.canonicalContent, "utf8").digest("hex"),
    );
  });
});
