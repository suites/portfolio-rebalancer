import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";
import { createEngineFastifyAdapter } from "./bootstrap";
import { ENGINE_CONFIG } from "./config/engine-config.token";
import type { EngineConfig } from "./config/engine.config";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  createEngineFastifyAdapter(),
  { abortOnError: true },
);
const config = app.get<EngineConfig>(ENGINE_CONFIG);

if (config.VERCEL === "1") {
  await app.listen(config.ENGINE_PORT);
} else {
  app.enableShutdownHooks();
  await app.listen(config.ENGINE_PORT, config.ENGINE_HOST);
}
