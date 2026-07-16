import { Module } from "@nestjs/common";

import { ServiceTokenGuard } from "../../common/auth/guards/service-token.guard";
import { EngineConfigModule } from "../../config/engine-config.module";
import { PrismaModule } from "../../infrastructure/prisma/prisma.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { OperationalConfigModule } from "../operational-config/operational-config.module";
import { PortfolioModule } from "../portfolio/portfolio.module";
import { OrdersService } from "./application/orders.service";
import { PrismaOrderRepository } from "./infrastructure/persistence/prisma-order.repository";
import { OrdersController } from "./presentation/orders.controller";

@Module({
  imports: [EngineConfigModule, PrismaModule, OperationalConfigModule, PortfolioModule],
  controllers: [OrdersController],
  providers: [
    {
      provide: PrismaOrderRepository,
      useFactory: (prisma: PrismaService) => new PrismaOrderRepository(prisma.client),
      inject: [PrismaService],
    },
    OrdersService,
    ServiceTokenGuard,
  ],
  exports: [OrdersService, PrismaOrderRepository],
})
export class OrdersModule {}
