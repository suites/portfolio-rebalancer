import { createHash } from "node:crypto";

import {
  OperationalConfigSchema,
  type OperationalConfigContract,
} from "@portfolio-rebalancer/contracts";

export interface CanonicalOperationalConfig {
  readonly config: OperationalConfigContract;
  readonly canonicalContent: string;
  readonly contentHash: string;
}

export function canonicalizeOperationalConfig(input: unknown): CanonicalOperationalConfig {
  const parsed = OperationalConfigSchema.parse(input);
  const config = OperationalConfigSchema.parse({
    schemaVersion: parsed.schemaVersion,
    mode: parsed.mode,
    killSwitch: parsed.killSwitch,
    freshness: {
      quote: {
        planMaxAgeSeconds: parsed.freshness.quote.planMaxAgeSeconds,
        preSubmitMaxAgeSeconds: parsed.freshness.quote.preSubmitMaxAgeSeconds,
        futureToleranceSeconds: parsed.freshness.quote.futureToleranceSeconds,
      },
      calendar: {
        maxAgeSeconds: parsed.freshness.calendar.maxAgeSeconds,
        futureToleranceSeconds: parsed.freshness.calendar.futureToleranceSeconds,
      },
    },
    limits: {
      minimumOrderGrossMinor: parsed.limits.minimumOrderGrossMinor,
      feeBufferMinor: parsed.limits.feeBufferMinor,
      maxSingleOrderGrossMinor: parsed.limits.maxSingleOrderGrossMinor,
      maxDailyGrossMinor: parsed.limits.maxDailyGrossMinor,
      maxDailyTurnoverBasisPoints: parsed.limits.maxDailyTurnoverBasisPoints,
      maxAbsolutePriceChangeBasisPoints: parsed.limits.maxAbsolutePriceChangeBasisPoints,
      maxInstrumentWeightBasisPoints: parsed.limits.maxInstrumentWeightBasisPoints,
      maxAssetClassWeightBasisPoints: parsed.limits.maxAssetClassWeightBasisPoints,
      maxRiskyWeightBasisPoints: parsed.limits.maxRiskyWeightBasisPoints,
    },
    live: {
      enabled: parsed.live.enabled,
      marketCountry: parsed.live.marketCountry,
      allowedSession: parsed.live.allowedSession,
      orderType: parsed.live.orderType,
      timeInForce: parsed.live.timeInForce,
      accountAllowlistHmacs: [...parsed.live.accountAllowlistHmacs].sort(),
      manualApprovalRequired: parsed.live.manualApprovalRequired,
      approvalTtlSeconds: parsed.live.approvalTtlSeconds,
      maxSingleOrderGrossMinor: parsed.live.maxSingleOrderGrossMinor,
      maxDailyGrossMinor: parsed.live.maxDailyGrossMinor,
      tinyLiveMaxGrossMinor: parsed.live.tinyLiveMaxGrossMinor,
    },
  });
  const canonicalContent = JSON.stringify(config);
  return {
    config,
    canonicalContent,
    contentHash: createHash("sha256").update(canonicalContent, "utf8").digest("hex"),
  };
}
