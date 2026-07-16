import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationsRoot = resolve(__dirname, "../prisma/migrations");

integrationDescribe("legacy market snapshot quarantine PostgreSQL integration", () => {
  it("validation을 합성하지 않고 이전 VERIFIED snapshot을 BLOCKED로 격리한다", async () => {
    if (!integrationDatabaseUrl) {
      throw new Error("integration database URL was not configured");
    }

    assertIsolatedTestDatabase(integrationDatabaseUrl);
    const pool = new Pool({ connectionString: integrationDatabaseUrl, max: 1 });
    const client = await pool.connect();
    const schemaName = `legacy_quarantine_${randomUUID().replaceAll("-", "")}`;

    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}", public`);
      await applyMigrationsThrough(client, "20260716161000_market_snapshot_evidence");

      const accountId = randomUUID();
      const runId = randomUUID();
      const snapshotId = randomUUID();
      const holdingsAttemptId = randomUUID();
      const priceAttemptId = randomUUID();
      const calendarAttemptId = randomUUID();

      await client.query(
        `INSERT INTO "broker_account" (
           "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
         ) VALUES ($1, 'TOSS', $2, '***-legacy', 'SYNTHETIC', $3)`,
        [accountId, "a".repeat(64), "2026-07-17T00:00:00.000Z"],
      );
      await client.query(
        `INSERT INTO "collection_run" (
           "id", "account_id", "status", "started_at", "app_version", "adapter_version"
         ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
        [runId, accountId, "2026-07-17T00:00:00.000Z"],
      );
      await insertSucceededAttempt(client, holdingsAttemptId, runId, "getHoldings", 0);
      await insertSucceededAttempt(client, priceAttemptId, runId, "getPrices", 1);
      await insertSucceededAttempt(client, calendarAttemptId, runId, "getKrMarketCalendar", 2);
      await client.query(
        `INSERT INTO "portfolio_snapshot" (
           "id", "collection_run_id", "account_id", "observed_at", "validation_status",
           "base_currency", "managed_cash_minor", "securities_value_minor", "total_value_minor",
           "digest"
         ) VALUES ($1, $2, $3, $4, 'VERIFIED', 'KRW', 0, 100000, 100000, $5)`,
        [snapshotId, runId, accountId, "2026-07-17T00:00:02.000Z", "b".repeat(64)],
      );
      await client.query(
        `INSERT INTO "price_snapshot" (
           "snapshot_id", "request_attempt_id", "market_country", "symbol", "currency",
           "last_price", "provider_observed_at", "received_at"
         ) VALUES ($1, $2, 'KR', '005930', 'KRW', '70000', $3, $4)`,
        [snapshotId, priceAttemptId, "2026-07-17T00:00:01.000Z", "2026-07-17T00:00:02.000Z"],
      );
      await client.query(
        `INSERT INTO "market_calendar_snapshot" (
           "snapshot_id", "request_attempt_id", "market_country", "requested_date",
           "calendar", "calendar_sha256", "received_at"
         ) VALUES ($1, $2, 'KR', '2026-07-17', $3::JSONB, $4, $5)`,
        [
          snapshotId,
          calendarAttemptId,
          JSON.stringify({
            marketCountry: "KR",
            today: { date: "2026-07-17", sessions: [] },
            previousBusinessDay: { date: "2026-07-16", sessions: [] },
            nextBusinessDay: { date: "2026-07-20", sessions: [] },
          }),
          "c".repeat(64),
          "2026-07-17T00:00:02.000Z",
        ],
      );
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'SUCCEEDED', "completed_at" = $2
         WHERE "id" = $1`,
        [runId, "2026-07-17T00:01:00.000Z"],
      );

      await applyMigration(client, "20260716162000_broker_response_validation_provenance");
      expect(await snapshotValidationStatus(client, snapshotId)).toBe("VERIFIED");
      expect(await responseValidationCount(client)).toBe(0);

      await applyMigration(client, "20260716163000_quarantine_legacy_market_snapshots");
      expect(await snapshotValidationStatus(client, snapshotId)).toBe("BLOCKED");
      expect(await responseValidationCount(client)).toBe(0);
      expect(
        await client.query<{ outcome: string }>(
          `SELECT "outcome"
           FROM "snapshot_check"
           WHERE "snapshot_id" = $1
             AND "rule_code" = 'BROKER_RESPONSE_PROVENANCE'`,
          [snapshotId],
        ),
      ).toMatchObject({ rows: [{ outcome: "BLOCKED" }] });
    } finally {
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

async function insertSucceededAttempt(
  client: PoolClient,
  attemptId: string,
  runId: string,
  operationId: string,
  ordinal: number,
): Promise<void> {
  await client.query(
    `INSERT INTO "broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "redacted_request_summary"
     ) VALUES ($1, 'COLLECTION', $2, $3, $4, $5, 1, 'integration-test', $6, $7,
       'SUCCEEDED', 200, '{}'::JSONB)`,
    [
      attemptId,
      randomUUID(),
      runId,
      operationId,
      ordinal,
      "2026-07-17T00:00:00.000Z",
      "2026-07-17T00:00:01.000Z",
    ],
  );
}

async function snapshotValidationStatus(
  client: PoolClient,
  snapshotId: string,
): Promise<string | undefined> {
  const result = await client.query<{ validation_status: string }>(
    `SELECT "validation_status"
     FROM "portfolio_snapshot"
     WHERE "id" = $1`,
    [snapshotId],
  );
  return result.rows[0]?.validation_status;
}

async function responseValidationCount(client: PoolClient): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS "count" FROM "broker_response_validation"`,
  );
  return Number(result.rows[0]?.count ?? "-1");
}

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));

  if (!/(^|[_-])(test|testing)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target a database whose name contains test",
    );
  }
}
