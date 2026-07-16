import { timingSafeEqual } from "node:crypto";

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ENGINE_CONFIG } from "../../../config/engine-config.token";
import type { EngineConfig } from "../../../config/engine.config";

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const authorization = getAuthorization(context);
    if (
      this.config.ENGINE_SERVICE_TOKEN &&
      matchesBearerToken(authorization, this.config.ENGINE_SERVICE_TOKEN)
    ) {
      return true;
    }
    throw new UnauthorizedException({ error: "unauthorized" });
  }
}

function getAuthorization(context: ExecutionContext): string | undefined {
  const authorization = context.switchToHttp().getRequest<FastifyRequest>().headers.authorization;
  return typeof authorization === "string" ? authorization : undefined;
}

function matchesBearerToken(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
