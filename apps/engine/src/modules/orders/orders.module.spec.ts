import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { TossRuntimeService } from "../portfolio/infrastructure/broker/toss-runtime.service";
import { OrdersService } from "./application/orders.service";
import { PrismaOrderRepository } from "./infrastructure/persistence/prisma-order.repository";
import { OrdersModule } from "./orders.module";

describe("OrdersModule", () => {
  it("concrete Prisma repository와 service/controller graph를 초기화한다", async () => {
    const testingModule = await Test.createTestingModule({ imports: [OrdersModule] })
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .overrideProvider(TossRuntimeService)
      .useValue({ get: () => ({}) })
      .compile();

    expect(testingModule.get(PrismaOrderRepository)).toBeInstanceOf(PrismaOrderRepository);
    expect(testingModule.get(OrdersService)).toBeInstanceOf(OrdersService);
    await testingModule.close();
  });
});
