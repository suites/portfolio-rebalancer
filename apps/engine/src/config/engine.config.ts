import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const EnvironmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TOSSINVEST_CLIENT_ID: z.string().min(1).optional(),
  TOSSINVEST_CLIENT_SECRET: z.string().min(1).optional(),
  TOSSINVEST_ACCOUNT_SEQ: z.coerce.number().int().safe().positive().optional(),
  ACCOUNT_REFERENCE_KEY: z.string().min(32).optional(),
  ENGINE_SERVICE_TOKEN: z.string().min(32).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  TOSS_EGRESS_ALLOWLIST_CONFIRMED: z.enum(["true", "false"]).default("false"),
  VERCEL: z.string().optional(),
  ENGINE_HOST: z.string().min(1).default("127.0.0.1"),
  ENGINE_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
});

export type EngineConfig = z.infer<typeof EnvironmentSchema>;

export function loadEngineConfig(environment: NodeJS.ProcessEnv): EngineConfig {
  const result = EnvironmentSchema.safeParse({
    ...environment,
    ENGINE_HOST: environment.ENGINE_HOST ?? (environment.VERCEL === "1" ? "0.0.0.0" : undefined),
    ENGINE_PORT: environment.PORT ?? environment.ENGINE_PORT,
    DATABASE_URL:
      environment.DATABASE_URL ??
      (environment.VERCEL === "1"
        ? undefined
        : "postgresql://portfolio:portfolio_local@127.0.0.1:15432/portfolio_rebalancer"),
  });
  if (!result.success) {
    const missing = result.error.issues.map(({ path }) => path.join(".")).join(", ");
    throw new Error(`엔진 환경설정을 확인할 수 없습니다: ${missing}`);
  }
  return result.data;
}

export function loadEngineConfigFromProcess(): EngineConfig {
  if (process.env.VERCEL !== "1") {
    loadDotenv({ path: resolve(process.cwd(), ".env.local") });
  }
  return loadEngineConfig(process.env);
}

export function assertVercelEgressConfigured(config: EngineConfig): void {
  if (config.VERCEL === "1" && config.TOSS_EGRESS_ALLOWLIST_CONFIRMED !== "true") {
    throw new Error("VERCEL_TOSS_EGRESS_NOT_CONFIRMED");
  }
}
