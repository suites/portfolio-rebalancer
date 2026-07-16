import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

describe("GET /api/v1/brokers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("실제 엔진의 토스 연결과 gated live adapter 상태를 반환한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | RequestInfo) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return Promise.resolve(
          Response.json(
            url.includes("/operational-config") ? operationalSnapshot() : dashboardSnapshot(),
          ),
        );
      }),
    );
    const response = await GET();
    const body: unknown = await response.json();

    expect(body).toMatchObject({
      brokers: [
        {
          id: "toss",
          connectionStatus: "connected",
          adapterStatus: "live_gated_ready",
          killSwitch: "disengaged",
          livePromotion: "granted",
          liveOrdersEnabled: true,
        },
      ],
    });
  });
});

function dashboardSnapshot() {
  return {
    state: "EMPTY",
    mode: "SHADOW",
    dataSource: "TOSS",
    brokerConnection: "CONNECTED",
    accountLabel: "**** 8901",
    observedAt: "2026-07-16T09:00:00+09:00",
    conclusion: "BLOCKED",
    securitiesValueMinor: "0",
    totalValueMinor: "0",
    managedCashMinor: null,
    managedCashSource: "UNSET",
    buyingPower: [],
    allocations: [],
    unmanagedHoldings: [],
    blockReason: null,
  };
}

function operationalSnapshot() {
  return {
    state: "READY",
    activeVersion: {
      id: "10000000-0000-4000-8000-000000000001",
      version: 1,
      status: "ACTIVE",
      contentHash: "a".repeat(64),
      createdAt: "2026-07-16T09:00:00+09:00",
      config: operationalConfig(),
    },
    draftVersion: null,
    killSwitch: "DISENGAGED",
    livePromotion: "GRANTED",
    liveOrdersEnabled: true,
  };
}

function operationalConfig() {
  return {
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
      accountAllowlistHmacs: ["b".repeat(64)],
      manualApprovalRequired: true,
      approvalTtlSeconds: 300,
      maxSingleOrderGrossMinor: "50000",
      maxDailyGrossMinor: "150000",
      tinyLiveMaxGrossMinor: "50000",
    },
  };
}
