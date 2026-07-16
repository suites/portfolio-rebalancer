import { describe, expect, it, vi } from "vitest";

import type { EngineConfig } from "../../../config/engine.config";
import type { TargetSettingsError } from "../domain/target-settings.error";
import type { TossRuntimeService } from "../infrastructure/broker/toss-runtime.service";
import type {
  ActivateTargetDraftInput,
  PrismaPortfolioRepository,
  StoredInstrumentValidationInput,
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
      compositionPolicy: {
        mode: "PRESERVE_CURRENT" as const,
        version: "PRESERVE_CURRENT_V1" as const,
      },
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "CORE" as const,
      targetBasisPoints: 0,
      instrumentKeys: [],
      compositionPolicy: {
        mode: "PRESERVE_CURRENT" as const,
        version: "PRESERVE_CURRENT_V1" as const,
      },
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "SATELLITE" as const,
      targetBasisPoints: 9_000,
      instrumentKeys: ["US:AAPL", "US:BRK.B"],
      compositionPolicy: {
        mode: "PRESERVE_CURRENT" as const,
        version: "PRESERVE_CURRENT_V1" as const,
      },
      bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
    },
    {
      assetKey: "CASH" as const,
      targetBasisPoints: 1_000,
      instrumentKeys: [],
      compositionPolicy: {
        mode: "PRESERVE_CURRENT" as const,
        version: "PRESERVE_CURRENT_V1" as const,
      },
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
          validationId: null,
          marketCountry: "US",
          listingMarket: null,
          symbol: "AAPL",
          name: "Apple",
          englishName: null,
          currency: "USD",
          withinAssetPoints: 6_000,
        },
        {
          validationId: null,
          marketCountry: "US",
          listingMarket: null,
          symbol: "BRK.B",
          name: "Berkshire",
          englishName: null,
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
          compositionPolicy: {
            mode: "PRESERVE_CURRENT" as const,
            version: "PRESERVE_CURRENT_V1" as const,
          },
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "CORE" as const,
          targetBasisPoints: 0,
          instrumentKeys: [],
          compositionPolicy: {
            mode: "PRESERVE_CURRENT" as const,
            version: "PRESERVE_CURRENT_V1" as const,
          },
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "SATELLITE" as const,
          targetBasisPoints: 9_000,
          instrumentKeys: ["US:AAPL"],
          compositionPolicy: {
            mode: "PRESERVE_CURRENT" as const,
            version: "PRESERVE_CURRENT_V1" as const,
          },
          bandPolicy: { mode: "AUTO" as const, version: "MIXED_V1" as const },
        },
        {
          assetKey: "CASH" as const,
          targetBasisPoints: 1_000,
          instrumentKeys: [],
          compositionPolicy: {
            mode: "PRESERVE_CURRENT" as const,
            version: "PRESERVE_CURRENT_V1" as const,
          },
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

  it("이름 검색은 로컬 검증 카탈로그만 읽고 Toss를 호출하지 않는다", async () => {
    const repository = repositoryMock();
    repository.searchInstrumentCatalog.mockResolvedValue([
      {
        lastValidation: validationRecord(),
      },
    ]);
    const get = vi.fn();
    const service = createService(repository, { get });

    const result = await service.searchInstrumentCatalog("애플");

    expect(result).toMatchObject({
      catalogScope: "LOCAL_VALIDATED",
      candidates: [{ instrumentKey: "US:SGOV" }],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("미보유 종목은 기본정보와 경고를 다시 검증하고 EQUAL 정책으로만 저장한다", async () => {
    const repository = repositoryMock();
    repository.recordInstrumentValidation.mockImplementation((input) =>
      Promise.resolve(validationRecordFromInput(input)),
    );
    const source = {
      getStocks: vi.fn().mockResolvedValue({ result: [stockFixture()] }),
      getStockWarnings: vi.fn().mockResolvedValue({ result: [] }),
    };
    const service = createService(repository, {
      get: vi.fn().mockReturnValue({ source }),
    });
    const input = {
      ...validInput,
      allocations: validInput.allocations.map((allocation) =>
        allocation.assetKey === "CORE"
          ? {
              ...allocation,
              targetBasisPoints: 1_000,
              instrumentKeys: ["US:SGOV"],
              compositionPolicy: {
                mode: "EQUAL" as const,
                version: "EQUAL_V1" as const,
              },
            }
          : allocation.assetKey === "SATELLITE"
            ? { ...allocation, targetBasisPoints: 8_000 }
            : allocation,
      ),
    };

    await service.createTargetDraft(input);

    expect(source.getStocks).toHaveBeenCalledWith(["SGOV"]);
    expect(source.getStockWarnings).toHaveBeenCalledWith("SGOV");
    expect(
      repository.createTargetDraft.mock.calls[0]?.[0].allocations.find(
        ({ assetKey }) => assetKey === "CORE",
      ),
    ).toMatchObject({
      compositionPolicy: { mode: "EQUAL", version: "EQUAL_V1" },
      instruments: [
        {
          validationId: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
          marketCountry: "US",
          listingMarket: "NYSE",
          symbol: "SGOV",
          name: "아이셰어즈 0-3개월 미국채",
          currency: "USD",
          withinAssetPoints: 10_000,
        },
      ],
    });
  });

  it("미보유 종목을 현재 평가액 보존 정책에 넣으면 저장하지 않는다", async () => {
    const repository = repositoryMock();
    repository.recordInstrumentValidation.mockImplementation((input) =>
      Promise.resolve(validationRecordFromInput(input)),
    );
    const service = createService(repository, {
      get: vi.fn().mockReturnValue({
        source: {
          getStocks: vi.fn().mockResolvedValue({ result: [stockFixture()] }),
          getStockWarnings: vi.fn().mockResolvedValue({ result: [] }),
        },
      }),
    });
    const input = {
      ...validInput,
      allocations: validInput.allocations.map((allocation) =>
        allocation.assetKey === "SATELLITE"
          ? {
              ...allocation,
              instrumentKeys: [...allocation.instrumentKeys, "US:SGOV"],
            }
          : allocation,
      ),
    };

    await expect(service.createTargetDraft(input)).rejects.toMatchObject({
      code: "CLASS_POLICY_REQUIRED",
    });
    expect(repository.createTargetDraft).not.toHaveBeenCalled();
  });

  it("종목 유의사항 조회가 실패하면 카탈로그나 검증 증거를 쓰지 않는다", async () => {
    const repository = repositoryMock();
    const service = createService(repository, {
      get: vi.fn().mockReturnValue({
        source: {
          getStocks: vi.fn().mockResolvedValue({ result: [stockFixture()] }),
          getStockWarnings: vi.fn().mockRejectedValue(new Error("warning unavailable")),
        },
      }),
    });

    await expect(service.validateInstrument("US:SGOV")).rejects.toThrow("warning unavailable");
    expect(repository.recordInstrumentValidation).not.toHaveBeenCalled();
  });
});

function createService(
  repository: ReturnType<typeof repositoryMock>,
  tossRuntime: { readonly get?: ReturnType<typeof vi.fn> } = {},
) {
  return new PortfolioService(
    {} as EngineConfig,
    repository as unknown as PrismaPortfolioRepository,
    tossRuntime as unknown as TossRuntimeService,
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
    searchInstrumentCatalog: vi.fn().mockResolvedValue([]),
    recordInstrumentValidation:
      vi.fn<
        (
          input: StoredInstrumentValidationInput,
        ) => Promise<StoredInstrumentValidationInput & { readonly id: string }>
      >(),
  };
}

function validationRecord() {
  return {
    id: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
    marketCountry: "US",
    symbol: "SGOV",
    listingMarket: "NYSE",
    name: "아이셰어즈 0-3개월 미국채",
    englishName: "iShares 0-3 Month Treasury Bond ETF",
    currency: "USD",
    securityType: "FOREIGN_ETF",
    listingStatus: "ACTIVE",
    targetEligibility: "ELIGIBLE",
    targetReasonCodes: [],
    tradeBlockedNow: false,
    tradeReasonCodes: [],
    requiresOrderRevalidation: false,
    observedAt: new Date("2026-07-16T13:00:00.000Z"),
  };
}

function validationRecordFromInput(
  input: StoredInstrumentValidationInput,
): StoredInstrumentValidationInput & { readonly id: string } {
  return {
    id: "2bf2e437-c981-4dbd-842e-d0d9a11ac318",
    ...input,
  };
}

function stockFixture() {
  return {
    symbol: "SGOV",
    name: "아이셰어즈 0-3개월 미국채",
    englishName: "iShares 0-3 Month Treasury Bond ETF",
    isinCode: "US46436E7186",
    market: "NYSE" as const,
    securityType: "FOREIGN_ETF" as const,
    isCommonShare: false,
    status: "ACTIVE" as const,
    currency: "USD" as const,
    listDate: "2020-05-26",
    delistDate: null,
    sharesOutstanding: "1000000",
    leverageFactor: "1.0",
    koreanMarketDetail: null,
  };
}
