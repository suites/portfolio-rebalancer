import { Module } from "@nestjs/common";

import { CronTokenGuard, ServiceTokenGuard } from "./auth.guards";
import { EngineConfigModule } from "./engine-config.module";
import { EngineController } from "./engine.controller";
import { InfrastructureModule } from "./infrastructure.module";
import { PortfolioService } from "./portfolio.service";

@Module({
  imports: [EngineConfigModule, InfrastructureModule],
  controllers: [EngineController],
  providers: [PortfolioService, ServiceTokenGuard, CronTokenGuard],
})
export class PortfolioModule {}
