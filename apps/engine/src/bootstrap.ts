import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";

export async function createEngineApplication(): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: { redact: ["req.headers.authorization"] },
  });
  return NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    abortOnError: true,
  });
}
