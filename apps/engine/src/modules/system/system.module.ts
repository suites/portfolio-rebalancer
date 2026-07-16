import { Module } from "@nestjs/common";

import { OperationalConfigModule } from "../operational-config/operational-config.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [OperationalConfigModule],
  controllers: [HealthController],
})
export class SystemModule {}
