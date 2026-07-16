"use strict";

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const { config: loadDotenv } = require("dotenv");
const { Client } = require("pg");

const LOCAL_MIGRATION_DATABASE_URL =
  "postgresql://portfolio:portfolio_local@127.0.0.1:15432/portfolio_rebalancer";
const LOCAL_RUNTIME_DATABASE_URL =
  "postgresql://portfolio_runtime:portfolio_runtime_local@127.0.0.1:15432/portfolio_rebalancer";

function resolveBootstrapConfiguration(environment) {
  const migrationDatabaseUrl =
    environment.DATABASE_URL ??
    environment.POSTGRES_URL_NON_POOLING ??
    environment.DATABASE_DIRECT_URL ??
    (environment.VERCEL === "1" ? undefined : LOCAL_MIGRATION_DATABASE_URL);
  const runtimeDatabaseUrl =
    environment.DATABASE_RUNTIME_URL ??
    (migrationDatabaseUrl === LOCAL_MIGRATION_DATABASE_URL
      ? LOCAL_RUNTIME_DATABASE_URL
      : undefined);
  if (!migrationDatabaseUrl) {
    throw new Error("DATABASE_URL이 없어 migration 역할로 연결할 수 없습니다.");
  }
  if (!runtimeDatabaseUrl) {
    throw new Error("DATABASE_RUNTIME_URL이 없어 제한 runtime 역할을 만들 수 없습니다.");
  }

  const runtimeUrl = new URL(runtimeDatabaseUrl);
  const runtimeUrlUsername = decodeURIComponent(runtimeUrl.username);
  const runtimeRole =
    environment.DATABASE_RUNTIME_ROLE ??
    (runtimeUrlUsername.includes(".") ? runtimeUrlUsername.split(".", 1)[0] : runtimeUrlUsername);
  const runtimePassword = decodeURIComponent(runtimeUrl.password);
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(runtimeRole)) {
    throw new Error("DATABASE_RUNTIME_ROLE은 단순 PostgreSQL 역할 이름이어야 합니다.");
  }
  if (!runtimePassword) {
    throw new Error("DATABASE_RUNTIME_URL에 runtime 역할 비밀번호가 필요합니다.");
  }

  const migrationRole = databaseRoleName(migrationDatabaseUrl);
  if (migrationRole === runtimeRole) {
    throw new Error("migration과 runtime 데이터베이스 역할은 달라야 합니다.");
  }
  return {
    migrationDatabaseUrl,
    runtimeDatabaseUrl,
    runtimeRole,
    runtimePassword,
  };
}

function databaseRoleName(databaseUrl) {
  const username = decodeURIComponent(new URL(databaseUrl).username);
  return username.includes(".") ? username.split(".", 1)[0] : username;
}

async function bootstrapRuntimeRole(environment = process.env) {
  const configuration = resolveBootstrapConfiguration(environment);
  const migrationClient = new Client({
    connectionString: configuration.migrationDatabaseUrl,
    application_name: "portfolio-runtime-role-bootstrap",
  });
  let runtimeClient;
  try {
    await migrationClient.connect();
    await migrationClient.query(
      `SELECT
         pg_catalog.set_config('portfolio.runtime_role_name', $1, false),
         pg_catalog.set_config('portfolio.runtime_role_password', $2, false)`,
      [configuration.runtimeRole, configuration.runtimePassword],
    );
    const sql = readFileSync(resolve(__dirname, "../sql/runtime-role-privileges.sql"), "utf8");
    await migrationClient.query(sql);
    await migrationClient.query(
      `SELECT
         pg_catalog.set_config('portfolio.runtime_role_name', '', false),
         pg_catalog.set_config('portfolio.runtime_role_password', '', false)`,
    );

    runtimeClient = new Client({
      connectionString: configuration.runtimeDatabaseUrl,
      application_name: "portfolio-runtime-role-verifier",
    });
    await runtimeClient.connect();
    const identity = await runtimeClient.query(
      `SELECT
         CURRENT_USER AS "roleName",
         pg_catalog.current_database() AS "databaseName"`,
    );
    const roleName = identity.rows[0]?.roleName;
    if (roleName !== configuration.runtimeRole) {
      throw new Error("DATABASE_RUNTIME_URL이 생성한 제한 역할로 연결되지 않습니다.");
    }
    return {
      roleName,
      databaseName: identity.rows[0]?.databaseName,
    };
  } catch (error) {
    await migrationClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await runtimeClient?.end().catch(() => undefined);
    await migrationClient.end().catch(() => undefined);
  }
}

module.exports = {
  bootstrapRuntimeRole,
  databaseRoleName,
  resolveBootstrapConfiguration,
};

if (require.main === module) {
  loadDotenv({ path: resolve(__dirname, "../.env.local") });
  bootstrapRuntimeRole()
    .then(({ roleName, databaseName }) => {
      process.stdout.write(
        `Restricted runtime database role is ready: ${roleName}@${databaseName}\n`,
      );
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown bootstrap error";
      process.stderr.write(`Runtime database role bootstrap failed: ${message}\n`);
      process.exitCode = 1;
    });
}
