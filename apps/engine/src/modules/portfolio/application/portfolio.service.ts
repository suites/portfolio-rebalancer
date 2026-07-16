import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  InstrumentCatalogSearchResultSchema,
  InstrumentSearchInputSchema,
  InstrumentValidationInputSchema,
  InstrumentValidationResultSchema,
  CreateRebalancePlanInputSchema,
  TargetSettingsDraftInputSchema,
  DashboardSnapshotSchema,
  type ConsoleRecordsSnapshotContract,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
  type InstrumentCatalogSearchResultContract,
  type InstrumentValidationResultContract,
  type CreateRebalancePlanInputContract,
  type RebalancePlanSnapshotContract,
  type TargetSettingsDraftInputContract,
  type TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import {
  resolveAutoAllocationBand,
  resolveEqualWithinAssetPoints,
  resolvePreserveCurrentWithinAssetPoints,
  type ResolvedWithinAssetAllocation,
} from "@portfolio-rebalancer/domain";

import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { assertVercelEgressConfigured, type EngineConfig } from "../../../config/engine.config";
import { collectPortfolio } from "./collect-portfolio.use-case";
import {
  normalizeTossInstrumentValidation,
  parseExactInstrumentQuery,
  selectExactStock,
  validationCandidate,
} from "./instrument-catalog";
import {
  getConsoleRecords,
  getTargetSettings,
  unavailableConsoleRecords,
} from "./console.presenter";
import { blockedDashboard, getDashboard } from "./dashboard.presenter";
import { safeErrorMetadata } from "./safe-error-metadata";
import {
  getLatestRebalancePlan,
  presentRebalancePlan,
  unavailableRebalancePlanSnapshot,
} from "./rebalance-plan.presenter";
import { createAndStoreShadowPlan } from "./shadow-plan.use-case";
import { CollectionError } from "../domain/collection.error";
import { RebalancePlanError } from "../domain/rebalance-plan.error";
import { TargetSettingsError } from "../domain/target-settings.error";
import { TossRuntimeService } from "../infrastructure/broker/toss-runtime.service";
import {
  PrismaPortfolioRepository,
  type StoredCompositionPolicy,
} from "../infrastructure/persistence/prisma-portfolio.repository";

type BlockCode = DashboardBlockReasonContract["code"];

export type DashboardResult =
  | { readonly ok: true; readonly dashboard: DashboardSnapshotContract }
  | { readonly ok: false; readonly dashboard: DashboardSnapshotContract };

export type CollectionResult =
  { readonly ok: true } | { readonly ok: false; readonly code: BlockCode };

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(PrismaPortfolioRepository)
    private readonly repository: PrismaPortfolioRepository,
    @Inject(TossRuntimeService) private readonly tossRuntime: TossRuntimeService,
  ) {}

  async dashboard(): Promise<DashboardResult> {
    try {
      return { ok: true, dashboard: await getDashboard(this.repository) };
    } catch (error) {
      this.logger.warn({ event: "dashboard_read_blocked", ...safeErrorMetadata(error) });
      return { ok: false, dashboard: blockedDashboard("DB_UNAVAILABLE") };
    }
  }

  async refresh(): Promise<DashboardResult> {
    const collection = await this.collect("portfolio_refresh_blocked");
    if ("code" in collection) {
      return { ok: false, dashboard: blockedDashboard(collection.code) };
    }
    const dashboard = await this.dashboard();
    if (!dashboard.ok) return dashboard;
    return { ok: true, dashboard: DashboardSnapshotSchema.parse(dashboard.dashboard) };
  }

  targetSettings(): Promise<TargetSettingsSnapshotContract> {
    return getTargetSettings(this.repository);
  }

  async rebalancePlan(): Promise<RebalancePlanSnapshotContract> {
    try {
      return await getLatestRebalancePlan(this.repository);
    } catch (error) {
      this.logger.warn({ event: "rebalance_plan_read_blocked", ...safeErrorMetadata(error) });
      return unavailableRebalancePlanSnapshot();
    }
  }

  async createRebalancePlan(
    input: CreateRebalancePlanInputContract,
  ): Promise<RebalancePlanSnapshotContract> {
    const parsed = CreateRebalancePlanInputSchema.parse(input);
    if (parsed.mode !== "SHADOW") {
      throw new RebalancePlanError(
        "PLAN_PERSIST_FAILED",
        "현재 계획 생성 API는 Shadow 모드만 허용합니다.",
        false,
      );
    }
    assertVercelEgressConfigured(this.config);
    const runtime = this.tossRuntime.get();
    const run = await createAndStoreShadowPlan({
      repository: this.repository,
      source: runtime.source,
      requestAuditContext: runtime.requestAuditContext,
      selectedAccountSeq: this.config.TOSSINVEST_ACCOUNT_SEQ,
    });
    return presentRebalancePlan(run);
  }

  async searchInstrumentCatalog(query: string): Promise<InstrumentCatalogSearchResultContract> {
    const parsed = InstrumentSearchInputSchema.parse({ query });
    const catalogRows = await this.repository.searchInstrumentCatalog(parsed.query, 20);
    return InstrumentCatalogSearchResultSchema.parse({
      query: parsed.query,
      catalogScope: "LOCAL_VALIDATED",
      candidates: catalogRows.flatMap(({ lastValidation }) =>
        lastValidation ? [validationCandidate(lastValidation, "CATALOG")] : [],
      ),
    });
  }

  async validateInstrument(query: string): Promise<InstrumentValidationResultContract> {
    const parsed = InstrumentValidationInputSchema.parse({ query });
    const exact = parseExactInstrumentQuery(parsed.query);
    if (!exact) {
      throw new TargetSettingsError(
        "INSTRUMENT_VALIDATION_FAILED",
        "국내 6자리 종목코드, 미국 티커 또는 KR:/US: 접두 형식을 입력하세요.",
      );
    }
    const validation = await this.validateExactInstrument(exact);
    return InstrumentValidationResultSchema.parse({
      candidate: validationCandidate(validation, "TOSS_EXACT"),
    });
  }

  async createTargetDraft(
    input: TargetSettingsDraftInputContract,
  ): Promise<TargetSettingsSnapshotContract> {
    const parsed = TargetSettingsDraftInputSchema.parse(input);
    const { snapshot } = await this.repository.targetSettingsState();
    if (!snapshot) {
      throw new TargetSettingsError(
        "NO_SNAPSHOT",
        "목표 설정 전에 실제 계좌 스냅샷을 먼저 수집하세요.",
      );
    }

    const holdings = new Map(
      snapshot.holdings.map((holding) => [`${holding.marketCountry}:${holding.symbol}`, holding]),
    );
    const assignedInstrumentKeys = parsed.allocations
      .filter(({ assetKey }) => assetKey !== "CASH")
      .flatMap(({ instrumentKeys }) => instrumentKeys);
    if (
      assignedInstrumentKeys.length < holdings.size ||
      new Set(assignedInstrumentKeys).size !== assignedInstrumentKeys.length ||
      [...holdings.keys()].some((key) => !assignedInstrumentKeys.includes(key))
    ) {
      throw new TargetSettingsError(
        "ASSET_SET_MISMATCH",
        "모든 최신 보유종목을 안전자산, 핵심 공격자산 또는 위성 공격자산 중 정확히 한 곳에 포함해야 합니다.",
      );
    }
    const additionalInstruments = await this.resolveAdditionalTargetInstruments(
      assignedInstrumentKeys.filter((instrumentKey) => !holdings.has(instrumentKey)),
    );

    const draft = await this.repository.createTargetDraft({
      accountId: snapshot.accountId,
      sourceSnapshotId: snapshot.id,
      sourceSnapshotDigest: snapshot.digest,
      cashPolicy: parsed.cashPolicy,
      allocations: parsed.allocations.map((allocation) => {
        if (allocation.assetKey === "CASH") {
          const band = resolveTargetBand(allocation);
          return {
            ...allocation,
            ...band,
            label: assetClassLabel(allocation.assetKey),
            compositionPolicy: { mode: "NONE" as const, version: "CASH_V1" as const },
            instruments: [],
          };
        }
        const classMembers = allocation.instrumentKeys.map((instrumentKey) => {
          const holding = holdings.get(instrumentKey);
          const additional = additionalInstruments.get(instrumentKey);
          if (!holding && !additional) {
            throw new TargetSettingsError(
              "INSTRUMENT_VALIDATION_FAILED",
              `${instrumentKey} 종목을 토스증권에서 안전하게 검증하지 못했습니다.`,
            );
          }
          return { instrumentKey, holding, additional };
        });
        let resolved: ResolvedWithinAssetAllocation;
        if (classMembers.length === 0) {
          resolved = {
            policyVersion:
              allocation.compositionPolicy.mode === "EQUAL"
                ? ("EQUAL_V1" as const)
                : ("PRESERVE_CURRENT_V1" as const),
            instruments: [],
          };
        } else if (allocation.compositionPolicy.mode === "EQUAL") {
          resolved = resolveEqualWithinAssetPoints(allocation.instrumentKeys);
        } else {
          if (classMembers.some(({ holding }) => !holding)) {
            throw new TargetSettingsError(
              "CLASS_POLICY_REQUIRED",
              "현재 미보유 종목을 추가한 자산군은 내부 비중을 균등 배분으로 명시적으로 선택하세요.",
            );
          }
          try {
            resolved = resolvePreserveCurrentWithinAssetPoints(
              classMembers.map(({ instrumentKey, holding }) => ({
                instrumentKey,
                valueMinor: holding?.marketValueKrwMinor ?? 0n,
              })),
            );
          } catch (error) {
            throw new TargetSettingsError(
              "CLASS_VALUE_UNAVAILABLE",
              error instanceof Error
                ? error.message
                : "자산군 내부 비중을 현재 평가액으로 확정할 수 없습니다.",
            );
          }
        }
        const band = resolveTargetBand(allocation);
        const compositionPolicy: StoredCompositionPolicy =
          resolved.policyVersion === "EQUAL_V1"
            ? { mode: "EQUAL", version: "EQUAL_V1" }
            : { mode: "PRESERVE_CURRENT", version: "PRESERVE_CURRENT_V1" };
        return {
          ...allocation,
          ...band,
          label: assetClassLabel(allocation.assetKey),
          compositionPolicy,
          instruments: resolved.instruments.map(({ instrumentKey, withinAssetPoints }) => {
            const holding = holdings.get(instrumentKey);
            const additional = additionalInstruments.get(instrumentKey);
            if (!holding && !additional) {
              throw new TargetSettingsError(
                "INSTRUMENT_VALIDATION_FAILED",
                `${instrumentKey} 종목을 토스증권에서 안전하게 검증하지 못했습니다.`,
              );
            }
            return {
              validationId: additional?.id ?? null,
              marketCountry: holding?.marketCountry ?? additional!.marketCountry,
              listingMarket: additional?.listingMarket ?? null,
              symbol: holding?.symbol ?? additional!.symbol,
              name: holding?.name ?? additional!.name,
              englishName: additional?.englishName ?? null,
              currency: holding?.currency ?? additional!.currency,
              withinAssetPoints: Number(withinAssetPoints),
            };
          }),
        };
      }),
    });
    if (!draft) {
      throw new TargetSettingsError(
        "DRAFT_STALE",
        "목표 초안 저장 중 계좌 스냅샷이 변경되었습니다. 최신 상태를 확인한 뒤 다시 저장하세요. 설정과 주문은 변경되지 않았습니다.",
      );
    }
    return getTargetSettings(this.repository);
  }

  private async resolveAdditionalTargetInstruments(instrumentKeys: readonly string[]) {
    const uniqueKeys = [...new Set(instrumentKeys)].sort();
    const resolved = new Map<
      string,
      Awaited<ReturnType<PortfolioService["validateExactInstrument"]>>
    >();
    if (uniqueKeys.length === 0) return resolved;
    const requests = uniqueKeys.map((instrumentKey) => {
      const exact = parseExactInstrumentQuery(instrumentKey);
      if (!exact) {
        throw new TargetSettingsError(
          "INSTRUMENT_VALIDATION_FAILED",
          `${instrumentKey} 종목 키는 KR:종목코드 또는 US:티커 형식이어야 합니다.`,
        );
      }
      return { instrumentKey, exact };
    });
    for (const { instrumentKey, exact } of requests) {
      const validation = await this.validateExactInstrument(exact);
      if (validation.targetEligibility !== "ELIGIBLE") {
        const candidate = validationCandidate(validation, "TOSS_EXACT");
        throw new TargetSettingsError(
          "INSTRUMENT_VALIDATION_FAILED",
          candidate.blockedReason ??
            `${instrumentKey} 종목의 시장 또는 통화를 안전하게 확인하지 못했습니다.`,
        );
      }
      resolved.set(instrumentKey, validation);
    }
    return resolved;
  }

  private async validateExactInstrument(
    exact: NonNullable<ReturnType<typeof parseExactInstrumentQuery>>,
  ) {
    assertVercelEgressConfigured(this.config);
    const runtime = this.tossRuntime.get();
    return runtime.requestAuditContext.run(
      {
        workflowType: "INSTRUMENT_VALIDATION",
        correlationId: randomUUID(),
      },
      async () => {
        const stocks = await runtime.source.getStocks([exact.symbol]);
        let stock;
        try {
          stock = selectExactStock(stocks.result, exact);
        } catch (error) {
          throw new TargetSettingsError(
            "INSTRUMENT_VALIDATION_FAILED",
            error instanceof Error
              ? error.message
              : "토스증권 종목 응답을 정확히 대조하지 못했습니다.",
          );
        }
        const warnings = await runtime.source.getStockWarnings(exact.symbol);
        const normalized = normalizeTossInstrumentValidation({
          request: exact,
          stock,
          warnings: warnings.result,
          observedAt: new Date(),
        });
        return this.repository.recordInstrumentValidation(normalized);
      },
    );
  }

  async activateTargetDraft(version: number): Promise<TargetSettingsSnapshotContract> {
    const { snapshot, draftVersion } = await this.repository.targetSettingsState();
    if (!snapshot) {
      throw new TargetSettingsError(
        "NO_SNAPSHOT",
        "목표 설정 전에 실제 계좌 스냅샷을 먼저 수집하세요.",
      );
    }
    if (draftVersion?.version !== version) {
      throw new TargetSettingsError(
        "DRAFT_NOT_FOUND",
        "현재 검토 대기 중인 목표 설정 초안과 요청 버전이 일치하지 않습니다.",
      );
    }
    if (!isAssetClassDraft(draftVersion.allocations)) {
      throw new TargetSettingsError(
        "LEGACY_DRAFT_REQUIRES_RECREATE",
        "이전 개별 종목 형식의 초안은 적용할 수 없습니다. 현재 보유종목을 자산군으로 분류해 새 초안을 저장하세요.",
      );
    }
    if (!targetSourceMatchesSnapshot(draftVersion.source, snapshot.id, snapshot.digest)) {
      throw new TargetSettingsError(
        "DRAFT_STALE",
        "초안 저장 후 계좌 스냅샷이 변경되었습니다. 현재 보유자산으로 새 초안을 저장하세요. 설정과 주문은 변경되지 않았습니다.",
      );
    }
    const activated = await this.repository.activateTargetDraft({
      accountId: snapshot.accountId,
      version,
    });
    if (!activated) {
      throw new TargetSettingsError(
        "DRAFT_STALE",
        "초안 검토 중 계좌 스냅샷이 변경되었습니다. 현재 보유자산으로 새 초안을 저장하세요. 설정과 주문은 변경되지 않았습니다.",
      );
    }
    return getTargetSettings(this.repository);
  }

  async records(): Promise<ConsoleRecordsSnapshotContract> {
    try {
      return await getConsoleRecords(this.repository);
    } catch (error) {
      this.logger.warn({ event: "console_records_read_blocked", ...safeErrorMetadata(error) });
      return unavailableConsoleRecords();
    }
  }

  collectFromCron(): Promise<CollectionResult> {
    return this.collect("portfolio_cron_collection_blocked");
  }

  private async collect(event: string): Promise<CollectionResult> {
    try {
      assertVercelEgressConfigured(this.config);
      const runtime = this.tossRuntime.get();
      await collectPortfolio({
        source: runtime.source,
        repository: this.repository,
        requestAuditContext: runtime.requestAuditContext,
        selectedAccountSeq: this.config.TOSSINVEST_ACCOUNT_SEQ,
        accountReferenceKey: runtime.accountReferenceKey,
      });
      return { ok: true };
    } catch (error) {
      const code = collectionErrorCode(error);
      this.logger.warn({ event, ...safeErrorMetadata(error), code });
      return { ok: false, code };
    }
  }
}

function assetClassLabel(assetKey: "SAFE" | "CORE" | "SATELLITE" | "CASH"): string {
  switch (assetKey) {
    case "SAFE":
      return "안전자산";
    case "CORE":
      return "핵심 공격자산";
    case "SATELLITE":
      return "위성 공격자산";
    case "CASH":
      return "관리 현금";
  }
}

function resolveTargetBand(allocation: TargetSettingsDraftInputContract["allocations"][number]): {
  readonly lowerBasisPoints: number;
  readonly upperBasisPoints: number;
} {
  if (allocation.bandPolicy.mode === "CUSTOM") {
    return {
      lowerBasisPoints: allocation.bandPolicy.lowerBasisPoints,
      upperBasisPoints: allocation.bandPolicy.upperBasisPoints,
    };
  }
  const resolved = resolveAutoAllocationBand(BigInt(allocation.targetBasisPoints));
  return {
    lowerBasisPoints: Number(resolved.lowerBasisPoints),
    upperBasisPoints: Number(resolved.upperBasisPoints),
  };
}

function targetSourceMatchesSnapshot(
  source: unknown,
  snapshotId: string,
  snapshotDigest: string,
): boolean {
  if (source === null || Array.isArray(source) || typeof source !== "object") return false;
  const record = source as Record<string, unknown>;
  return record.sourceSnapshotId === snapshotId && record.sourceSnapshotDigest === snapshotDigest;
}

function isAssetClassDraft(allocations: readonly { readonly assetKey: string }[]): boolean {
  const keys = new Set(allocations.map(({ assetKey }) => assetKey));
  return (
    keys.size === 4 &&
    keys.has("SAFE") &&
    keys.has("CORE") &&
    keys.has("SATELLITE") &&
    keys.has("CASH")
  );
}

function collectionErrorCode(error: unknown): BlockCode {
  if (error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED") {
    return "EGRESS_NOT_CONFIRMED";
  }
  return error instanceof CollectionError ? error.code : "BROKER_FETCH_FAILED";
}
