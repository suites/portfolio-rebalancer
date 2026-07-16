import { Inject, Injectable } from "@nestjs/common";
import type { OnApplicationShutdown } from "@nestjs/common";

import type { DatabaseClient } from "@portfolio-rebalancer/database";

import { DATABASE_CLIENT } from "./application.tokens";

@Injectable()
export class DatabaseLifecycleService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.$disconnect();
  }
}
