import { describe, expect, it, vi } from "vitest";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";
import { getConsoleRecords, getTargetSettings } from "./console.presenter";

describe("getTargetSettings", () => {
  it("관리 현금 정책과 계산 전 현금 자산을 명시적으로 표시한다", async () => {
    const repository = {
      targetSettingsState: vi.fn().mockResolvedValue({
        snapshot: {
          id: "snapshot-1",
          accountId: "account-1",
          account: { maskedNumber: "****1234" },
          observedAt: new Date("2026-07-16T03:00:00.000Z"),
          targetConfigVersionId: null,
          targetConfigVersion: null,
          totalValueMinor: 1_000_000n,
          managedCashMinor: null,
          holdings: [
            {
              marketCountry: "US",
              symbol: "AAPL",
              name: "Apple",
              currency: "USD",
              quantity: "1",
              marketValueKrwMinor: 1_000_000n,
            },
          ],
        },
        activeVersion: {
          id: "target-1",
          version: 1,
          status: "ACTIVE",
          createdAt: new Date("2026-07-16T03:01:00.000Z"),
          cashPolicy: {
            mode: "FIXED_KRW",
            version: "CASH_V1",
            amountMinor: "100000",
          },
          allocations: [
            {
              assetKey: "US:AAPL",
              label: "Apple",
              targetBasisPoints: 9_000,
              lowerBasisPoints: 8_500,
              upperBasisPoints: 9_500,
              bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            },
            {
              assetKey: "CASH",
              label: "관리 현금",
              targetBasisPoints: 1_000,
              lowerBasisPoints: 750,
              upperBasisPoints: 1_250,
              bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
            },
          ],
        },
        draftVersion: null,
      }),
    } as unknown as PrismaPortfolioRepository;

    const result = await getTargetSettings(repository);

    expect(result.activeVersion?.cashPolicy).toEqual({
      mode: "FIXED_KRW",
      version: "CASH_V1",
      amountMinor: "100000",
    });
    expect(result.assets.at(-1)).toMatchObject({
      assetKey: "CASH",
      label: "관리 현금",
      currentBasisPointHundredths: null,
    });
    expect(result.requiresCollection).toBe(true);
  });
});

describe("getConsoleRecords", () => {
  it("첫 snapshot 전에 실패한 현재 계좌 수집 기록도 숨기지 않는다", async () => {
    const repository = {
      latestCollectionAccountId: vi.fn().mockResolvedValue("account-1"),
      recentCollectionRecords: vi.fn().mockResolvedValue([
        {
          id: "77777777-7777-4777-8777-777777777777",
          status: "FAILED",
          startedAt: new Date("2026-07-16T03:00:00.000Z"),
          completedAt: new Date("2026-07-16T03:00:01.000Z"),
          errorCode: "BROKER_FETCH_FAILED",
          snapshot: null,
        },
      ]),
    } as unknown as PrismaPortfolioRepository;

    const result = await getConsoleRecords(repository);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      status: "FAILED",
      errorCode: "BROKER_FETCH_FAILED",
      observedAt: null,
    });
  });
});
