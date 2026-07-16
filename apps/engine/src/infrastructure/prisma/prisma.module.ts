import { Module } from "@nestjs/common";

import { EngineConfigModule } from "../../config/engine-config.module";
import { PrismaService } from "./prisma.service";

@Module({
  imports: [EngineConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
