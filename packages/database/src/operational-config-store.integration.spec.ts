import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationName = "20260716168000_operational_config_store";

const EXECUTION_RISK_CHECK_CODES = [
  "EXECUTION_MODE_MATCHED",
  "KILL_SWITCH_RELEASED",
  "PLAN_MODE_MATCHED",
  "MINIMUM_ORDER_GROSS_OK",
  "PLAN_IDENTITY_CURRENT",
  "NO_UNRESOLVED_ORDERS",
  "TRADE_LIMITS_OK",
  "EXPOSURE_LIMITS_OK",
  "LIVE_EXPLICITLY_ENABLED",
  "LIVE_ACCOUNT_ALLOWLISTED",
  "LIVE_ORDER_SHAPE_ALLOWED",
  "LIVE_TRADE_LIMITS_OK",
  "TINY_LIVE_GROSS_LIMIT_OK",
  "LIVE_MANUAL_APPROVAL_VALID",
] as const;

let pool: Pool | undefined;

integrationDescribe("operational config store PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) return;
    assertIsolatedTestDatabase(integrationDatabaseUrl);
    pool = new Pool({ connectionString: integrationDatabaseUrl, max: 2 });
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

  it("canonical hash/payload와 PAPER/LIVE 교차 불변식을 강제한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const account = await insertAccountAndConfig(client);
      const paperDisabled = operationalPayload({
        mode: "PAPER",
        enabled: false,
        killSwitch: true,
        accountAllowlistHmacs: [],
      });
      await insertConfigVersion(client, account.configId, 1, paperDisabled);

      const paperLiveReady = operationalPayload({
        mode: "PAPER",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
        approvalTtlSeconds: 301,
      });
      await insertConfigVersion(client, account.configId, 2, paperLiveReady);

      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "PAPER",
            enabled: true,
            killSwitch: true,
            accountAllowlistHmacs: [account.accountHmac],
          }),
        ),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "PAPER",
            enabled: false,
            killSwitch: true,
            accountAllowlistHmacs: ["not-a-sha256-hmac"],
          }),
        ),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "PAPER",
            enabled: false,
            killSwitch: true,
            accountAllowlistHmacs: [account.accountHmac, account.accountHmac],
          }),
        ),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "PAPER",
            enabled: true,
            killSwitch: false,
            accountAllowlistHmacs: [],
          }),
        ),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "LIVE",
            enabled: false,
            killSwitch: false,
            accountAllowlistHmacs: [account.accountHmac],
          }),
        ),
      );

      const live = operationalPayload({
        mode: "LIVE",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
        approvalTtlSeconds: 302,
      });
      await expectRejectedSql(client, () =>
        insertConfigVersion(client, account.configId, 3, live, {
          contentHash: "f".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(client, account.configId, 3, live, {
          storedPayload: operationalPayload({
            mode: "LIVE",
            enabled: true,
            killSwitch: false,
            accountAllowlistHmacs: [account.accountHmac],
            approvalTtlSeconds: 303,
          }),
        }),
      );
      await insertConfigVersion(client, account.configId, 3, live);

      const versions = await client.query<{
        version: number;
        content_matches: boolean;
        hash_matches: boolean;
      }>(
        `SELECT "version",
           "payload" = "canonical_content"::JSONB AS content_matches,
           "content_hash" = pg_catalog.encode(
             pg_catalog.sha256(pg_catalog.convert_to("canonical_content", 'UTF8')),
             'hex'
           ) AS hash_matches
         FROM public."operational_config_version"
         WHERE "config_id" = $1
         ORDER BY "version"`,
        [account.configId],
      );
      expect(versions.rows).toEqual([
        { version: 1, content_matches: true, hash_matches: true },
        { version: 2, content_matches: true, hash_matches: true },
        { version: 3, content_matches: true, hash_matches: true },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("version/activation을 연속 증가시키고 최신 version만 현재 설정으로 활성화한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const account = await insertAccountAndConfig(client);
      const version1 = await insertConfigVersion(
        client,
        account.configId,
        1,
        operationalPayload({
          mode: "PAPER",
          enabled: false,
          killSwitch: true,
          accountAllowlistHmacs: [],
        }),
      );
      await expectRejectedSql(client, () =>
        insertConfigVersion(
          client,
          account.configId,
          3,
          operationalPayload({
            mode: "PAPER",
            enabled: false,
            killSwitch: true,
            accountAllowlistHmacs: [],
            approvalTtlSeconds: 303,
          }),
        ),
      );
      const version2 = await insertConfigVersion(
        client,
        account.configId,
        2,
        operationalPayload({
          mode: "PAPER",
          enabled: false,
          killSwitch: true,
          accountAllowlistHmacs: [],
          approvalTtlSeconds: 302,
        }),
      );

      await expectRejectedSql(client, () =>
        insertActivation(client, account.configId, 1, version1.id),
      );
      await insertActivation(client, account.configId, 1, version2.id);

      expect(
        await client.query(
          `SELECT "operational_config_version_id", "config_version", "activation_version"
           FROM public."operational_config_current"
           WHERE "account_id" = $1`,
          [account.accountId],
        ),
      ).toMatchObject({
        rows: [
          {
            operational_config_version_id: version2.id,
            config_version: 2,
            activation_version: 1,
          },
        ],
      });

      const version3 = await insertConfigVersion(
        client,
        account.configId,
        3,
        operationalPayload({
          mode: "PAPER",
          enabled: false,
          killSwitch: true,
          accountAllowlistHmacs: [],
          approvalTtlSeconds: 303,
        }),
      );
      await expectRejectedSql(client, () =>
        insertActivation(client, account.configId, 3, version3.id),
      );
      await insertActivation(client, account.configId, 2, version3.id);

      expect(
        await client.query(
          `SELECT "operational_config_version_id", "config_version", "activation_version"
           FROM public."operational_config_current"
           WHERE "account_id" = $1`,
          [account.accountId],
        ),
      ).toMatchObject({
        rows: [
          {
            operational_config_version_id: version3.id,
            config_version: 3,
            activation_version: 2,
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("version/activation 원장의 UPDATE, DELETE, TRUNCATE를 ALWAYS trigger로 거부한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const account = await insertAccountAndConfig(client);
      const version = await insertConfigVersion(
        client,
        account.configId,
        1,
        operationalPayload({
          mode: "PAPER",
          enabled: false,
          killSwitch: true,
          accountAllowlistHmacs: [],
        }),
      );
      const activationId = await insertActivation(client, account.configId, 1, version.id);

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."operational_config"
           SET "created_at" = "created_at" + INTERVAL '1 second'
           WHERE "id" = $1`,
          [account.configId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."operational_config_version"
           SET "schema_version" = 'tampered'
           WHERE "id" = $1`,
          [version.id],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."operational_config_activation"
           SET "actor" = 'tampered'
           WHERE "id" = $1`,
          [activationId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."operational_config_activation" WHERE "id" = $1`, [
          activationId,
        ]),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."operational_config_version" WHERE "id" = $1`, [
          version.id,
        ]),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."operational_config" WHERE "id" = $1`, [account.configId]),
      );

      await client.query("SET LOCAL session_replication_role = replica");
      for (const table of [
        "operational_config_activation",
        "operational_config_version",
        "operational_config",
      ]) {
        await expectRejectedSql(client, () => client.query(`TRUNCATE public."${table}" CASCADE`));
      }
      await client.query("SET LOCAL session_replication_role = origin");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("REVOKED는 현재 설정에, GRANTED는 현재 ACTIVE LIVE 정책에 고정한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const account = await insertAccountAndConfig(client);
      const paper1 = operationalPayload({
        mode: "PAPER",
        enabled: false,
        killSwitch: true,
        accountAllowlistHmacs: [],
      });
      const version1 = await insertConfigVersion(client, account.configId, 1, paper1);
      await insertActivation(client, account.configId, 1, version1.id);
      await insertPromotion(client, account, version1, 1, "REVOKED");
      await expectRejectedSql(client, () =>
        insertPromotion(client, account, version1, 2, "GRANTED"),
      );

      const live2 = operationalPayload({
        mode: "LIVE",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
        approvalTtlSeconds: 302,
      });
      const version2 = await insertConfigVersion(client, account.configId, 2, live2);
      await insertActivation(client, account.configId, 2, version2.id);
      await expectRejectedSql(client, () =>
        insertPromotion(client, account, version2, 2, "GRANTED", {
          operationalConfigSha256: "f".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertPromotion(client, account, version2, 2, "GRANTED", {
          accountAllowlistHmac: "e".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertPromotion(client, account, version2, 2, "GRANTED", {
          maxSingleOrderGrossMinor: 99_999n,
        }),
      );
      await insertPromotion(client, account, version2, 2, "GRANTED");

      const live3 = operationalPayload({
        mode: "LIVE",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
        approvalTtlSeconds: 303,
      });
      const version3 = await insertConfigVersion(client, account.configId, 3, live3);
      await insertActivation(client, account.configId, 3, version3.id);

      await expectRejectedSql(client, () =>
        insertPromotion(client, account, version2, 3, "REVOKED"),
      );
      const revoked = await insertPromotion(client, account, version3, 3, "REVOKED");
      expect(
        await client.query(
          `SELECT "operational_config_version_id", "operational_config_sha256"
           FROM public."live_promotion_event"
           WHERE "id" = $1`,
          [revoked],
        ),
      ).toMatchObject({
        rows: [
          {
            operational_config_version_id: version3.id,
            operational_config_sha256: version3.contentHash,
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("execution risk evidence를 승격과 동일한 현재 ACTIVE config canonical에 고정한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const account = await insertAccountAndConfig(client);
      const plan = await insertLivePlan(client, account);
      const live1 = operationalPayload({
        mode: "LIVE",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
      });
      const version1 = await insertConfigVersion(client, account.configId, 1, live1);
      await insertActivation(client, account.configId, 1, version1.id);
      await insertPromotion(client, account, version1, 1, "REVOKED");
      const granted1 = await insertPromotion(client, account, version1, 2, "GRANTED");
      const risk1 = await insertExecutionRisk(client, plan, account, version1, granted1);

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."execution_risk_evidence"
           SET "account_allowlist_hmac" = $2
           WHERE "id" = $1`,
          [risk1, "f".repeat(64)],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."execution_risk_evidence" WHERE "id" = $1`, [risk1]),
      );

      const live2 = operationalPayload({
        mode: "LIVE",
        enabled: true,
        killSwitch: false,
        accountAllowlistHmacs: [account.accountHmac],
        approvalTtlSeconds: 302,
      });
      const version2 = await insertConfigVersion(client, account.configId, 2, live2);
      await insertActivation(client, account.configId, 2, version2.id);
      await expectRejectedSql(client, () =>
        insertExecutionRisk(client, plan, account, version1, granted1),
      );

      await insertPromotion(client, account, version2, 3, "REVOKED");
      const granted2 = await insertPromotion(client, account, version2, 4, "GRANTED");
      await expectRejectedSql(client, () =>
        insertExecutionRisk(client, plan, account, version2, granted2, {
          operationalConfigCanonical: version1.canonicalContent,
        }),
      );
      const risk2 = await insertExecutionRisk(client, plan, account, version2, granted2);

      expect(
        await client.query(
          `SELECT "promotion_event_id", "operational_config_version_id",
             "operational_config_canonical", "operational_config_sha256"
           FROM public."execution_risk_evidence"
           WHERE "id" = $1`,
          [risk2],
        ),
      ).toMatchObject({
        rows: [
          {
            promotion_event_id: granted2,
            operational_config_version_id: version2.id,
            operational_config_canonical: version2.canonicalContent,
            operational_config_sha256: version2.contentHash,
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

interface AccountConfigFixture {
  readonly accountId: string;
  readonly accountHmac: string;
  readonly configId: string;
}

interface StoredConfigVersion {
  readonly id: string;
  readonly canonicalContent: string;
  readonly contentHash: string;
  readonly payload: ReturnType<typeof operationalPayload>;
}

interface LivePlanFixture {
  readonly planId: string;
  readonly accountId: string;
}

async function insertAccountAndConfig(client: PoolClient): Promise<AccountConfigFixture> {
  const accountId = randomUUID();
  const accountHmac = randomHex64();
  const configId = randomUUID();
  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-operational', 'SYNTHETIC', statement_timestamp())`,
    [accountId, accountHmac],
  );
  await client.query(
    `INSERT INTO public."operational_config" ("id", "account_id")
     VALUES ($1, $2)`,
    [configId, accountId],
  );
  return { accountId, accountHmac, configId };
}

function operationalPayload(options: {
  readonly mode: "PAPER" | "LIVE";
  readonly enabled: boolean;
  readonly killSwitch: boolean;
  readonly accountAllowlistHmacs: readonly string[];
  readonly manualApprovalRequired?: boolean;
  readonly approvalTtlSeconds?: number;
}) {
  return {
    schemaVersion: "OPERATIONAL_CONFIG_V1",
    mode: options.mode,
    killSwitch: options.killSwitch,
    freshness: {
      quote: {
        planMaxAgeSeconds: 30,
        preSubmitMaxAgeSeconds: 5,
        futureToleranceSeconds: 2,
      },
      calendar: {
        maxAgeSeconds: 86_400,
        futureToleranceSeconds: 2,
      },
    },
    limits: {
      minimumOrderGrossMinor: "10000",
      feeBufferMinor: "5000",
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "500000",
      maxDailyTurnoverBasisPoints: 500,
      maxAbsolutePriceChangeBasisPoints: 100,
      maxInstrumentWeightBasisPoints: 3000,
      maxAssetClassWeightBasisPoints: 7000,
      maxRiskyWeightBasisPoints: 8000,
    },
    live: {
      enabled: options.enabled,
      marketCountry: "KR",
      allowedSession: "REGULAR_MARKET",
      orderType: "LIMIT",
      timeInForce: "DAY",
      accountAllowlistHmacs: [...options.accountAllowlistHmacs],
      manualApprovalRequired: options.manualApprovalRequired ?? true,
      approvalTtlSeconds: options.approvalTtlSeconds ?? 300,
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      tinyLiveMaxGrossMinor: "50000",
    },
  };
}

async function insertConfigVersion(
  client: PoolClient,
  configId: string,
  version: number,
  canonicalPayload: ReturnType<typeof operationalPayload>,
  overrides: {
    readonly contentHash?: string;
    readonly storedPayload?: ReturnType<typeof operationalPayload>;
  } = {},
): Promise<StoredConfigVersion> {
  const id = randomUUID();
  const canonicalContent = JSON.stringify(canonicalPayload);
  const contentHash = overrides.contentHash ?? sha256Hex(canonicalContent);
  await client.query(
    `INSERT INTO public."operational_config_version" (
       "id", "config_id", "version", "schema_version", "canonical_content",
       "content_hash", "payload"
     ) VALUES ($1, $2, $3, 'OPERATIONAL_CONFIG_V1', $4, $5, $6::JSONB)`,
    [
      id,
      configId,
      version,
      canonicalContent,
      contentHash,
      JSON.stringify(overrides.storedPayload ?? canonicalPayload),
    ],
  );
  return { id, canonicalContent, contentHash, payload: canonicalPayload };
}

async function insertActivation(
  client: PoolClient,
  configId: string,
  version: number,
  operationalConfigVersionId: string,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."operational_config_activation" (
       "id", "config_id", "version", "operational_config_version_id",
       "actor", "confirmation_version"
     ) VALUES ($1, $2, $3, $4, 'integration-operator',
       'OPERATIONAL_CONFIG_ACTIVATION_V1')`,
    [id, configId, version, operationalConfigVersionId],
  );
  return id;
}

async function insertPromotion(
  client: PoolClient,
  account: AccountConfigFixture,
  config: StoredConfigVersion,
  version: number,
  state: "REVOKED" | "GRANTED",
  overrides: {
    readonly operationalConfigVersionId?: string;
    readonly operationalConfigSha256?: string;
    readonly accountAllowlistHmac?: string;
    readonly maxSingleOrderGrossMinor?: bigint;
  } = {},
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."live_promotion_event" (
       "id", "account_id", "version", "state", "operational_config_sha256",
       "operational_config_version_id", "account_allowlist_hmac",
       "max_single_order_gross_minor", "max_daily_gross_minor",
       "tiny_live_max_gross_minor", "actor", "reason"
     ) VALUES ($1, $2, $3, $4::public."LivePromotionState", $5, $6, $7, $8, $9, $10,
       'integration-operator', 'integration operational config binding')`,
    [
      id,
      account.accountId,
      version,
      state,
      overrides.operationalConfigSha256 ?? config.contentHash,
      overrides.operationalConfigVersionId ?? config.id,
      overrides.accountAllowlistHmac ?? account.accountHmac,
      (
        overrides.maxSingleOrderGrossMinor ?? BigInt(config.payload.live.maxSingleOrderGrossMinor)
      ).toString(),
      config.payload.live.maxDailyGrossMinor,
      config.payload.live.tinyLiveMaxGrossMinor,
    ],
  );
  return id;
}

async function insertLivePlan(
  client: PoolClient,
  account: AccountConfigFixture,
): Promise<LivePlanFixture> {
  const targetConfigId = randomUUID();
  const targetVersionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const runId = randomUUID();
  const planId = randomUUID();
  const snapshotDigest = randomHex64();
  const targetHash = randomHex64();
  const planCanonical = JSON.stringify({ mode: "LIVE", planId });
  const planHash = sha256Hex(planCanonical);
  const now = Date.now();

  await client.query(
    `INSERT INTO public."target_config" ("id", "account_id")
     VALUES ($1, $2)`,
    [targetConfigId, account.accountId],
  );
  await client.query(
    `INSERT INTO public."target_config_version" (
       "id", "config_id", "version", "status", "content_hash", "app_version",
       "source", "cash_policy"
     ) VALUES ($1, $2, 1, 'ACTIVE', $3, 'integration-test', '{}'::JSONB,
       '{"mode":"EXCLUDED","version":"CASH_V1"}'::JSONB)`,
    [targetVersionId, targetConfigId, targetHash],
  );
  await client.query(
    `INSERT INTO public."collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
    [collectionRunId, account.accountId, new Date(now - 50_000)],
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
      account.accountId,
      targetVersionId,
      new Date(now - 40_000),
      snapshotDigest,
    ],
  );
  await client.query(
    `INSERT INTO public."rebalance_run" (
       "id", "account_id", "snapshot_id", "snapshot_digest",
       "target_config_version_id", "target_config_content_hash", "mode", "status",
       "dedupe_key", "started_at", "app_version", "policy_version"
     ) VALUES ($1, $2, $3, $4, $5, $6, 'LIVE', 'RUNNING', $7, $8,
       'integration-test', 'SHADOW_PLAN_V1')`,
    [
      runId,
      account.accountId,
      snapshotId,
      snapshotDigest,
      targetVersionId,
      targetHash,
      randomHex64(),
      new Date(now - 30_000),
    ],
  );
  await client.query(
    `INSERT INTO public."rebalance_plan" (
       "id", "run_id", "snapshot_id", "target_config_version_id", "mode", "status",
       "canonical_version", "plan_hash", "return_policy", "total_value_minor",
       "reason_codes", "canonical_content", "asset_decisions", "deferred_buy_needs",
       "projected_allocations"
     ) VALUES ($1, $2, $3, $4, 'LIVE', 'PLANNED', 'SHADOW_PLAN_V1', $5,
       'BAND_EDGE', 100000, '["BUY_PHASE_READY"]'::JSONB, $6,
       '[]'::JSONB, '[]'::JSONB, '[]'::JSONB)`,
    [planId, runId, snapshotId, targetVersionId, planHash, planCanonical],
  );
  return { planId, accountId: account.accountId };
}

async function insertExecutionRisk(
  client: PoolClient,
  plan: LivePlanFixture,
  account: AccountConfigFixture,
  config: StoredConfigVersion,
  promotionEventId: string,
  overrides: {
    readonly operationalConfigVersionId?: string;
    readonly operationalConfigCanonical?: string;
    readonly operationalConfigSha256?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const evaluatedAt = new Date(Date.now() - 100);
  const expiresAt = new Date(evaluatedAt.getTime() + 20_000);
  await client.query(
    `INSERT INTO public."execution_risk_evidence" (
       "id", "plan_id", "plan_version", "account_id", "promotion_event_id",
       "operational_config_canonical", "operational_config_sha256",
       "operational_config_version_id", "account_allowlist_hmac",
       "checks", "evaluated_at", "expires_at"
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11)`,
    [
      id,
      plan.planId,
      plan.accountId,
      promotionEventId,
      overrides.operationalConfigCanonical ?? config.canonicalContent,
      overrides.operationalConfigSha256 ?? config.contentHash,
      overrides.operationalConfigVersionId ?? config.id,
      account.accountHmac,
      JSON.stringify(
        EXECUTION_RISK_CHECK_CODES.map((code) => ({
          code,
          outcome: "PASSED",
        })),
      ),
      evaluatedAt,
      expiresAt,
    ],
  );
  return id;
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

async function integrationClient(): Promise<PoolClient> {
  if (!pool) throw new Error("integration pool was not initialized");
  return pool.connect();
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
