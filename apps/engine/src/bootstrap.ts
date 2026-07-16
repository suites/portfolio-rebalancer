import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";

import { AppModule } from "./app.module";

export function createEngineFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    logger: { redact: ["req.headers.authorization"] },
  });
}

export async function createEngineApplication(): Promise<NestFastifyApplication> {
  return NestFactory.create<NestFastifyApplication>(AppModule, createEngineFastifyAdapter(), {
    abortOnError: true,
  });
}
