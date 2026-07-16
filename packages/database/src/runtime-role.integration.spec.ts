import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertRestrictedRuntimeDatabaseRole,
  type RuntimeDatabaseRoleInspectableClient,
} from "./client";

const execFileAsync = promisify(execFile);
const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;

let ownerPool: Pool | undefined;
let runtimePool: Pool | undefined;
let runtimeRole = "";

integrationDescribe("restricted PostgreSQL runtime role", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) return;
    assertIsolatedTestDatabase(integrationDatabaseUrl);
    runtimeRole = `portfolio_runtime_test_${process.pid}_${randomBytes(4).toString("hex")}`;
    const runtimePassword = randomBytes(24).toString("base64url");
    const runtimeUrl = new URL(integrationDatabaseUrl);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = runtimePassword;

    await execFileAsync(
      process.execPath,
      [resolve(__dirname, "../scripts/bootstrap-runtime-role.cjs")],
      {
        cwd: resolve(__dirname, ".."),
        env: {
          ...process.env,
          DATABASE_URL: integrationDatabaseUrl,
          DATABASE_RUNTIME_URL: runtimeUrl.toString(),
          DATABASE_RUNTIME_ROLE: runtimeRole,
        },
      },
    );
    ownerPool = new Pool({ connectionString: integrationDatabaseUrl, max: 2 });
    runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 2 });
  });

  afterAll(async () => {
    await runtimePool?.end();
    if (ownerPool && runtimeRole) {
      await ownerPool.query(
        `SELECT pg_catalog.pg_terminate_backend(activity."pid")
         FROM pg_catalog.pg_stat_activity AS activity
         WHERE activity."usename" = $1
           AND activity."pid" <> pg_catalog.pg_backend_pid()`,
        [runtimeRole],
      );
      const memberships = await ownerPool.query<{ role_name: string }>(
        `SELECT parent."rolname" AS "role_name"
         FROM pg_catalog.pg_auth_members AS membership
         JOIN pg_catalog.pg_roles AS child
           ON child."oid" = membership."member"
         JOIN pg_catalog.pg_roles AS parent
           ON parent."oid" = membership."roleid"
         WHERE child."rolname" = $1`,
        [runtimeRole],
      );
      for (const membership of memberships.rows) {
        await ownerPool.query(
          `REVOKE ${quoteIdentifier(membership.role_name)} FROM ${quoteIdentifier(runtimeRole)}`,
        );
      }
      await ownerPool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(runtimeRole)}`);
    }
    await ownerPool?.end();
  });

  it("migration owner가 아닌 제한 LOGIN 역할로 연결한다", async () => {
    const result = await runtimePool!.query<{
      current_user: string;
      session_user: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
      can_create: boolean;
      can_temp: boolean;
      can_truncate: boolean;
    }>(
      `SELECT
         CURRENT_USER,
         SESSION_USER,
         role."rolsuper",
         role."rolcreatedb",
         role."rolcreaterole",
         role."rolreplication",
         role."rolbypassrls",
         pg_catalog.has_schema_privilege(CURRENT_USER, 'public', 'CREATE')
           AS "can_create",
         pg_catalog.has_database_privilege(
           CURRENT_USER,
           pg_catalog.current_database(),
           'TEMPORARY'
         ) AS "can_temp",
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_class AS object
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace."oid" = object."relnamespace"
           WHERE namespace."nspname" = 'public'
             AND object."relkind" IN ('r', 'p')
             AND pg_catalog.has_table_privilege(
               CURRENT_USER,
               object."oid",
               'TRUNCATE'
             )
         ) AS "can_truncate"
       FROM pg_catalog.pg_roles AS role
       WHERE role."rolname" = CURRENT_USER`,
    );
    expect(result.rows).toEqual([
      {
        current_user: runtimeRole,
        session_user: runtimeRole,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        can_create: false,
        can_temp: false,
        can_truncate: false,
      },
    ]);
    await expect(
      assertRestrictedRuntimeDatabaseRole(inspectablePool(runtimePool!)),
    ).resolves.toBeUndefined();
    await expect(assertRestrictedRuntimeDatabaseRole(inspectablePool(ownerPool!))).rejects.toThrow(
      "DATABASE_RUNTIME_ROLE_UNSAFE",
    );
  });

  it("정상 append-only 수집과 lease·terminal update 경로는 동작한다", async () => {
    const client = await runtimePool!.connect();
    await client.query("BEGIN");
    try {
      const fixture = await insertRunningCollection(client);
      await client.query(
        `INSERT INTO public."raw_broker_response" (
           "id", "collection_run_id", "operation_id", "ordinal", "http_status",
           "received_at", "redacted_body", "body_sha256", "redaction_version"
         ) VALUES ($1, $2, 'getAccounts', 0, 200, $3, $4::jsonb, $5, 'v1')`,
        [
          randomUUID(),
          fixture.runId,
          fixture.receivedAt,
          JSON.stringify({ result: [] }),
          sha256Hex(JSON.stringify({ result: [] })),
        ],
      );
      await client.query(
        `INSERT INTO public."runtime_lease" (
           "key", "owner", "acquired_at", "expires_at", "fencing_token"
         ) VALUES ('runtime-role-integration', $1, CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP + INTERVAL '2 minutes', 1)
         ON CONFLICT ("key") DO UPDATE
         SET "owner" = EXCLUDED."owner",
             "expires_at" = EXCLUDED."expires_at",
             "fencing_token" = public."runtime_lease"."fencing_token" + 1`,
        [randomUUID()],
      );
      await client.query(
        `UPDATE public."runtime_lease"
         SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '3 minutes'
         WHERE "key" = 'runtime-role-integration'`,
      );
      await client.query(
        `DELETE FROM public."runtime_lease" WHERE "key" = 'runtime-role-integration'`,
      );
      await client.query(
        `UPDATE public."collection_run"
         SET "status" = 'FAILED',
             "completed_at" = $2,
             "error_code" = 'SYNTHETIC_RUNTIME_ROLE_TEST'
         WHERE "id" = $1`,
        [fixture.runId, new Date(fixture.receivedAt.getTime() + 1_000)],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("감사 row UPDATE/DELETE/TRUNCATE와 trigger 비활성화를 권한에서 차단한다", async () => {
    const client = await runtimePool!.connect();
    await client.query("BEGIN");
    try {
      const fixture = await insertRunningCollection(client);
      const responseId = randomUUID();
      const body = JSON.stringify({ result: [] });
      await client.query(
        `INSERT INTO public."raw_broker_response" (
           "id", "collection_run_id", "operation_id", "ordinal", "http_status",
           "received_at", "redacted_body", "body_sha256", "redaction_version"
         ) VALUES ($1, $2, 'getAccounts', 0, 200, $3, $4::jsonb, $5, 'v1')`,
        [responseId, fixture.runId, fixture.receivedAt, body, sha256Hex(body)],
      );

      await expectSqlState(
        client,
        `UPDATE public."raw_broker_response"
        SET "request_id" = 'tampered' WHERE "id" = '${responseId}'`,
        "42501",
      );
      await expectSqlState(
        client,
        `DELETE FROM public."raw_broker_response" WHERE "id" = '${responseId}'`,
        "42501",
      );
      await expectSqlState(client, `TRUNCATE public."raw_broker_response"`, "42501");
      await expectSqlState(
        client,
        `ALTER TABLE public."raw_broker_response" DISABLE TRIGGER ALL`,
        "42501",
      );
      await expectSqlState(
        client,
        `DROP TRIGGER raw_broker_response_immutable
         ON public."raw_broker_response"`,
        "42501",
      );
      await expectSqlState(client, `SET LOCAL session_replication_role = replica`, "42501");
      await expectSqlState(client, `SELECT 1 FROM public."_prisma_migrations" LIMIT 1`, "42501");
      await expectSqlState(client, `SELECT public.reject_immutable_change()`, "42501");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("행 잠금용 UPDATE grant가 있어도 append-only trigger를 우회하지 못한다", async () => {
    const client = await runtimePool!.connect();
    await client.query("BEGIN");
    try {
      const fixture = await insertRunningCollection(client);
      const configId = randomUUID();
      await client.query(
        `INSERT INTO public."operational_config" ("id", "account_id")
         VALUES ($1, $2)`,
        [configId, fixture.accountId],
      );
      await expectSqlState(
        client,
        `UPDATE public."operational_config"
         SET "id" = '${randomUUID()}'
         WHERE "id" = '${configId}'`,
        "23514",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("broker account는 refresh 열만 갱신하고 stable identity 열은 권한과 trigger로 이중 차단한다", async () => {
    const runtimeClient = await runtimePool!.connect();
    await runtimeClient.query("BEGIN");
    try {
      const fixture = await insertRunningCollection(runtimeClient);
      await runtimeClient.query(
        `UPDATE public."broker_account"
         SET "masked_number" = '***-refreshed',
             "account_type_raw" = 'SYNTHETIC_REFRESHED',
             "last_seen_at" = "last_seen_at" + INTERVAL '1 second'
         WHERE "id" = $1`,
        [fixture.accountId],
      );
      await expectSqlState(
        runtimeClient,
        `UPDATE public."broker_account"
         SET "external_ref_hmac" = '${randomBytes(32).toString("hex")}'
         WHERE "id" = '${fixture.accountId}'`,
        "42501",
      );
      await expectSqlState(
        runtimeClient,
        `UPDATE public."broker_account"
         SET "broker" = 'OTHER'
         WHERE "id" = '${fixture.accountId}'`,
        "42501",
      );
      await expectSqlState(
        runtimeClient,
        `UPDATE public."broker_account"
         SET "first_seen_at" = "first_seen_at" + INTERVAL '1 second'
         WHERE "id" = '${fixture.accountId}'`,
        "42501",
      );
    } finally {
      await runtimeClient.query("ROLLBACK");
      runtimeClient.release();
    }

    const ownerClient = await ownerPool!.connect();
    await ownerClient.query("BEGIN");
    try {
      const fixture = await insertRunningCollection(ownerClient);
      await expectSqlState(
        ownerClient,
        `UPDATE public."broker_account"
         SET "external_ref_hmac" = '${randomBytes(32).toString("hex")}'
         WHERE "id" = '${fixture.accountId}'`,
        "23514",
      );
    } finally {
      await ownerClient.query("ROLLBACK");
      ownerClient.release();
    }
  });

  it("명시적으로 허용한 순수 validation 함수만 직접 실행할 수 있다", async () => {
    const result = await runtimePool!.query<{ client_order_id: string }>(
      `SELECT public.expected_toss_client_order_id('runtime-role-test')
         AS "client_order_id"`,
    );
    expect(result.rows[0]?.client_order_id).toMatch(/^pr1_[A-Za-z0-9_-]{32}$/);
  });
});

async function insertRunningCollection(client: PoolClient): Promise<{
  readonly accountId: string;
  readonly runId: string;
  readonly receivedAt: Date;
}> {
  const accountId = randomUUID();
  const runId = randomUUID();
  const receivedAt = new Date();
  const accountHmac = randomBytes(32).toString("hex");
  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw",
       "first_seen_at", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-runtime-role', 'SYNTHETIC', $3, $3)
     ON CONFLICT ("broker", "external_ref_hmac") DO UPDATE
     SET "last_seen_at" = EXCLUDED."last_seen_at"`,
    [accountId, accountHmac, new Date(receivedAt.getTime() - 1_000)],
  );
  await client.query(
    `INSERT INTO public."collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'runtime-role-test', 'runtime-role-test')`,
    [runId, accountId, new Date(receivedAt.getTime() - 500)],
  );
  return { accountId, runId, receivedAt };
}

async function expectSqlState(
  client: PoolClient,
  statement: string,
  expectedState: string,
): Promise<void> {
  await client.query("SAVEPOINT expected_runtime_role_failure");
  let caught: unknown;
  try {
    await client.query(statement);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_runtime_role_failure");
  await client.query("RELEASE SAVEPOINT expected_runtime_role_failure");
  expect(sqlState(caught)).toBe(expectedState);
}

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function inspectablePool(pool: Pool): RuntimeDatabaseRoleInspectableClient {
  return {
    async $queryRawUnsafe<T>(query: string): Promise<T> {
      const result = await pool.query(query);
      return result.rows as T;
    },
  };
}

function assertIsolatedTestDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "").toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error("runtime role integration은 이름에 test가 포함된 격리 DB만 사용합니다.");
  }
}
