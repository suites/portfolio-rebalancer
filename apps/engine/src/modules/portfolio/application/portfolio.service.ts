import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  DashboardSnapshotSchema,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";

import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import { assertVercelEgressConfigured, type EngineConfig } from "../../../config/engine.config";
import { collectPortfolio } from "./collect-portfolio.use-case";
import { blockedDashboard, getDashboard } from "./dashboard.presenter";
import { safeErrorMetadata } from "./safe-error-metadata";
import { CollectionError } from "../domain/collection.error";
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
    if (!collection.ok) {
      return { ok: false, dashboard: blockedDashboard(collection.code) };
    }
    const dashboard = await this.dashboard();
    if (!dashboard.ok) return dashboard;
    return { ok: true, dashboard: DashboardSnapshotSchema.parse(dashboard.dashboard) };
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

function collectionErrorCode(error: unknown): BlockCode {
  if (error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED") {
    return "EGRESS_NOT_CONFIRMED";
  }
  return error instanceof CollectionError ? error.code : "BROKER_FETCH_FAILED";
}
