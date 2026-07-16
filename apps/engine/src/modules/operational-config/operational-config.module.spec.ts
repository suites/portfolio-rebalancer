import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { OperationalConfigService } from "./application/operational-config.service";
import { PrismaOperationalConfigRepository } from "./infrastructure/persistence/prisma-operational-config.repository";
import { OperationalConfigModule } from "./operational-config.module";

describe("OperationalConfigModule", () => {
  it("Prisma concrete repository와 service/controller graph를 초기화한다", async () => {
    const testingModule = await Test.createTestingModule({ imports: [OperationalConfigModule] })
      .overrideProvider(PrismaService)
      .useValue({ client: {} })
      .compile();

    expect(testingModule.get(PrismaOperationalConfigRepository)).toBeInstanceOf(
      PrismaOperationalConfigRepository,
    );
    expect(testingModule.get(OperationalConfigService)).toBeInstanceOf(OperationalConfigService);
    await testingModule.close();
  });
});
