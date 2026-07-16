import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationsRoot = resolve(__dirname, "../prisma/migrations");

integrationDescribe("collection run terminal timeline PostgreSQL integration", () => {
  it("기존 시각을 보정하고 terminal 이전·이후의 늦은 증거와 상태 변경을 거부한다", async () => {
    if (!integrationDatabaseUrl) {
      throw new Error("integration database URL was not configured");
    }

    assertIsolatedTestDatabase(integrationDatabaseUrl);
    const pool = new Pool({ connectionString: integrationDatabaseUrl, max: 1 });
    const client = await pool.connect();
    const schemaName = `collection_timeline_${randomUUID().replaceAll("-", "")}`;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}", public`);
      await applyMigrationsThrough(client, "20260716163000_quarantine_legacy_market_snapshots");

      const accountId = randomUUID();
      const legacyRunId = randomUUID();
      await insertAccount(client, accountId);
      await insertCollectionRun(client, legacyRunId, accountId);
      const legacyAttemptId = await insertSucceededAttempt(
        client,
        legacyRunId,
        "getHoldings",
        "2026-07-17T00:00:02.000Z",
      );
      await insertValidation(client, legacyAttemptId, "getHoldings", "2026-07-17T00:00:03.000Z");
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'SUCCEEDED', "completed_at" = $2
         WHERE "id" = $1`,
        [legacyRunId, "2026-07-17T00:00:00.000Z"],
      );

      await applyMigration(client, "20260716164000_collection_run_terminal_timeline");
      expect(await collectionCompletedAt(client, legacyRunId)).toBe("2026-07-17T00:00:03.000Z");

      await client.query("BEGIN");
      const runId = randomUUID();
      await insertCollectionRun(client, runId, accountId);
      const attemptId = await insertSucceededAttempt(
        client,
        runId,
        "getPrices",
        "2026-07-17T00:00:05.000Z",
      );
      await insertValidation(client, attemptId, "getPrices", "2026-07-17T00:00:06.000Z");

      await expectRejectedSql(
        client,
        () =>
          client.query(
            `UPDATE "collection_run"
             SET "status" = 'SUCCEEDED', "completed_at" = $2
             WHERE "id" = $1`,
            [runId, "2026-07-17T00:00:05.500Z"],
          ),
        ["23514"],
      );
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'SUCCEEDED', "completed_at" = $2
         WHERE "id" = $1`,
        [runId, "2026-07-17T00:00:06.000Z"],
      );
      await expectRejectedSql(
        client,
        () =>
          client.query(
            `UPDATE "collection_run"
             SET "completed_at" = $2
             WHERE "id" = $1`,
            [runId, "2026-07-17T00:00:07.000Z"],
          ),
        ["23514"],
      );
      await expectRejectedSql(
        client,
        () => client.query(`DELETE FROM "collection_run" WHERE "id" = $1`, [runId]),
        ["23514"],
      );
      await expectRejectedSql(
        client,
        () => insertSucceededAttempt(client, runId, "getPrices", "2026-07-17T00:00:07.000Z"),
        ["23514"],
      );

      const noLateValidationRunId = randomUUID();
      await insertCollectionRun(client, noLateValidationRunId, accountId);
      const noLateValidationAttemptId = await insertSucceededAttempt(
        client,
        noLateValidationRunId,
        "getPrices",
        "2026-07-17T00:00:08.000Z",
      );
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'FAILED', "completed_at" = $2, "error_code" = 'SYNTHETIC_FAILURE'
         WHERE "id" = $1`,
        [noLateValidationRunId, "2026-07-17T00:00:08.000Z"],
      );
      await expectRejectedSql(
        client,
        () =>
          insertValidation(
            client,
            noLateValidationAttemptId,
            "getPrices",
            "2026-07-17T00:00:09.000Z",
          ),
        ["23514"],
      );

      await expectRejectedSql(
        client,
        () =>
          client.query(
            `INSERT INTO "collection_run" (
               "id", "account_id", "status", "started_at", "completed_at",
               "app_version", "adapter_version"
             ) VALUES ($1, $2, 'SUCCEEDED', $3, NULL, 'integration-test', 'integration-test')`,
            [randomUUID(), accountId, "2026-07-17T00:00:10.000Z"],
          ),
        ["23514"],
      );
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      client.release();
      await pool.end();
    }
  });
});

async function applyMigrationsThrough(
  client: PoolClient,
  finalMigrationName: string,
): Promise<void> {
  const migrationNames = readdirSync(migrationsRoot)
    .filter((name) => name <= finalMigrationName)
    .sort();
  for (const migrationName of migrationNames) {
    await applyMigration(client, migrationName);
  }
}

async function applyMigration(client: PoolClient, migrationName: string): Promise<void> {
  const sql = readFileSync(resolve(migrationsRoot, migrationName, "migration.sql"), "utf8");
  await client.query(sql);
}

async function expectRejectedSql(
  client: PoolClient,
  action: () => Promise<unknown>,
  allowedSqlStates: readonly string[],
): Promise<void> {
  await client.query("SAVEPOINT expected_failure");
  let caught: unknown;

  try {
    await action();
  } catch (error) {
    caught = error;
  }

  await client.query("ROLLBACK TO SAVEPOINT expected_failure");
  await client.query("RELEASE SAVEPOINT expected_failure");

  if (!caught) {
    throw new Error("expected PostgreSQL to reject the statement");
  }
  expect(allowedSqlStates).toContain(sqlState(caught));
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function insertAccount(client: PoolClient, accountId: string): Promise<void> {
  await client.query(
    `INSERT INTO "broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-timeline', 'SYNTHETIC', $3)`,
    [accountId, "a".repeat(64), "2026-07-17T00:00:00.000Z"],
  );
}

async function insertCollectionRun(
  client: PoolClient,
  runId: string,
  accountId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
    [runId, accountId, "2026-07-17T00:00:00.000Z"],
  );
}

async function insertSucceededAttempt(
  client: PoolClient,
  runId: string,
  operationId: string,
  completedAt: string,
): Promise<string> {
  const attemptId = randomUUID();
  await client.query(
    `INSERT INTO "broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "redacted_request_summary"
     ) VALUES ($1, 'COLLECTION', $2, $3, $4, 0, 1, 'integration-test', $5, $6,
       'SUCCEEDED', 200, '{}'::JSONB)`,
    [attemptId, randomUUID(), runId, operationId, "2026-07-17T00:00:00.000Z", completedAt],
  );
  return attemptId;
}

async function insertValidation(
  client: PoolClient,
  attemptId: string,
  operationId: string,
  validatedAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "broker_response_validation" (
       "request_attempt_id", "operation_id", "outcome", "redacted_body",
       "body_sha256", "safe_error_code", "validated_at"
     ) VALUES ($1, $2, 'PASSED', '{}'::JSONB, $3, NULL, $4)`,
    [attemptId, operationId, "b".repeat(64), validatedAt],
  );
}

async function collectionCompletedAt(client: PoolClient, runId: string): Promise<string> {
  const result = await client.query<{ completed_at: Date }>(
    `SELECT "completed_at" FROM "collection_run" WHERE "id" = $1`,
    [runId],
  );
  const completedAt = result.rows[0]?.completed_at;
  if (!completedAt) {
    throw new Error("collection run completion was not found");
  }
  return completedAt.toISOString();
}

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(^|[_-])(test|testing)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target a database whose name contains test",
    );
  }
}
