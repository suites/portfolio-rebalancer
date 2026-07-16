export function liveConfig(accountAllowlistHmacs = ["a".repeat(64)]) {
  return {
    schemaVersion: "OPERATIONAL_CONFIG_V1" as const,
    mode: "LIVE" as const,
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
      marketCountry: "KR" as const,
      allowedSession: "REGULAR_MARKET" as const,
      orderType: "LIMIT" as const,
      timeInForce: "DAY" as const,
      accountAllowlistHmacs,
      manualApprovalRequired: true,
      approvalTtlSeconds: 600,
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      tinyLiveMaxGrossMinor: "50000",
    },
  };
}
