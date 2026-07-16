import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { EngineConfig } from "../../../config/engine.config";
import { ServiceTokenGuard } from "./service-token.guard";

describe("ServiceTokenGuard", () => {
  it("로컬 환경에서도 service token이 없으면 보호 route를 열지 않는다", () => {
    const guard = new ServiceTokenGuard(config(undefined));

    expect(() => guard.canActivate(context(undefined))).toThrow();
  });

  it("정확한 Bearer token만 허용한다", () => {
    const token = "s".repeat(32);
    const guard = new ServiceTokenGuard(config(token));

    expect(guard.canActivate(context(`Bearer ${token}`))).toBe(true);
    expect(() => guard.canActivate(context(`Bearer ${token}x`))).toThrow();
    expect(() => guard.canActivate(context(token))).toThrow();
  });
});

function config(token: string | undefined): EngineConfig {
  return {
    DATABASE_RUNTIME_URL: "postgresql://runtime:test@localhost:5432/test",
    TOSS_EGRESS_ALLOWLIST_CONFIRMED: "false",
    ENGINE_HOST: "127.0.0.1",
    ENGINE_PORT: 4100,
    ...(token ? { ENGINE_SERVICE_TOKEN: token } : {}),
  };
}

function context(authorization: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}
