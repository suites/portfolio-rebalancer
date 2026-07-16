import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Headers,
  HttpException,
  HttpCode,
  Inject,
  Post,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  ActivateOperationalConfigDraftInputSchema,
  LivePromotionCommandSchema,
  SaveCurrentAccountOperationalConfigDraftInputSchema,
  SaveOperationalConfigDraftInputSchema,
} from "@portfolio-rebalancer/contracts";

import { ServiceTokenGuard } from "../../../common/auth/guards/service-token.guard";
import {
  operatorAuditActor,
  requireOperatorAuditContext,
} from "../../../common/auth/operator-audit-context";
import { OperationalConfigService } from "../application/operational-config.service";
import { OperationalConfigError } from "../domain/operational-config.error";

@Controller("internal/v1")
export class OperationalConfigController {
  constructor(
    @Inject(OperationalConfigService)
    private readonly operationalConfig: OperationalConfigService,
  ) {}

  @Get("operational-config")
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async current(@Res({ passthrough: true }) reply: FastifyReply) {
    const snapshot = await this.operationalConfig.current();
    if (snapshot.state === "UNAVAILABLE") reply.status(503);
    return snapshot;
  }

  @Post("operational-config/drafts")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async saveDraft(@Body() body: unknown) {
    const parsed = SaveOperationalConfigDraftInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "OPERATIONAL_CONFIG_INPUT_INVALID",
        message: parsed.error.issues[0]?.message ?? "운영 설정 입력이 올바르지 않습니다.",
      });
    }
    try {
      return await this.operationalConfig.saveDraft(parsed.data);
    } catch (error) {
      throwOperationalConfigHttpError(error);
    }
  }

  @Post("operational-config/drafts/current-account")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async saveCurrentAccountDraft(@Body() body: unknown) {
    const parsed = SaveCurrentAccountOperationalConfigDraftInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "OPERATIONAL_CONFIG_INPUT_INVALID",
        message: parsed.error.issues[0]?.message ?? "현재 계좌 운영 설정 입력이 올바르지 않습니다.",
      });
    }
    try {
      return await this.operationalConfig.saveCurrentAccountDraft(parsed.data);
    } catch (error) {
      throwOperationalConfigHttpError(error);
    }
  }

  @Post("operational-config/drafts/activate")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async activateDraft(@Body() body: unknown) {
    const parsed = ActivateOperationalConfigDraftInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "OPERATIONAL_CONFIG_INPUT_INVALID",
        message: parsed.error.issues[0]?.message ?? "적용할 운영 설정 버전과 해시를 확인하세요.",
      });
    }
    try {
      return await this.operationalConfig.activateDraft(parsed.data);
    } catch (error) {
      throwOperationalConfigHttpError(error);
    }
  }

  @Post("live-promotion")
  @HttpCode(200)
  @UseGuards(ServiceTokenGuard)
  @Header("cache-control", "no-store")
  async saveLivePromotion(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const parsed = LivePromotionCommandSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "OPERATIONAL_CONFIG_INPUT_INVALID",
        message: parsed.error.issues[0]?.message ?? "Live 승격 입력이 올바르지 않습니다.",
      });
    }
    try {
      return await this.operationalConfig.saveLivePromotion(
        parsed.data,
        operatorAuditActor(
          requireOperatorAuditContext(headers, {
            recentReauthentication: parsed.data.state === "GRANTED",
          }),
        ),
      );
    } catch (error) {
      throwOperationalConfigHttpError(error);
    }
  }
}

function throwOperationalConfigHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof OperationalConfigError) {
    const body = { code: error.code, message: error.message };
    if (error.kind === "BAD_REQUEST") throw new BadRequestException(body);
    if (error.kind === "CONFLICT") throw new ConflictException(body);
    throw new ServiceUnavailableException(body);
  }
  throw new ServiceUnavailableException({
    code: "OPERATIONAL_CONFIG_STORE_UNAVAILABLE",
    message: "운영 설정 원장을 안전하게 확인하지 못했습니다. 변경은 적용되지 않았습니다.",
  });
}
