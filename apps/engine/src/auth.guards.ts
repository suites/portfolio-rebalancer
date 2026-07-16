import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import type { EngineConfig } from "./config";
import { ENGINE_CONFIG } from "./application.tokens";

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const authorization = getAuthorization(context);
    if (this.config.VERCEL !== "1" && !this.config.ENGINE_SERVICE_TOKEN) return true;
    if (
      this.config.ENGINE_SERVICE_TOKEN &&
      authorization === `Bearer ${this.config.ENGINE_SERVICE_TOKEN}`
    ) {
      return true;
    }
    throw new UnauthorizedException({ error: "unauthorized" });
  }
}

@Injectable()
export class CronTokenGuard implements CanActivate {
  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const authorization = getAuthorization(context);
    if (this.config.CRON_SECRET && authorization === `Bearer ${this.config.CRON_SECRET}`) {
      return true;
    }
    throw new UnauthorizedException({ error: "unauthorized" });
  }
}

function getAuthorization(context: ExecutionContext): string | undefined {
  const authorization = context.switchToHttp().getRequest<FastifyRequest>().headers.authorization;
  return typeof authorization === "string" ? authorization : undefined;
}
