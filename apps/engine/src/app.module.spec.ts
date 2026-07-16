import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { AppModule } from "./app.module";
import { ENGINE_CONFIG } from "./config/engine-config.token";
import { PrismaService } from "./infrastructure/prisma/prisma.service";
import { OperationalConfigService } from "./modules/operational-config/application/operational-config.service";
import { PrismaOperationalConfigRepository } from "./modules/operational-config/infrastructure/persistence/prisma-operational-config.repository";
import { OperationalConfigController } from "./modules/operational-config/presentation/operational-config.controller";
import { OrdersService } from "./modules/orders/application/orders.service";
import { PrismaOrderRepository } from "./modules/orders/infrastructure/persistence/prisma-order.repository";
import { OrdersController } from "./modules/orders/presentation/orders.controller";
import { PrismaPortfolioRepository } from "./modules/portfolio/infrastructure/persistence/prisma-portfolio.repository";
import { TossRuntimeService } from "./modules/portfolio/infrastructure/broker/toss-runtime.service";
import { HealthController } from "./modules/system/health.controller";

describe("AppModule", () => {
  it("표준 Nest 모듈 그래프를 초기화하고 health route를 노출한다", async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .compile();
    const app = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    try {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/internal/v1/health",
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: "degraded",
        executionMode: "PAPER",
        killSwitch: "UNKNOWN",
        livePromotion: "UNKNOWN",
        liveOrdersEnabled: false,
      });
    } finally {
      await app.close();
    }
  });

  it("tsx 실행에서도 필요한 모든 생성자 의존성을 명시적 토큰으로 주입한다", () => {
    expect(explicitInjectionTokens(HealthController)).toEqual([[0, OperationalConfigService]]);
    expect(explicitInjectionTokens(OperationalConfigController)).toEqual([
      [0, OperationalConfigService],
    ]);
    expect(explicitInjectionTokens(OrdersController)).toEqual([[0, OrdersService]]);
    expect(explicitInjectionTokens(OperationalConfigService)).toEqual([
      [0, PrismaOperationalConfigRepository],
    ]);
    expect(explicitInjectionTokens(OrdersService)).toEqual([
      [0, ENGINE_CONFIG],
      [1, PrismaOrderRepository],
      [2, PrismaOperationalConfigRepository],
      [3, PrismaPortfolioRepository],
      [4, TossRuntimeService],
    ]);
  });
});

function explicitInjectionTokens(target: object): Array<[number, unknown]> {
  const dependencies =
    (Reflect.getMetadata("self:paramtypes", target) as
      Array<{ index: number; param: unknown }> | undefined) ?? [];
  return dependencies
    .map(({ index, param }) => [index, param] as [number, unknown])
    .sort(([left], [right]) => left - right);
}
