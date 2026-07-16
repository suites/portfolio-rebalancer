import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown, OnModuleInit } from "@nestjs/common";

import {
  assertRestrictedRuntimeDatabaseRole,
  createDatabaseClient,
  type DatabaseClient,
} from "@portfolio-rebalancer/database";

import { ENGINE_CONFIG } from "../../config/engine-config.token";
import type { EngineConfig } from "../../config/engine.config";

@Injectable()
export class PrismaService implements OnApplicationShutdown, OnModuleInit {
  readonly client: DatabaseClient;

  constructor(@Inject(ENGINE_CONFIG) config: EngineConfig) {
    this.client = createDatabaseClient(config.DATABASE_RUNTIME_URL);
  }

  async onModuleInit(): Promise<void> {
    await assertRestrictedRuntimeDatabaseRole(this.client);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
