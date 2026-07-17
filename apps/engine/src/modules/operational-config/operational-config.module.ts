import { Module } from "@nestjs/common";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { OperationalConfigService } from "./application/operational-config.service";
import { PrismaOperationalConfigRepository } from "./infrastructure/persistence/prisma-operational-config.repository";
import { OperationalConfigController } from "./presentation/operational-config.controller";

@Module({
  imports: [PrismaModule],
  controllers: [OperationalConfigController],
  providers: [
    {
      provide: PrismaOperationalConfigRepository,
      useFactory: (prisma: PrismaService) => new PrismaOperationalConfigRepository(prisma.client),
      inject: [PrismaService],
    },
    OperationalConfigService,
  ],
  exports: [OperationalConfigService, PrismaOperationalConfigRepository],
})
export class OperationalConfigModule {}
