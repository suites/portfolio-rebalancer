import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  CreateRebalancePlanInputSchema,
  InstrumentSearchInputSchema,
  InstrumentValidationInputSchema,
  TargetSettingsDraftInputSchema,
} from "@portfolio-rebalancer/contracts";

import { CronTokenGuard } from "../../../common/auth/guards/cron-token.guard";
import { PortfolioService } from "../application/portfolio.service";
import { RebalancePlanError } from "../domain/rebalance-plan.error";
import { TargetSettingsError } from "../domain/target-settings.error";

@Controller("internal/v1")
export class PortfolioController {
  constructor(@Inject(PortfolioService) private readonly portfolio: PortfolioService) {}

  @Get("dashboard")
  @Header("cache-control", "no-store")
  async dashboard(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.dashboard();
    if (!result.ok) reply.status(503);
    return result.dashboard;
  }

  @Post("portfolio/refresh")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async refresh(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.refresh();
    if (!result.ok) reply.status(503);
    return result.dashboard;
  }

  @Get("records")
  @Header("cache-control", "no-store")
  async records(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.records();
    if (result.state === "UNAVAILABLE") reply.status(503);
    return result;
  }

  @Get("target-settings")
  @Header("cache-control", "no-store")
  async targetSettings() {
    try {
      return await this.portfolio.targetSettings();
    } catch (error) {
      throwTargetSettingsHttpError(error);
    }
  }

  @Get("rebalance-plans/latest")
  @Header("cache-control", "no-store")
  async rebalancePlan(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.rebalancePlan();
    if (result.state === "UNAVAILABLE") reply.status(503);
    return result;
  }

  @Post("rebalance-plans")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async createRebalancePlan(@Body() body: unknown) {
    const parsed = CreateRebalancePlanInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "REBALANCE_PLAN_INPUT_INVALID",
        message: "계획 모드는 SHADOW, PAPER 또는 LIVE 중 하나여야 합니다.",
      });
    }
    try {
      return await this.portfolio.createRebalancePlan(parsed.data);
    } catch (error) {
      throwRebalancePlanHttpError(error);
    }
  }

  @Get("instruments/search")
  @Header("cache-control", "no-store")
  async searchInstruments(@Query("query") query: unknown) {
    const parsed = InstrumentSearchInputSchema.safeParse({ query });
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INSTRUMENT_SEARCH_INVALID",
        message: "검색어를 1자 이상 입력하세요.",
      });
    }
    try {
      return await this.portfolio.searchInstrumentCatalog(parsed.data.query);
    } catch {
      throw new ServiceUnavailableException({
        code: "INSTRUMENT_SEARCH_UNAVAILABLE",
        message: "서버 종목 카탈로그를 안전하게 검색하지 못했습니다.",
      });
    }
  }

  @Post("instrument-validations")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async validateInstrument(@Body() body: unknown) {
    const parsed = InstrumentValidationInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INSTRUMENT_VALIDATION_INVALID",
        message: parsed.error.issues[0]?.message ?? "국내 종목코드 또는 미국 티커를 확인하세요.",
      });
    }
    try {
      return await this.portfolio.validateInstrument(parsed.data.query);
    } catch (error) {
      throwInstrumentValidationHttpError(error);
    }
  }

  @Post("target-settings/drafts")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async createTargetDraft(@Body() body: unknown) {
    const parsed = TargetSettingsDraftInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "TARGET_SETTINGS_INVALID",
        message: parsed.error.issues[0]?.message ?? "목표 설정 입력이 올바르지 않습니다.",
      });
    }
    try {
      return await this.portfolio.createTargetDraft(parsed.data);
    } catch (error) {
      throwTargetSettingsHttpError(error);
    }
  }

  @Post("target-settings/drafts/:version/activate")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async activateTargetDraft(@Param("version", ParseIntPipe) version: number) {
    try {
      return await this.portfolio.activateTargetDraft(version);
    } catch (error) {
      throwTargetSettingsHttpError(error);
    }
  }

  @Get("cron/portfolio")
  @UseGuards(CronTokenGuard)
  async collectFromCron(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.collectFromCron();
    if ("code" in result) {
      reply.status(503);
      return { ok: false as const, code: result.code };
    }
    return { ok: true as const };
  }
}

function throwTargetSettingsHttpError(error: unknown): never {
  if (error instanceof TargetSettingsError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  throw new ServiceUnavailableException({
    code: "TARGET_SETTINGS_UNAVAILABLE",
    message: "목표 설정 저장소를 안전하게 확인하지 못했습니다.",
  });
}

function throwInstrumentValidationHttpError(error: unknown): never {
  if (error instanceof TargetSettingsError) {
    throw new BadRequestException({ code: error.code, message: error.message });
  }
  throw new ServiceUnavailableException({
    code: "INSTRUMENT_VALIDATION_UNAVAILABLE",
    message: "토스증권 종목 기본정보와 유의사항을 모두 확인하지 못해 검증을 중단했습니다.",
  });
}

function throwRebalancePlanHttpError(error: unknown): never {
  if (error instanceof RebalancePlanError) {
    const body = { code: error.code, message: error.message };
    if (
      error.code === "NO_SNAPSHOT" ||
      error.code === "TARGET_CONFIG_MISSING" ||
      error.code === "TARGET_CONFIG_STALE" ||
      error.code === "SNAPSHOT_UNVERIFIED" ||
      error.code === "MANAGED_CASH_MISSING" ||
      error.code === "PLAN_IN_PROGRESS" ||
      error.code === "PLAN_PREVIOUSLY_FAILED"
    ) {
      throw new ConflictException(body);
    }
    throw new ServiceUnavailableException(body);
  }
  throw new ServiceUnavailableException({
    code: "REBALANCE_PLAN_UNAVAILABLE",
    message: "Shadow 계획을 안전하게 생성하거나 저장하지 못했습니다.",
  });
}
