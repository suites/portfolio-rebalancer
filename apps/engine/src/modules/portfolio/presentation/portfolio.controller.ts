import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { TargetSettingsDraftInputSchema } from "@portfolio-rebalancer/contracts";

import { CronTokenGuard } from "../../../common/auth/guards/cron-token.guard";
import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import { PortfolioService } from "../application/portfolio.service";
import { TargetSettingsError } from "../domain/target-settings.error";

@Controller("internal/v1")
export class PortfolioController {
  constructor(@Inject(PortfolioService) private readonly portfolio: PortfolioService) {}

  @Get("dashboard")
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async dashboard(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.dashboard();
    if (!result.ok) reply.status(503);
    return result.dashboard;
  }

  @Post("portfolio/refresh")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async refresh(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.refresh();
    if (!result.ok) reply.status(503);
    return result.dashboard;
  }

  @Get("records")
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async records(@Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.portfolio.records();
    if (result.state === "UNAVAILABLE") reply.status(503);
    return result;
  }

  @Get("target-settings")
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async targetSettings() {
    try {
      return await this.portfolio.targetSettings();
    } catch (error) {
      throwTargetSettingsHttpError(error);
    }
  }

  @Post("target-settings/drafts")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
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
  @UseGuards(ServiceTokenGuard)
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
