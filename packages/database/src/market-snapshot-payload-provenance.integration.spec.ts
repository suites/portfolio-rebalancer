import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationName = "20260716165000_market_snapshot_payload_provenance";
const migrationSql = readFileSync(
  resolve(__dirname, `../prisma/migrations/${migrationName}/migration.sql`),
  "utf8",
);

const immutableEvidenceTables = [
  "raw_broker_response",
  "portfolio_snapshot",
  "holding_snapshot",
  "snapshot_check",
  "buying_power_snapshot",
  "price_snapshot",
  "market_calendar_snapshot",
  "broker_request_attempt",
  "broker_response_validation",
  "instrument_validation",
] as const;

let pool: Pool | undefined;

integrationDescribe("market snapshot payload provenance PostgreSQL integration", () => {
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
      [migrationName],
    );

    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0]?.finished_at).not.toBeNull();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("wrong price/symbol/currency/timestamp/date/receivedAt을 거부하고 정확한 원문만 허용한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");

    try {
      const { runId, snapshotId } = await insertRunningSnapshot(client);
      const completedAt = "2026-07-17T00:00:01.000Z";
      const priceAttemptId = await insertSucceededAttempt(
        client,
        runId,
        "getPrices",
        0,
        completedAt,
      );
      await insertValidation(client, priceAttemptId, "getPrices", {
        result: [
          priceItem("005930", "KRW", "70000"),
          priceItem("000660", "KRW", "182000"),
          priceItem("035420", "KRW", "245000"),
          priceItem("AAPL", "USD", "211.10"),
          priceItem("MSFT", "KRW", "515.25"),
        ],
      });

      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId,
          attemptId: priceAttemptId,
          marketCountry: "KR",
          symbol: "000660",
          currency: "KRW",
          lastPrice: "181000",
          providerObservedAt: "2026-07-17T00:00:00.000Z",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId,
          attemptId: priceAttemptId,
          marketCountry: "KR",
          symbol: "068270",
          currency: "KRW",
          lastPrice: "170000",
          providerObservedAt: "2026-07-17T00:00:00.000Z",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId,
          attemptId: priceAttemptId,
          marketCountry: "US",
          symbol: "MSFT",
          currency: "USD",
          lastPrice: "515.25",
          providerObservedAt: "2026-07-17T00:00:00.000Z",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId,
          attemptId: priceAttemptId,
          marketCountry: "KR",
          symbol: "035420",
          currency: "KRW",
          lastPrice: "245000",
          providerObservedAt: "2026-07-17T00:00:00.500Z",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId,
          attemptId: priceAttemptId,
          marketCountry: "US",
          symbol: "AAPL",
          currency: "USD",
          lastPrice: "211.10",
          providerObservedAt: "2026-07-17T00:00:00.000Z",
          receivedAt: "2026-07-17T00:00:02.000Z",
        }),
      );

      await insertPrice(client, {
        snapshotId,
        attemptId: priceAttemptId,
        marketCountry: "KR",
        symbol: "005930",
        currency: "KRW",
        lastPrice: "70000",
        providerObservedAt: "2026-07-17T00:00:00.000Z",
        receivedAt: completedAt,
      });

      const calendarAttemptId = await insertSucceededAttempt(
        client,
        runId,
        "getKrMarketCalendar",
        1,
        completedAt,
      );
      await insertValidation(client, calendarAttemptId, "getKrMarketCalendar", rawKrCalendar());

      await expectRejectedSql(client, () =>
        insertKrCalendar(client, snapshotId, calendarAttemptId, {
          today: "2026-07-18",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertKrCalendar(client, snapshotId, calendarAttemptId, {
          previousBusinessDay: "2026-07-15",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertKrCalendar(client, snapshotId, calendarAttemptId, {
          nextBusinessDay: "2026-07-21",
          receivedAt: completedAt,
        }),
      );
      await expectRejectedSql(client, () =>
        insertKrCalendar(client, snapshotId, calendarAttemptId, {
          receivedAt: "2026-07-17T00:00:02.000Z",
        }),
      );

      await insertKrCalendar(client, snapshotId, calendarAttemptId, { receivedAt: completedAt });

      expect(
        await client.query<{ symbol: string }>(
          `SELECT "symbol" FROM public."price_snapshot" WHERE "snapshot_id" = $1`,
          [snapshotId],
        ),
      ).toMatchObject({ rows: [{ symbol: "005930" }] });
      expect(
        await client.query<{ market_country: string }>(
          `SELECT "market_country"
           FROM public."market_calendar_snapshot"
           WHERE "snapshot_id" = $1`,
          [snapshotId],
        ),
      ).toMatchObject({ rows: [{ market_country: "KR" }] });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("TEMP relation shadowing으로 HTTP·run provenance 검사를 우회하지 못한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");

    try {
      const primary = await insertRunningSnapshot(client);
      const other = await insertRunningSnapshot(client);
      const completedAt = "2026-07-17T00:00:01.000Z";
      const failedAttemptId = await insertHttpErrorAttempt(
        client,
        primary.runId,
        "getPrices",
        0,
        completedAt,
      );
      const otherRunAttemptId = await insertSucceededAttempt(
        client,
        other.runId,
        "getPrices",
        0,
        completedAt,
      );
      await insertValidation(client, otherRunAttemptId, "getPrices", {
        result: [priceItem("005930", "KRW", "70000")],
      });

      await createTempShadowRelations(client, {
        primaryRunId: primary.runId,
        primarySnapshotId: primary.snapshotId,
        failedAttemptId,
        otherRunAttemptId,
        completedAt,
      });

      await expectRejectedSql(client, () =>
        insertValidation(client, failedAttemptId, "getPrices", {
          result: [priceItem("005930", "KRW", "70000")],
        }),
      );
      await expectRejectedSql(client, () =>
        insertPrice(client, {
          snapshotId: primary.snapshotId,
          attemptId: otherRunAttemptId,
          marketCountry: "KR",
          symbol: "005930",
          currency: "KRW",
          lastPrice: "70000",
          providerObservedAt: "2026-07-17T00:00:00.000Z",
          receivedAt: completedAt,
        }),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("immutable evidence trigger가 ALWAYS이며 replica role에서도 UPDATE와 TRUNCATE를 차단한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");

    try {
      const { runId, snapshotId } = await insertRunningSnapshot(client);
      const completedAt = "2026-07-17T00:00:01.000Z";
      const attemptId = await insertSucceededAttempt(client, runId, "getPrices", 0, completedAt);
      await insertValidation(client, attemptId, "getPrices", {
        result: [priceItem("005930", "KRW", "70000")],
      });
      await insertPrice(client, {
        snapshotId,
        attemptId,
        marketCountry: "KR",
        symbol: "005930",
        currency: "KRW",
        lastPrice: "70000",
        providerObservedAt: "2026-07-17T00:00:00.000Z",
        receivedAt: completedAt,
      });

      const triggers = await client.query<{
        table_name: string;
        trigger_name: string;
        enabled: string;
      }>(
        `SELECT
           relation.relname AS "table_name",
           trigger.tgname AS "trigger_name",
           trigger.tgenabled AS "enabled"
         FROM pg_catalog.pg_trigger AS trigger
         JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = ANY($1::TEXT[])
           AND trigger.tgname IN (
             relation.relname || '_immutable',
             relation.relname || '_immutable_truncate'
           )`,
        [immutableEvidenceTables],
      );

      expect(triggers.rows).toHaveLength(immutableEvidenceTables.length * 2);
      expect(triggers.rows.every(({ enabled }) => enabled === "A")).toBe(true);

      const collectionRunTriggers = await client.query<{ trigger_name: string; enabled: string }>(
        `SELECT trigger.tgname AS "trigger_name", trigger.tgenabled AS "enabled"
         FROM pg_catalog.pg_trigger AS trigger
         JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
         JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = 'collection_run'
           AND trigger.tgname IN (
             'collection_run_terminal_timeline_guard',
             'collection_run_terminal_timeline_truncate'
           )
         ORDER BY trigger.tgname`,
      );
      expect(collectionRunTriggers.rows).toEqual([
        { trigger_name: "collection_run_terminal_timeline_guard", enabled: "A" },
        { trigger_name: "collection_run_terminal_timeline_truncate", enabled: "A" },
      ]);

      await client.query("SET LOCAL session_replication_role = replica");
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."price_snapshot" SET "last_price" = '71000' WHERE "snapshot_id" = $1`,
          [snapshotId],
        ),
      );
      await expectRejectedSql(client, () => client.query(`TRUNCATE public."price_snapshot"`));
      await expectRejectedSql(client, () =>
        client.query(`TRUNCATE public."collection_run" CASCADE`),
      );
      await client.query("SET LOCAL session_replication_role = origin");

      const remaining = await client.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS "count"
         FROM public."price_snapshot"
         WHERE "snapshot_id" = $1`,
        [snapshotId],
      );
      expect(remaining.rows[0]?.count).toBe("1");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("부분 적용 뒤 다시 실행해도 function과 trigger 설치가 재시작 가능하다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");

    try {
      await client.query(migrationSql);
      await client.query(migrationSql);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function integrationClient(): Promise<PoolClient> {
  if (!pool) {
    throw new Error("integration pool was not initialized");
  }
  return pool.connect();
}

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

  expect(["23514", "P0001", "55000"]).toContain(sqlState(caught));
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function insertRunningSnapshot(
  client: PoolClient,
): Promise<{ accountId: string; runId: string; snapshotId: string }> {
  const accountId = randomUUID();
  const runId = randomUUID();
  const snapshotId = randomUUID();

  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-test', 'SYNTHETIC', $3)`,
    [accountId, randomUUID().replaceAll("-", "").repeat(2), "2026-07-17T00:00:00.000Z"],
  );
  await client.query(
    `INSERT INTO public."collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
    [runId, accountId, "2026-07-17T00:00:00.000Z"],
  );
  await client.query(
    `INSERT INTO public."portfolio_snapshot" (
       "id", "collection_run_id", "account_id", "observed_at", "validation_status",
       "base_currency", "managed_cash_minor", "securities_value_minor", "total_value_minor", "digest"
     ) VALUES ($1, $2, $3, $4, 'VERIFIED', 'KRW', 0, 100000, 100000, $5)`,
    [snapshotId, runId, accountId, "2026-07-17T00:00:02.000Z", "b".repeat(64)],
  );

  return { accountId, runId, snapshotId };
}

async function insertSucceededAttempt(
  client: PoolClient,
  runId: string,
  operationId: string,
  ordinal: number,
  completedAt: string,
): Promise<string> {
  const attemptId = randomUUID();
  await client.query(
    `INSERT INTO public."broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "redacted_request_summary"
     ) VALUES ($1, 'COLLECTION', $2, $3, $4, $5, 1, 'integration-test', $6, $7,
       'SUCCEEDED', 200, '{}'::JSONB)`,
    [attemptId, randomUUID(), runId, operationId, ordinal, "2026-07-17T00:00:00.000Z", completedAt],
  );
  return attemptId;
}

async function insertHttpErrorAttempt(
  client: PoolClient,
  runId: string,
  operationId: string,
  ordinal: number,
  completedAt: string,
): Promise<string> {
  const attemptId = randomUUID();
  await client.query(
    `INSERT INTO public."broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "safe_error_code", "redacted_request_summary"
     ) VALUES ($1, 'COLLECTION', $2, $3, $4, $5, 1, 'integration-test', $6, $7,
       'HTTP_ERROR', 500, 'TOSS_API_HTTP_ERROR', '{}'::JSONB)`,
    [attemptId, randomUUID(), runId, operationId, ordinal, "2026-07-17T00:00:00.000Z", completedAt],
  );
  return attemptId;
}

async function insertValidation(
  client: PoolClient,
  attemptId: string,
  operationId: string,
  redactedBody: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO public."broker_response_validation" (
       "request_attempt_id", "operation_id", "outcome", "redacted_body",
       "body_sha256", "safe_error_code", "validated_at"
     ) VALUES ($1, $2, 'PASSED', $3::JSONB, $4, NULL, $5)`,
    [
      attemptId,
      operationId,
      JSON.stringify(redactedBody),
      "c".repeat(64),
      "2026-07-17T00:00:02.000Z",
    ],
  );
}

interface PriceInput {
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly marketCountry: "KR" | "US";
  readonly symbol: string;
  readonly currency: "KRW" | "USD";
  readonly lastPrice: string;
  readonly providerObservedAt: string | null;
  readonly receivedAt: string;
}

async function insertPrice(client: PoolClient, input: PriceInput): Promise<void> {
  await client.query(
    `INSERT INTO public."price_snapshot" (
       "snapshot_id", "request_attempt_id", "market_country", "symbol", "currency",
       "last_price", "provider_observed_at", "received_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.snapshotId,
      input.attemptId,
      input.marketCountry,
      input.symbol,
      input.currency,
      input.lastPrice,
      input.providerObservedAt,
      input.receivedAt,
    ],
  );
}

interface CalendarOverrides {
  readonly today?: string;
  readonly previousBusinessDay?: string;
  readonly nextBusinessDay?: string;
  readonly receivedAt: string;
}

async function insertKrCalendar(
  client: PoolClient,
  snapshotId: string,
  attemptId: string,
  overrides: CalendarOverrides,
): Promise<void> {
  const today = overrides.today ?? "2026-07-17";
  const previousBusinessDay = overrides.previousBusinessDay ?? "2026-07-16";
  const nextBusinessDay = overrides.nextBusinessDay ?? "2026-07-20";
  await client.query(
    `INSERT INTO public."market_calendar_snapshot" (
       "snapshot_id", "request_attempt_id", "market_country", "requested_date",
       "calendar", "calendar_sha256", "received_at"
     ) VALUES ($1, $2, 'KR', $3, $4::JSONB, $5, $6)`,
    [
      snapshotId,
      attemptId,
      today,
      JSON.stringify({
        marketCountry: "KR",
        today: { date: today, sessions: [] },
        previousBusinessDay: { date: previousBusinessDay, sessions: [] },
        nextBusinessDay: { date: nextBusinessDay, sessions: [] },
      }),
      "d".repeat(64),
      overrides.receivedAt,
    ],
  );
}

function priceItem(symbol: string, currency: "KRW" | "USD", lastPrice: string) {
  return {
    symbol,
    currency,
    lastPrice,
    timestamp: "2026-07-17T00:00:00.000Z",
  };
}

function rawKrCalendar() {
  return {
    result: {
      today: { date: "2026-07-17", integrated: null },
      previousBusinessDay: { date: "2026-07-16", integrated: null },
      nextBusinessDay: { date: "2026-07-20", integrated: null },
    },
  };
}

async function createTempShadowRelations(
  client: PoolClient,
  input: {
    readonly primaryRunId: string;
    readonly primarySnapshotId: string;
    readonly failedAttemptId: string;
    readonly otherRunAttemptId: string;
    readonly completedAt: string;
  },
): Promise<void> {
  await client.query(
    `CREATE TEMP TABLE "collection_run" (
       "id" UUID PRIMARY KEY,
       "status" public."CollectionRunStatus" NOT NULL
     ) ON COMMIT DROP`,
  );
  await client.query(
    `CREATE TEMP TABLE "portfolio_snapshot" (
       "id" UUID PRIMARY KEY,
       "collection_run_id" UUID NOT NULL
     ) ON COMMIT DROP`,
  );
  await client.query(
    `CREATE TEMP TABLE "broker_request_attempt" (
       "id" UUID PRIMARY KEY,
       "collection_run_id" UUID,
       "operation_id" TEXT NOT NULL,
       "outcome" public."BrokerRequestOutcome" NOT NULL,
       "http_status" INTEGER,
       "completed_at" TIMESTAMPTZ(6) NOT NULL
     ) ON COMMIT DROP`,
  );
  await client.query(
    `CREATE TEMP TABLE "broker_response_validation" (
       "request_attempt_id" UUID PRIMARY KEY,
       "operation_id" TEXT NOT NULL,
       "outcome" public."BrokerResponseValidationOutcome" NOT NULL,
       "redacted_body" JSONB NOT NULL
     ) ON COMMIT DROP`,
  );

  await client.query(`INSERT INTO "collection_run" ("id", "status") VALUES ($1, 'RUNNING')`, [
    input.primaryRunId,
  ]);
  await client.query(
    `INSERT INTO "portfolio_snapshot" ("id", "collection_run_id") VALUES ($1, $2)`,
    [input.primarySnapshotId, input.primaryRunId],
  );
  await client.query(
    `INSERT INTO "broker_request_attempt" (
       "id", "collection_run_id", "operation_id", "outcome", "http_status", "completed_at"
     ) VALUES
       ($1, $3, 'getPrices', 'SUCCEEDED', 200, $4),
       ($2, $3, 'getPrices', 'SUCCEEDED', 200, $4)`,
    [input.failedAttemptId, input.otherRunAttemptId, input.primaryRunId, input.completedAt],
  );
  await client.query(
    `INSERT INTO "broker_response_validation" (
       "request_attempt_id", "operation_id", "outcome", "redacted_body"
     ) VALUES ($1, 'getPrices', 'PASSED', $2::JSONB)`,
    [input.otherRunAttemptId, JSON.stringify({ result: [priceItem("005930", "KRW", "70000")] })],
  );
}
