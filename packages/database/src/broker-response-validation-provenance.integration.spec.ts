import { randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;

let pool: Pool | undefined;

integrationDescribe("broker response validation provenance PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) {
      return;
    }

    assertIsolatedTestDatabase(integrationDatabaseUrl);
    pool = new Pool({ connectionString: integrationDatabaseUrl, max: 1 });

    const migration = await pool.query<{ finished_at: Date | null }>(
      `SELECT "finished_at"
       FROM "_prisma_migrations"
       WHERE "migration_name" = $1`,
      ["20260716162000_broker_response_validation_provenance"],
    );

    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0]?.finished_at).not.toBeNull();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("valid provenance를 허용하고 wrong run/outcome/operation/NULL/late insert를 거부한다", async () => {
    if (!pool) {
      throw new Error("integration pool was not initialized");
    }

    const client = await pool.connect();
    await client.query("BEGIN");

    try {
      const accountId = randomUUID();
      const primaryRunId = randomUUID();
      const otherRunId = randomUUID();
      const failedRunId = randomUUID();
      const snapshotId = randomUUID();

      await insertAccount(client, accountId);
      await insertCollectionRun(client, primaryRunId, accountId);
      await insertCollectionRun(client, otherRunId, accountId);
      await insertCollectionRun(client, failedRunId, accountId);
      await insertSnapshot(client, snapshotId, primaryRunId, accountId);

      const validPriceAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getPrices",
        0,
      );
      await insertValidation(client, validPriceAttemptId, "getPrices", "PASSED", null);
      await insertPrice(client, snapshotId, validPriceAttemptId, "005930");

      const validCalendarAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getKrMarketCalendar",
        1,
      );
      await insertValidation(client, validCalendarAttemptId, "getKrMarketCalendar", "PASSED", null);
      await insertKrCalendar(client, snapshotId, validCalendarAttemptId);

      const otherRunAttemptId = await insertSucceededAttempt(client, otherRunId, "getPrices", 0);
      await insertValidation(client, otherRunAttemptId, "getPrices", "PASSED", null);
      await expectRejectedSql(
        client,
        () => insertPrice(client, snapshotId, otherRunAttemptId, "000660"),
        ["23514"],
      );

      const failedAttemptId = await insertHttpErrorAttempt(client, primaryRunId, "getPrices", 2);
      await expectRejectedSql(
        client,
        () => insertValidation(client, failedAttemptId, "getPrices", "PASSED", null),
        ["23514"],
      );

      const schemaErrorAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getPrices",
        3,
      );
      await insertValidation(
        client,
        schemaErrorAttemptId,
        "getPrices",
        "SCHEMA_ERROR",
        "TOSS_RESPONSE_SCHEMA_ERROR",
      );
      await expectRejectedSql(
        client,
        () => insertPrice(client, snapshotId, schemaErrorAttemptId, "035420"),
        ["23514"],
      );

      const wrongPriceOperationAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getOrderBook",
        4,
      );
      await insertValidation(client, wrongPriceOperationAttemptId, "getOrderBook", "PASSED", null);
      await expectRejectedSql(
        client,
        () => insertPrice(client, snapshotId, wrongPriceOperationAttemptId, "051910"),
        ["23514"],
      );

      const wrongCalendarOperationAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getUsMarketCalendar",
        5,
      );
      await insertValidation(
        client,
        wrongCalendarOperationAttemptId,
        "getUsMarketCalendar",
        "PASSED",
        null,
      );
      await expectRejectedSql(
        client,
        () => insertKrCalendar(client, snapshotId, wrongCalendarOperationAttemptId),
        ["23514"],
      );

      await expectRejectedSql(client, () => insertPrice(client, snapshotId, null, "068270"), [
        "23502",
        "23514",
      ]);

      const lateValidationAttemptId = await insertSucceededAttempt(
        client,
        primaryRunId,
        "getPrices",
        6,
      );
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'SUCCEEDED', "completed_at" = $2
         WHERE "id" = $1`,
        [primaryRunId, "2026-07-17T00:01:00.000Z"],
      );
      await expectRejectedSql(
        client,
        () => insertValidation(client, lateValidationAttemptId, "getPrices", "PASSED", null),
        ["23514"],
      );
      const failedRunAttemptId = await insertSucceededAttempt(client, failedRunId, "getPrices", 0);
      await client.query(
        `UPDATE "collection_run"
         SET "status" = 'FAILED', "completed_at" = $2, "error_code" = 'SYNTHETIC_FAILURE'
         WHERE "id" = $1`,
        [failedRunId, "2026-07-17T00:01:00.000Z"],
      );
      await expectRejectedSql(
        client,
        () => insertValidation(client, failedRunAttemptId, "getPrices", "PASSED", null),
        ["23514"],
      );
      await expectRejectedSql(
        client,
        () => insertPrice(client, snapshotId, validPriceAttemptId, "105560"),
        ["P0001", "23514"],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));

  if (!/(^|[_-])(test|testing)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target a database whose name contains test",
    );
  }
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
     ) VALUES ($1, 'TOSS', $2, '***-test', 'SYNTHETIC', $3)`,
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

async function insertSnapshot(
  client: PoolClient,
  snapshotId: string,
  runId: string,
  accountId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "portfolio_snapshot" (
       "id", "collection_run_id", "account_id", "observed_at", "validation_status",
       "base_currency", "managed_cash_minor", "securities_value_minor", "total_value_minor", "digest"
     ) VALUES ($1, $2, $3, $4, 'VERIFIED', 'KRW', 0, 100000, 100000, $5)`,
    [snapshotId, runId, accountId, "2026-07-17T00:00:02.000Z", "b".repeat(64)],
  );
}

async function insertSucceededAttempt(
  client: PoolClient,
  runId: string,
  operationId: string,
  ordinal: number,
): Promise<string> {
  const attemptId = randomUUID();
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
  return attemptId;
}

async function insertHttpErrorAttempt(
  client: PoolClient,
  runId: string,
  operationId: string,
  ordinal: number,
): Promise<string> {
  const attemptId = randomUUID();
  await client.query(
    `INSERT INTO "broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "safe_error_code", "redacted_request_summary"
     ) VALUES ($1, 'COLLECTION', $2, $3, $4, $5, 1, 'integration-test', $6, $7,
       'HTTP_ERROR', 500, 'TOSS_API_HTTP_ERROR', '{}'::JSONB)`,
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
  return attemptId;
}

async function insertValidation(
  client: PoolClient,
  attemptId: string,
  operationId: string,
  outcome: "PASSED" | "SCHEMA_ERROR",
  safeErrorCode: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO "broker_response_validation" (
       "request_attempt_id", "operation_id", "outcome", "redacted_body",
       "body_sha256", "safe_error_code", "validated_at"
     ) VALUES ($1, $2, $3, '{}'::JSONB, $4, $5, $6)`,
    [attemptId, operationId, outcome, "c".repeat(64), safeErrorCode, "2026-07-17T00:00:02.000Z"],
  );
}

async function insertPrice(
  client: PoolClient,
  snapshotId: string,
  attemptId: string | null,
  symbol: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "price_snapshot" (
       "snapshot_id", "request_attempt_id", "market_country", "symbol", "currency",
       "last_price", "provider_observed_at", "received_at"
     ) VALUES ($1, $2, 'KR', $3, 'KRW', '70000', $4, $5)`,
    [snapshotId, attemptId, symbol, "2026-07-17T00:00:01.000Z", "2026-07-17T00:00:02.000Z"],
  );
}

async function insertKrCalendar(
  client: PoolClient,
  snapshotId: string,
  attemptId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "market_calendar_snapshot" (
       "snapshot_id", "request_attempt_id", "market_country", "requested_date",
       "calendar", "calendar_sha256", "received_at"
     ) VALUES ($1, $2, 'KR', '2026-07-17', $3::JSONB, $4, $5)`,
    [
      snapshotId,
      attemptId,
      JSON.stringify({
        marketCountry: "KR",
        today: { date: "2026-07-17", sessions: [] },
        previousBusinessDay: { date: "2026-07-16", sessions: [] },
        nextBusinessDay: { date: "2026-07-20", sessions: [] },
      }),
      "d".repeat(64),
      "2026-07-17T00:00:02.000Z",
    ],
  );
}
