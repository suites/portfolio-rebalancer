import { describe, expect, it } from "vitest";

import {
  InstrumentCandidateSchema,
  TargetSettingsSnapshotSchema,
} from "@portfolio-rebalancer/contracts";

import {
  buildEditableInstruments,
  buildInitialCompositionModes,
  candidateToEditableInstrument,
  targetPercentInputsForProfile,
} from "./target-settings-editor-state";

describe("target settings editor state", () => {
  it("현재 보유종목과 저장된 미보유 목표 종목의 합집합을 구성한다", () => {
    const settings = TargetSettingsSnapshotSchema.parse({
      state: "CONFIGURED",
      accountLabel: "****1234",
      snapshotObservedAt: "2026-07-16T03:00:00.000Z",
      snapshotTargetVersion: 1,
      activeVersion: {
        version: 1,
        status: "ACTIVE",
        createdAt: "2026-07-16T03:00:00.000Z",
        cashPolicy: { mode: "EXCLUDED", version: "CASH_V1" },
        allocations: [
          {
            assetKey: "SAFE",
            label: "안전자산",
            targetBasisPoints: 5_000,
            lowerBasisPoints: 3_750,
            upperBasisPoints: 6_250,
            bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [
              {
                instrumentKey: "US:AAPL",
                validationId: null,
                marketCountry: "US",
                listingMarket: "NASDAQ",
                symbol: "AAPL",
                name: "Apple",
                englishName: "Apple Inc.",
                currency: "USD",
                withinAssetPoints: 10_000,
              },
            ],
          },
          {
            assetKey: "CORE",
            label: "핵심 공격자산",
            targetBasisPoints: 5_000,
            lowerBasisPoints: 3_750,
            upperBasisPoints: 6_250,
            bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [
              {
                instrumentKey: "US:MSFT",
                validationId: "019d1b9f-56ce-7e1b-a4ba-a6f607eb1111",
                marketCountry: "US",
                listingMarket: "NASDAQ",
                symbol: "MSFT",
                name: "Microsoft",
                englishName: "Microsoft Corporation",
                currency: "USD",
                withinAssetPoints: 10_000,
              },
            ],
          },
          {
            assetKey: "SATELLITE",
            label: "위성 공격자산",
            targetBasisPoints: 0,
            lowerBasisPoints: 0,
            upperBasisPoints: 0,
            bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            compositionPolicy: {
              mode: "PRESERVE_CURRENT",
              version: "PRESERVE_CURRENT_V1",
            },
            instruments: [],
          },
          {
            assetKey: "CASH",
            label: "관리 현금",
            targetBasisPoints: 0,
            lowerBasisPoints: 0,
            upperBasisPoints: 0,
            bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            compositionPolicy: { mode: "NONE", version: "CASH_V1" },
            instruments: [],
          },
        ],
      },
      draftVersion: null,
      requiresCollection: false,
      assets: [
        {
          assetKey: "SAFE",
          label: "안전자산",
          description: "완충 자산",
          currentBasisPointHundredths: 500_000,
        },
        {
          assetKey: "CORE",
          label: "핵심 공격자산",
          description: "핵심 자산",
          currentBasisPointHundredths: 0,
        },
        {
          assetKey: "SATELLITE",
          label: "위성 공격자산",
          description: "위성 자산",
          currentBasisPointHundredths: 0,
        },
        {
          assetKey: "CASH",
          label: "관리 현금",
          description: "관리 현금",
          currentBasisPointHundredths: 0,
        },
      ],
      holdings: [
        {
          instrumentKey: "US:AAPL",
          label: "Apple",
          description: "US · USD · 1주",
          currentBasisPointHundredths: 500_000,
        },
      ],
      liveOrdersEnabled: false,
    });

    const instruments = buildEditableInstruments(settings);

    expect(instruments).toEqual([
      expect.objectContaining({
        instrumentKey: "US:AAPL",
        isHolding: true,
        assetClass: "SAFE",
      }),
      expect.objectContaining({
        instrumentKey: "US:MSFT",
        isHolding: false,
        assetClass: "CORE",
      }),
    ]);
    expect(buildInitialCompositionModes(settings, instruments)).toEqual({
      SAFE: "PRESERVE_CURRENT",
      CORE: "EQUAL",
      SATELLITE: "PRESERVE_CURRENT",
    });
  });

  it("검증된 검색 후보를 제거 가능한 미보유 편집 종목으로 만든다", () => {
    const candidate = InstrumentCandidateSchema.parse({
      validationId: "019d1b9f-56ce-7e1b-a4ba-a6f607eb2222",
      instrumentKey: "KR:005930",
      symbol: "005930",
      name: "삼성전자",
      englishName: "Samsung Electronics",
      marketCountry: "KR",
      listingMarket: "KOSPI",
      currency: "KRW",
      securityType: "STOCK",
      listingStatus: "ACTIVE",
      source: "TOSS_EXACT",
      targetEligibility: "ELIGIBLE",
      targetReasonCodes: [],
      addEligible: true,
      blockedReason: null,
      tradeBlockedNow: false,
      tradeReasonCodes: [],
      tradeBlockedReason: null,
      requiresOrderRevalidation: true,
      verifiedAt: "2026-07-16T03:00:00.000Z",
    });

    expect(candidateToEditableInstrument(candidate, "SATELLITE")).toEqual({
      instrumentKey: "KR:005930",
      label: "삼성전자",
      description: "KR · KOSPI · KRW · 현재 미보유",
      isHolding: false,
      assetClass: "SATELLITE",
    });
  });

  it("현금 포함 여부에 따라 세 가지 예시 합계를 정확히 100%로 만든다", () => {
    for (const cashMode of ["", "FIXED_KRW", "EXCLUDED"] as const) {
      for (const profile of ["CONSERVATIVE", "BALANCED", "GROWTH"] as const) {
        const targets = targetPercentInputsForProfile(profile, cashMode);
        expect(Object.values(targets).reduce((sum, value) => sum + Number(value), 0)).toBe(100);
        expect(targets.CASH === "0").toBe(cashMode === "EXCLUDED");
      }
    }
  });
});
