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
  cashPolicy: {
    mode: "FIXED_KRW" as const,
    version: "CASH_V1" as const,
    amountMinor: "100000",
  },
  allocations: [
    {
      assetKey: "SAFE" as const,
      targetBasisPoints: 0,
      instrumentKeys: [],
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "CORE" as const,
      targetBasisPoints: 0,
      instrumentKeys: [],
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "SATELLITE" as const,
      targetBasisPoints: 9_000,
      instrumentKeys: ["US:AAPL", "US:BRK.B"],
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "CASH" as const,
      targetBasisPoints: 1_000,
      instrumentKeys: [],
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
    expect(draftInput?.cashPolicy).toEqual({
      mode: "FIXED_KRW",
      version: "CASH_V1",
      amountMinor: "100000",
    });
    expect(draftInput?.allocations.find(({ assetKey }) => assetKey === "SATELLITE")).toMatchObject({
      label: "위성 공격자산",
      targetBasisPoints: 9_000,
      lowerBasisPoints: 8_500,
      upperBasisPoints: 9_500,
      bandPolicy: { mode: "AUTO", version: "MIXED_V1" },
      compositionPolicy: {
        mode: "PRESERVE_CURRENT",
        version: "PRESERVE_CURRENT_V1",
      },
      instruments: [
        {
          marketCountry: "US",
          listingMarket: null,
          symbol: "AAPL",
          currency: "USD",
          withinAssetPoints: 6_000,
        },
        {
          marketCountry: "US",
          listingMarket: null,
          symbol: "BRK.B",
          currency: "USD",
          withinAssetPoints: 4_000,
        },
      ],
    });
    expect(draftInput?.allocations.find(({ assetKey }) => assetKey === "CASH")).toMatchObject({
      label: "관리 현금",
      targetBasisPoints: 1_000,
      compositionPolicy: { mode: "NONE", version: "CASH_V1" },
      instruments: [],
    });
  });

  it("최신 보유자산 일부가 빠진 목표 설정을 거부한다", async () => {
    const service = createService(repositoryMock());
    const incomplete = {
      cashPolicy: {
        mode: "FIXED_KRW" as const,
        version: "CASH_V1" as const,
        amountMinor: "100000",
      },
      allocations: [
        {
          assetKey: "SAFE" as const,
          targetBasisPoints: 0,
          instrumentKeys: [],
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "CORE" as const,
          targetBasisPoints: 0,
          instrumentKeys: [],
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "SATELLITE" as const,
          targetBasisPoints: 9_000,
          instrumentKeys: ["US:AAPL"],
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "CASH" as const,
          targetBasisPoints: 1_000,
          instrumentKeys: [],
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

  it("이전 개별 종목 형식의 초안은 새 자산군 초안으로 다시 만들게 한다", async () => {
    const service = createService(
      repositoryMock({
        draftVersion: {
          version: 2,
          source: {
            sourceSnapshotId: "55555555-5555-4555-8555-555555555555",
            sourceSnapshotDigest: "digest-current",
          },
          allocations: [{ assetKey: "US:AAPL" }, { assetKey: "CASH" }],
        },
      }),
    );

    await expect(service.activateTargetDraft(2)).rejects.toMatchObject({
      code: "LEGACY_DRAFT_REQUIRES_RECREATE",
    } satisfies Partial<TargetSettingsError>);
  });

  it("현재 평가액 합계가 0인 자산군을 임의 균등 비중으로 바꾸지 않는다", async () => {
    const repository = repositoryMock({ holdingValues: [0n, 0n] });
    const service = createService(repository);

    await expect(service.createTargetDraft(validInput)).rejects.toMatchObject({
      code: "CLASS_VALUE_UNAVAILABLE",
    } satisfies Partial<TargetSettingsError>);
    expect(repository.createTargetDraft).not.toHaveBeenCalled();
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
  readonly holdingValues?: readonly [bigint, bigint];
  readonly draftVersion?: {
    readonly version: number;
    readonly source: Record<string, unknown>;
    readonly allocations?: readonly { readonly assetKey: string }[];
  };
}) {
  const [appleValue, berkshireValue] = options?.holdingValues ?? [600_000n, 400_000n];
  const snapshot = {
    id: "55555555-5555-4555-8555-555555555555",
    digest: "digest-current",
    accountId: "44444444-4444-4444-8444-444444444444",
    account: { maskedNumber: "****1234" },
    observedAt: new Date("2026-07-16T03:00:00.000Z"),
    securitiesValueMinor: appleValue + berkshireValue,
    managedCashMinor: null,
    totalValueMinor: appleValue + berkshireValue,
    targetConfigVersionId: null,
    targetConfigVersion: null,
    holdings: [
      {
        marketCountry: "US",
        symbol: "AAPL",
        name: "Apple",
        currency: "USD",
        quantity: "1",
        marketValueKrwMinor: appleValue,
      },
      {
        marketCountry: "US",
        symbol: "BRK.B",
        name: "Berkshire",
        currency: "USD",
        quantity: "1",
        marketValueKrwMinor: berkshireValue,
      },
    ],
  };
  return {
    targetSettingsState: vi.fn().mockResolvedValue({
      snapshot,
      activeVersion: null,
      draftVersion: options?.draftVersion
        ? {
            ...options.draftVersion,
            allocations:
              options.draftVersion.allocations ??
              validInput.allocations.map(({ assetKey }) => ({ assetKey })),
          }
        : null,
    }),
    createTargetDraft: vi
      .fn<(input: StoredTargetDraftInput) => Promise<object>>()
      .mockResolvedValue({}),
    activateTargetDraft: vi
      .fn<(input: ActivateTargetDraftInput) => Promise<object>>()
      .mockResolvedValue({}),
  };
}
