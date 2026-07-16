import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import Fastify from "fastify";

import { DashboardSnapshotSchema } from "@portfolio-rebalancer/contracts";
import { createDatabaseClient } from "@portfolio-rebalancer/database";

import { collectPortfolio } from "./collector";
import { assertVercelEgressConfigured, loadEngineConfig } from "./config";
import { blockedDashboard, getDashboard } from "./dashboard";
import { CollectionError } from "./errors";
import { PortfolioRepository } from "./repository";
import { createTossReadSource } from "./toss-source";

loadDotenv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
const config = loadEngineConfig(process.env);
const database = createDatabaseClient(config.DATABASE_URL);
const repository = new PortfolioRepository(database);
const app = Fastify({ logger: { redact: ["req.headers.authorization"] } });

app.get("/internal/v1/health", () => ({ status: "ok", liveOrdersEnabled: false }));

app.get("/internal/v1/dashboard", async (_request, reply) => {
  if (!isServiceAuthorized(_request.headers.authorization)) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  reply.header("cache-control", "no-store");
  return getDashboard(repository);
});

app.post("/internal/v1/portfolio/refresh", async (_request, reply) => {
  if (!isServiceAuthorized(_request.headers.authorization)) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  reply.header("cache-control", "no-store");
  try {
    assertVercelEgressConfigured(config);
    const { source, accountReferenceKey } = getTossRuntime();
    await collectPortfolio({
      source,
      repository,
      selectedAccountSeq: config.TOSSINVEST_ACCOUNT_SEQ,
      accountReferenceKey,
    });
    return DashboardSnapshotSchema.parse(await getDashboard(repository));
  } catch (error) {
    const code =
      error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED"
        ? "EGRESS_NOT_CONFIRMED"
        : error instanceof CollectionError
          ? error.code
          : "BROKER_FETCH_FAILED";
    app.log.warn(safeErrorMetadata(error), "portfolio refresh blocked");
    reply.status(503);
    return blockedDashboard(code);
  }
});

app.get("/internal/v1/cron/portfolio", async (request, reply) => {
  if (!config.CRON_SECRET || request.headers.authorization !== `Bearer ${config.CRON_SECRET}`) {
    return reply.status(401).send({ error: "unauthorized" });
  }
  try {
    assertVercelEgressConfigured(config);
    const { source, accountReferenceKey } = getTossRuntime();
    await collectPortfolio({
      source,
      repository,
      selectedAccountSeq: config.TOSSINVEST_ACCOUNT_SEQ,
      accountReferenceKey,
    });
    return { ok: true };
  } catch (error) {
    const code =
      error instanceof Error && error.message === "VERCEL_TOSS_EGRESS_NOT_CONFIRMED"
        ? "EGRESS_NOT_CONFIRMED"
        : error instanceof CollectionError
          ? error.code
          : "BROKER_FETCH_FAILED";
    app.log.warn(safeErrorMetadata(error), "portfolio cron collection blocked");
    return reply.status(503).send({ ok: false, code });
  }
});

function isServiceAuthorized(authorization: string | undefined): boolean {
  if (config.VERCEL !== "1" && !config.ENGINE_SERVICE_TOKEN) return true;
  return Boolean(
    config.ENGINE_SERVICE_TOKEN && authorization === `Bearer ${config.ENGINE_SERVICE_TOKEN}`,
  );
}

let tossRuntime: ReturnType<typeof createTossRuntime> | undefined;

function getTossRuntime() {
  tossRuntime ??= createTossRuntime();
  return tossRuntime;
}

function createTossRuntime() {
  if (!config.TOSSINVEST_CLIENT_ID || !config.TOSSINVEST_CLIENT_SECRET) {
    throw new CollectionError(
      "CREDENTIALS_MISSING",
      "토스증권 API 자격증명이 설정되지 않았습니다.",
      "engine 프로젝트의 환경변수에 토스증권 자격증명을 설정하세요.",
    );
  }
  return {
    source: createTossReadSource({
      clientId: config.TOSSINVEST_CLIENT_ID,
      clientSecret: config.TOSSINVEST_CLIENT_SECRET,
    }),
    accountReferenceKey: config.ACCOUNT_REFERENCE_KEY ?? config.TOSSINVEST_CLIENT_SECRET,
  };
}

function safeErrorMetadata(error: unknown): {
  code: string;
  errorName?: string;
  upstreamStatus?: number;
  databaseCode?: string;
} {
  const code = error instanceof CollectionError ? error.code : "UNEXPECTED_ERROR";
  const errorName = error instanceof Error ? error.name : undefined;
  const databaseCode =
    error instanceof Error && typeof (error as Error & { code?: unknown }).code === "string"
      ? ((error as Error & { code: string }).code ?? undefined)
      : undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const status = (current as Error & { httpStatus?: unknown }).httpStatus;
    if (typeof status === "number") {
      return {
        code,
        ...(errorName ? { errorName } : {}),
        ...(databaseCode ? { databaseCode } : {}),
        upstreamStatus: status,
      };
    }
    current = current.cause;
  }
  return {
    code,
    ...(errorName ? { errorName } : {}),
    ...(databaseCode ? { databaseCode } : {}),
  };
}

const close = async () => {
  await app.close();
  await database.$disconnect();
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host: config.ENGINE_HOST, port: config.ENGINE_PORT });
