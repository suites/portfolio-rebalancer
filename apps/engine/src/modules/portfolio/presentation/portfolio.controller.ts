import { Controller, Get, Header, HttpCode, Inject, Post, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import { CronTokenGuard } from "../../../common/auth/guards/cron-token.guard";
import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import { PortfolioService } from "../application/portfolio.service";

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
