import { describe, expect, it, vi } from "vitest";

import type { EngineConfig } from "../../../config/engine.config";
import type { TargetSettingsError } from "../domain/target-settings.error";
import type { TossRuntimeService } from "../infrastructure/broker/toss-runtime.service";
import type {
  ActivateTargetDraftInput,
  PrismaPortfolioRepository,
  StoredTargetDraftInput,
} from "../infrastructure/persistence/prisma-portfolio.repository";
import { PortfolioService } from "./portfolio.service";

const validInput = {
  allocations: [
    {
      assetKey: "US:AAPL",
      targetBasisPoints: 6_000,
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "US:BRK.B",
      targetBasisPoints: 4_000,
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
  ],
};

describe("PortfolioService target settings", () => {
  it("브라우저 label을 신뢰하지 않고 최신 보유자산에서 초안 입력을 만든다", async () => {
    const repository = repositoryMock();
    const service = createService(repository);

    await service.createTargetDraft(validInput);

    const draftInput = repository.createTargetDraft.mock.calls[0]?.[0];
    expect(draftInput?.accountId).toBe("44444444-4444-4444-8444-444444444444");
    expect(draftInput?.sourceSnapshotId).toBe("55555555-5555-4555-8555-555555555555");
    expect(draftInput?.sourceSnapshotDigest).toBe("digest-current");
    expect(draftInput?.allocations.find(({ assetKey }) => assetKey === "US:AAPL")).toMatchObject({
      label: "Apple",
      marketCountry: "US",
      listingMarket: null,
      symbol: "AAPL",
      targetBasisPoints: 6_000,
      lowerBasisPoints: 5_500,
      upperBasisPoints: 6_500,
      bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
    });
  });

  it("최신 보유자산 일부가 빠진 목표 설정을 거부한다", async () => {
    const service = createService(repositoryMock());
    const incomplete = {
      allocations: [
        {
          assetKey: "US:AAPL",
          targetBasisPoints: 10_000,
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
      ],
    };

    await expect(service.createTargetDraft(incomplete)).rejects.toMatchObject({
      code: "ASSET_SET_MISMATCH",
    } satisfies Partial<TargetSettingsError>);
  });

  it("현재 검토 대기 중인 초안이 아닌 버전 적용을 거부한다", async () => {
    const service = createService(repositoryMock());

    await expect(service.activateTargetDraft(99)).rejects.toMatchObject({
      code: "DRAFT_NOT_FOUND",
    } satisfies Partial<TargetSettingsError>);
  });

  it("초안 저장 후 snapshot이 바뀌면 적용을 거부한다", async () => {
    const repository = repositoryMock({
      draftVersion: {
        version: 2,
        source: {
          sourceSnapshotId: "55555555-5555-4555-8555-555555555555",
          sourceSnapshotDigest: "digest-old",
        },
      },
    });
    const service = createService(repository);

    await expect(service.activateTargetDraft(2)).rejects.toMatchObject({
      code: "DRAFT_STALE",
    } satisfies Partial<TargetSettingsError>);
    expect(repository.activateTargetDraft).not.toHaveBeenCalled();
  });
});

function createService(repository: ReturnType<typeof repositoryMock>) {
  return new PortfolioService(
    {} as EngineConfig,
    repository as unknown as PrismaPortfolioRepository,
    {} as TossRuntimeService,
  );
}

function repositoryMock(options?: {
  readonly draftVersion?: {
    readonly version: number;
    readonly source: Record<string, unknown>;
  };
}) {
  const snapshot = {
    id: "55555555-5555-4555-8555-555555555555",
    digest: "digest-current",
    accountId: "44444444-4444-4444-8444-444444444444",
    account: { maskedNumber: "****1234" },
    observedAt: new Date("2026-07-16T03:00:00.000Z"),
    totalValueMinor: 1_000_000n,
    targetConfigVersionId: null,
    targetConfigVersion: null,
    holdings: [
      {
        marketCountry: "US",
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        quantity: "1",
        marketValueKrwMinor: 600_000n,
      },
      {
        marketCountry: "US",
        symbol: "BRK.B",
        name: "Berkshire",
        currency: "USD",
        quantity: "1",
        marketValueKrwMinor: 400_000n,
      },
    ],
  };
  return {
    targetSettingsState: vi.fn().mockResolvedValue({
      snapshot,
      activeVersion: null,
      draftVersion: options?.draftVersion ?? null,
    }),
    createTargetDraft: vi
      .fn<(input: StoredTargetDraftInput) => Promise<object>>()
      .mockResolvedValue({}),
    activateTargetDraft: vi
      .fn<(input: ActivateTargetDraftInput) => Promise<object>>()
      .mockResolvedValue({}),
  };
}
