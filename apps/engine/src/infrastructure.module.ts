import { Module } from "@nestjs/common";

import { createDatabaseClient } from "@portfolio-rebalancer/database";

import { DATABASE_CLIENT, ENGINE_CONFIG } from "./application.tokens";
import type { EngineConfig } from "./config";
import { DatabaseLifecycleService } from "./database-lifecycle.service";
import { EngineConfigModule } from "./engine-config.module";
import { PortfolioRepository } from "./repository";

@Module({
  imports: [EngineConfigModule],
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: (config: EngineConfig) => createDatabaseClient(config.DATABASE_URL),
      inject: [ENGINE_CONFIG],
    },
    {
      provide: PortfolioRepository,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new PortfolioRepository(database),
      inject: [DATABASE_CLIENT],
    },
    DatabaseLifecycleService,
  ],
  exports: [PortfolioRepository],
})
export class InfrastructureModule {}
