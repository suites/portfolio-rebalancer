import { Inject, Injectable, Logger } from "@nestjs/common";

import {
  DashboardSnapshotSchema,
  type DashboardBlockReasonContract,
  type DashboardSnapshotContract,
} from "@portfolio-rebalancer/contracts";

import { ENGINE_CONFIG } from "./application.tokens";
import { collectPortfolio } from "./collector";
import { assertVercelEgressConfigured, type EngineConfig } from "./config";
import { blockedDashboard, getDashboard } from "./dashboard";
import { CollectionError } from "./errors";
import { PortfolioRepository } from "./repository";
import { safeErrorMetadata } from "./safe-error-metadata";
import { createTossReadSource, type TossReadSource } from "./toss-source";

type BlockCode = DashboardBlockReasonContract["code"];

export type DashboardResult =
  | { readonly ok: true; readonly dashboard: DashboardSnapshotContract }
  | { readonly ok: false; readonly dashboard: DashboardSnapshotContract };

export type CollectionResult =
  { readonly ok: true } | { readonly ok: false; readonly code: BlockCode };

interface TossRuntime {
  readonly source: TossReadSource;
  readonly accountReferenceKey: string;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);
  private tossRuntime: TossRuntime | undefined;

  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(PortfolioRepository) private readonly repository: PortfolioRepository,
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
      const runtime = this.getTossRuntime();
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

  private getTossRuntime(): TossRuntime {
    this.tossRuntime ??= this.createTossRuntime();
    return this.tossRuntime;
  }

  private createTossRuntime(): TossRuntime {
    if (!this.config.TOSSINVEST_CLIENT_ID || !this.config.TOSSINVEST_CLIENT_SECRET) {
      throw new CollectionError(
        "CREDENTIALS_MISSING",
        "토스증권 API 자격증명이 설정되지 않았습니다.",
        "engine 프로젝트의 환경변수에 토스증권 자격증명을 설정하세요.",
      );
    }
    return {
      source: createTossReadSource({
        clientId: this.config.TOSSINVEST_CLIENT_ID,
        clientSecret: this.config.TOSSINVEST_CLIENT_SECRET,
      }),
      accountReferenceKey:
        this.config.ACCOUNT_REFERENCE_KEY ?? this.config.TOSSINVEST_CLIENT_SECRET,
    };
  }
}

function collectionErrorCode(error: unknown): BlockCode {
  if (error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED") {
    return "EGRESS_NOT_CONFIRMED";
  }
  return error instanceof CollectionError ? error.code : "BROKER_FETCH_FAILED";
}
