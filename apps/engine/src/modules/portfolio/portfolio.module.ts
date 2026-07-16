import { Module } from "@nestjs/common";

import { CronTokenGuard } from "../../common/auth/guards/cron-token.guard";
import { ServiceTokenGuard } from "../../common/auth/guards/service-token.guard";
import { EngineConfigModule } from "../../config/engine-config.module";
import { PrismaModule } from "../../infrastructure/prisma/prisma.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { PortfolioService } from "./application/portfolio.service";
import { TossRuntimeService } from "./infrastructure/broker/toss-runtime.service";
import { PrismaPortfolioRepository } from "./infrastructure/persistence/prisma-portfolio.repository";
import { PortfolioController } from "./presentation/portfolio.controller";

@Module({
  imports: [EngineConfigModule, PrismaModule],
  controllers: [PortfolioController],
  providers: [
    {
      provide: PrismaPortfolioRepository,
      useFactory: (prisma: PrismaService) => new PrismaPortfolioRepository(prisma.client),
      inject: [PrismaService],
    },
    TossRuntimeService,
    PortfolioService,
    ServiceTokenGuard,
    CronTokenGuard,
  ],
})
export class PortfolioModule {}
