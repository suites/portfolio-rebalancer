import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";

import { createDatabaseClient, type DatabaseClient } from "@portfolio-rebalancer/database";

import { ENGINE_CONFIG } from "../../config/engine-config.token";
import type { EngineConfig } from "../../config/engine.config";

@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client: DatabaseClient;

  constructor(@Inject(ENGINE_CONFIG) config: EngineConfig) {
    this.client = createDatabaseClient(config.DATABASE_URL);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
