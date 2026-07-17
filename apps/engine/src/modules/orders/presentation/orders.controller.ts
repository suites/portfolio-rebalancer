import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpException,
  HttpCode,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  CancelOrderInputSchema,
  CreateLivePlanApprovalInputSchema,
  ExecuteRebalancePlanInputSchema,
  KillSwitchCommandSchema,
  RecoverUnknownOrderInputSchema,
} from "@portfolio-rebalancer/contracts";

import { localConsoleAuditContext } from "../../../common/audit/operator-audit-context";
import { OrdersService } from "../application/orders.service";
import { OrderExecutionError } from "../domain/order-execution.error";

@Controller("internal/v1")
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get("orders")
  @Header("cache-control", "no-store")
  snapshot() {
    return this.orders.snapshot();
  }

  @Post("rebalance-plans/:planId/live-approvals")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async createLivePlanApproval(@Param("planId") planId: string, @Body() body: unknown) {
    const parsed = CreateLivePlanApprovalInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.planId !== planId) {
      throw new BadRequestException({
        code: "ORDER_INPUT_INVALID",
        message:
          parsed.success && parsed.data.planId !== planId
            ? "경로의 계획 ID와 승인 입력의 계획 ID가 일치해야 합니다."
            : (parsed.error?.issues[0]?.message ?? "Live 계획 승인 입력이 올바르지 않습니다."),
      });
    }
    try {
      return await this.orders.createLivePlanApproval(parsed.data, localConsoleAuditContext());
    } catch (error) {
      throwOrderHttpError(error);
    }
  }

  @Post("rebalance-plans/:planId/execute")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async execute(@Param("planId") planId: string, @Body() body: unknown) {
    const parsed = ExecuteRebalancePlanInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.planId !== planId) {
      throw new BadRequestException({
        code: "ORDER_INPUT_INVALID",
        message:
          parsed.success && parsed.data.planId !== planId
            ? "경로의 계획 ID와 실행 입력의 계획 ID가 일치해야 합니다."
            : (parsed.error?.issues[0]?.message ?? "주문 실행 입력이 올바르지 않습니다."),
      });
    }
    try {
      return await this.orders.execute(
        parsed.data,
        parsed.data.mode === "LIVE" ? localConsoleAuditContext() : undefined,
      );
    } catch (error) {
      throwOrderHttpError(error);
    }
  }

  @Post("kill-switch")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async setKillSwitch(@Body() body: unknown) {
    const parsed = KillSwitchCommandSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "ORDER_INPUT_INVALID",
        message: parsed.error.issues[0]?.message ?? "킬 스위치 입력이 올바르지 않습니다.",
      });
    }
    try {
      return await this.orders.setKillSwitch(parsed.data, localConsoleAuditContext());
    } catch (error) {
      throwOrderHttpError(error);
    }
  }

  @Post("orders/:orderId/cancel")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async cancel(@Param("orderId") orderId: string, @Body() body: unknown) {
    const parsed = CancelOrderInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.orderId !== orderId) {
      throw new BadRequestException({
        code: "ORDER_INPUT_INVALID",
        message:
          parsed.success && parsed.data.orderId !== orderId
            ? "경로의 주문 ID와 취소 입력의 주문 ID가 일치해야 합니다."
            : (parsed.error?.issues[0]?.message ?? "주문 취소 입력이 올바르지 않습니다."),
      });
    }
    try {
      return await this.orders.cancel(parsed.data, localConsoleAuditContext());
    } catch (error) {
      throwOrderHttpError(error);
    }
  }

  @Post("orders/:orderId/recover")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async recover(@Param("orderId") orderId: string, @Body() body: unknown) {
    const parsed = RecoverUnknownOrderInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.orderId !== orderId) {
      throw new BadRequestException({
        code: "ORDER_INPUT_INVALID",
        message:
          parsed.success && parsed.data.orderId !== orderId
            ? "경로의 주문 ID와 복구 입력의 주문 ID가 일치해야 합니다."
            : (parsed.error?.issues[0]?.message ?? "주문 복구 입력이 올바르지 않습니다."),
      });
    }
    try {
      return await this.orders.recoverUnknown(parsed.data, localConsoleAuditContext());
    } catch (error) {
      throwOrderHttpError(error);
    }
  }

  @Post("orders/:orderId/reconcile")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async reconcile(@Param("orderId") orderId: string) {
    try {
      return await this.orders.reconcile(orderId);
    } catch (error) {
      throwOrderHttpError(error);
    }
  }
}

function throwOrderHttpError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof OrderExecutionError) {
    const body = { code: error.code, message: error.message };
    if (error.kind === "BAD_REQUEST") throw new BadRequestException(body);
    if (error.kind === "CONFLICT") throw new ConflictException(body);
    throw new ServiceUnavailableException(body);
  }
  throw new ServiceUnavailableException({
    code: "ORDER_STORE_UNAVAILABLE",
    message: "주문 원장과 위험 상태를 안전하게 확인하지 못했습니다.",
  });
}
