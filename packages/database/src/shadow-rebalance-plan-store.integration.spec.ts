import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationName = "20260716166000_shadow_rebalance_plan_store";

let pool: Pool | undefined;

integrationDescribe("shadow rebalance plan store PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) return;
    assertIsolatedTestDatabase(integrationDatabaseUrl);
    pool = new Pool({ connectionString: integrationDatabaseUrl, max: 1 });
    const migration = await pool.query<{ finished_at: Date | null }>(
      `SELECT "finished_at"
       FROM public."_prisma_migrations"
       WHERE "migration_name" = $1`,
      [migrationName],
    );
    expect(migration.rows).toHaveLength(1);
    expect(migration.rows[0]?.finished_at).not.toBeNull();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("NO_ACTION 계획을 봉인하고 terminal 이후 변경을 거부한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertPinnedFixture(client);
      const runId = await insertRebalanceRun(client, fixture);
      await insertPlan(client, {
        runId,
        fixture,
        status: "NO_ACTION",
        totalValueMinor: 100_000n,
      });
      await client.query(
        `UPDATE public."rebalance_run"
         SET "status" = 'NO_ACTION', "completed_at" = $2
         WHERE "id" = $1`,
        [runId, "2026-07-17T00:01:01.000Z"],
      );

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."rebalance_run"
           SET "completed_at" = $2
           WHERE "id" = $1`,
          [runId, "2026-07-17T00:01:02.000Z"],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."rebalance_plan" WHERE "run_id" = $1`, [runId]),
      );
      await client.query("SET LOCAL session_replication_role = replica");
      await expectRejectedSql(client, () =>
        client.query(`TRUNCATE public."rebalance_plan" CASCADE`),
      );
      await client.query("SET LOCAL session_replication_role = origin");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("snapshot digest나 target config hash가 다르면 run 시작을 거부한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertPinnedFixture(client);
      await expectRejectedSql(client, () =>
        insertRebalanceRun(client, { ...fixture, snapshotDigest: "f".repeat(64) }),
      );
      await expectRejectedSql(client, () =>
        insertRebalanceRun(client, {
          ...fixture,
          targetConfigContentHash: "e".repeat(64),
        }),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("PLANNED는 유효한 order candidate가 있어야 봉인되고 이후 추가할 수 없다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertPinnedFixture(client);
      const runId = await insertRebalanceRun(client, fixture);
      const planId = await insertPlan(client, {
        runId,
        fixture,
        status: "PLANNED",
        totalValueMinor: 100_000n,
      });

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."rebalance_run"
           SET "status" = 'PLANNED', "completed_at" = $2
           WHERE "id" = $1`,
          [runId, "2026-07-17T00:01:01.000Z"],
        ),
      );
      await expectRejectedSql(client, () =>
        insertPlanOrder(client, planId, { quantity: 2n, notionalMinor: 19_999n }),
      );
      await insertPlanOrder(client, planId);
      await client.query(
        `UPDATE public."rebalance_run"
         SET "status" = 'PLANNED', "completed_at" = $2
         WHERE "id" = $1`,
        [runId, "2026-07-17T00:01:01.000Z"],
      );
      await expectRejectedSql(client, () =>
        insertPlanOrder(client, planId, {
          candidateId: "SAFE:KR:069500:BUY",
          symbol: "069500",
          ordinal: 1,
        }),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("dedupe key와 plan identity의 중복을 DB에서 거부한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertPinnedFixture(client);
      const dedupeKey = "9".repeat(64);
      await insertRebalanceRun(client, fixture, dedupeKey);
      await expectRejectedSql(client, () => insertRebalanceRun(client, fixture, dedupeKey), [
        "23505",
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

interface PinnedFixture {
  readonly accountId: string;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly targetConfigVersionId: string;
  readonly targetConfigContentHash: string;
}

async function insertPinnedFixture(client: PoolClient): Promise<PinnedFixture> {
  const accountId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const configId = randomUUID();
  const targetConfigVersionId = randomUUID();
  const snapshotDigest = randomHex64();
  const targetConfigContentHash = randomHex64();
  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-plan', 'SYNTHETIC', $3)`,
    [accountId, randomHex64(), "2026-07-17T00:00:00.000Z"],
  );
  await client.query(
    `INSERT INTO public."target_config" ("id", "account_id")
     VALUES ($1, $2)`,
    [configId, accountId],
  );
  await client.query(
    `INSERT INTO public."target_config_version" (
       "id", "config_id", "version", "status", "content_hash", "app_version",
       "source", "cash_policy"
     ) VALUES ($1, $2, 1, 'ACTIVE', $3, 'integration-test', '{}'::JSONB,
       '{"mode":"EXCLUDED","version":"CASH_V1"}'::JSONB)`,
    [targetConfigVersionId, configId, targetConfigContentHash],
  );
  await client.query(
    `INSERT INTO public."collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
    [collectionRunId, accountId, "2026-07-17T00:00:00.000Z"],
  );
  await client.query(
    `INSERT INTO public."portfolio_snapshot" (
       "id", "collection_run_id", "account_id", "target_config_version_id",
       "observed_at", "validation_status", "base_currency", "managed_cash_minor",
       "securities_value_minor", "total_value_minor", "digest"
     ) VALUES ($1, $2, $3, $4, $5, 'VERIFIED', 'KRW', 0, 100000, 100000, $6)`,
    [
      snapshotId,
      collectionRunId,
      accountId,
      targetConfigVersionId,
      "2026-07-17T00:00:01.000Z",
      snapshotDigest,
    ],
  );
  return {
    accountId,
    snapshotId,
    snapshotDigest,
    targetConfigVersionId,
    targetConfigContentHash,
  };
}

async function insertRebalanceRun(
  client: PoolClient,
  fixture: PinnedFixture,
  dedupeKey = randomHex64(),
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."rebalance_run" (
       "id", "account_id", "snapshot_id", "snapshot_digest",
       "target_config_version_id", "target_config_content_hash", "mode", "status",
       "dedupe_key", "started_at", "app_version", "policy_version"
     ) VALUES ($1, $2, $3, $4, $5, $6, 'SHADOW', 'RUNNING', $7, $8,
       'integration-test', 'SHADOW_PLAN_V1')`,
    [
      id,
      fixture.accountId,
      fixture.snapshotId,
      fixture.snapshotDigest,
      fixture.targetConfigVersionId,
      fixture.targetConfigContentHash,
      dedupeKey,
      "2026-07-17T00:01:00.000Z",
    ],
  );
  return id;
}

async function insertPlan(
  client: PoolClient,
  input: {
    readonly runId: string;
    readonly fixture: PinnedFixture;
    readonly status: "NO_ACTION" | "PLANNED" | "BLOCKED";
    readonly totalValueMinor: bigint | null;
  },
): Promise<string> {
  const id = randomUUID();
  const canonicalContent = JSON.stringify({ status: input.status });
  const planHash = createHash("sha256").update(canonicalContent).digest("hex");
  await client.query(
    `INSERT INTO public."rebalance_plan" (
       "id", "run_id", "snapshot_id", "target_config_version_id", "mode", "status",
       "canonical_version", "plan_hash", "return_policy", "total_value_minor",
       "reason_codes", "canonical_content", "asset_decisions",
       "deferred_buy_needs", "projected_allocations"
     ) VALUES ($1, $2, $3, $4, 'SHADOW', $5, 'SHADOW_PLAN_V1', $6,
       'BAND_EDGE', $7, $8::JSONB, $9, '[]'::JSONB, '[]'::JSONB, '[]'::JSONB)`,
    [
      id,
      input.runId,
      input.fixture.snapshotId,
      input.fixture.targetConfigVersionId,
      input.status,
      planHash,
      input.totalValueMinor?.toString() ?? null,
      JSON.stringify([
        input.status === "PLANNED"
          ? "BUY_PHASE_READY"
          : input.status === "BLOCKED"
            ? "PRICE_MISSING_OR_INVALID"
            : "NO_REBALANCE_NEEDED",
      ]),
      canonicalContent,
    ],
  );
  return id;
}

async function insertPlanOrder(
  client: PoolClient,
  planId: string,
  overrides: {
    readonly candidateId?: string;
    readonly symbol?: string;
    readonly ordinal?: number;
    readonly quantity?: bigint;
    readonly notionalMinor?: bigint;
  } = {},
): Promise<void> {
  const symbol = overrides.symbol ?? "114800";
  const quantity = overrides.quantity ?? 2n;
  await client.query(
    `INSERT INTO public."rebalance_plan_order" (
       "plan_id", "candidate_id", "phase", "ordinal", "asset_class_id",
       "instrument_key", "market_country", "currency", "symbol", "side",
       "order_type", "time_in_force", "quantity", "limit_price_minor",
       "notional_minor", "unallocated_minor"
     ) VALUES ($1, $2, 'BUY', $3, 'SAFE', $4, 'KR', 'KRW', $5, 'BUY',
       'LIMIT', 'DAY', $6, 10000, $7, 0)`,
    [
      planId,
      overrides.candidateId ?? "SAFE:KR:114800:BUY",
      overrides.ordinal ?? 0,
      `KR:${symbol}`,
      symbol,
      quantity.toString(),
      (overrides.notionalMinor ?? quantity * 10_000n).toString(),
    ],
  );
}

async function integrationClient(): Promise<PoolClient> {
  if (!pool) throw new Error("integration pool was not initialized");
  return pool.connect();
}

async function expectRejectedSql(
  client: PoolClient,
  action: () => Promise<unknown>,
  allowedSqlStates: readonly string[] = ["23514", "P0001", "55000"],
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
  if (!caught) throw new Error("expected PostgreSQL to reject the statement");
  expect(allowedSqlStates).toContain(sqlState(caught));
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function randomHex64(): string {
  return randomUUID().replaceAll("-", "").repeat(2);
}

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(^|[_-])(test|testing)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target a database whose name contains test",
    );
  }
}
