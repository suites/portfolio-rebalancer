import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { ENGINE_CONFIG } from "./config/engine-config.token";
import type { EngineConfig } from "./config/engine.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: { redact: ["req.headers.authorization"] },
    }),
    { abortOnError: true },
  );
  const config = app.get<EngineConfig>(ENGINE_CONFIG);

  app.enableShutdownHooks();
  await app.listen(config.ENGINE_PORT, config.ENGINE_HOST);
}

void bootstrap();
