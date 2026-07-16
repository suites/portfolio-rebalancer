import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  TargetSettingsDraftInputSchema,
  DashboardSnapshotSchema,
  type ConsoleRecordsSnapshotContract,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
  type TargetSettingsDraftInputContract,
  type TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { resolveAutoAllocationBand } from "@portfolio-rebalancer/domain";

import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { assertVercelEgressConfigured, type EngineConfig } from "../../../config/engine.config";
import { collectPortfolio } from "./collect-portfolio.use-case";
import {
  getConsoleRecords,
  getTargetSettings,
  unavailableConsoleRecords,
} from "./console.presenter";
import { blockedDashboard, getDashboard } from "./dashboard.presenter";
import { safeErrorMetadata } from "./safe-error-metadata";
import { CollectionError } from "../domain/collection.error";
import { TargetSettingsError } from "../domain/target-settings.error";
import { TossRuntimeService } from "../infrastructure/broker/toss-runtime.service";
import { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";

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

    const requested = new Map(
      parsed.allocations.map((allocation) => [allocation.assetKey, allocation]),
    );
    const holdings = new Map(
      snapshot.holdings.map((holding) => [`${holding.marketCountry}:${holding.symbol}`, holding]),
    );
    if (
      requested.size !== holdings.size + 1 ||
      !requested.has("CASH") ||
      [...requested.keys()].some((key) => key !== "CASH" && !holdings.has(key))
    ) {
      throw new TargetSettingsError(
        "ASSET_SET_MISMATCH",
        "목표 설정은 CASH와 최신 스냅샷의 모든 보유자산을 정확히 한 번씩 포함해야 합니다.",
      );
    }

    const draft = await this.repository.createTargetDraft({
      accountId: snapshot.accountId,
      sourceSnapshotId: snapshot.id,
      sourceSnapshotDigest: snapshot.digest,
      cashPolicy: parsed.cashPolicy,
      allocations: [...requested.entries()].map(([key, allocation]) => {
        if (key === "CASH") {
          const band = resolveTargetBand(allocation);
          return {
            ...allocation,
            ...band,
            label: "관리 현금",
            instruments: [],
          };
        }
        const holding = holdings.get(key);
        if (!holding) {
          throw new TargetSettingsError("ASSET_SET_MISMATCH", "보유자산을 찾을 수 없습니다.");
        }
        const band = resolveTargetBand(allocation);
        return {
          ...allocation,
          ...band,
          label: holding.name,
          instruments: [
            {
              marketCountry: holding.marketCountry,
              listingMarket: null,
              symbol: holding.symbol,
              currency: holding.currency,
              withinAssetPoints: 10_000,
            },
          ],
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

function collectionErrorCode(error: unknown): BlockCode {
  if (error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED") {
    return "EGRESS_NOT_CONFIRMED";
  }
  return error instanceof CollectionError ? error.code : "BROKER_FETCH_FAILED";
}
