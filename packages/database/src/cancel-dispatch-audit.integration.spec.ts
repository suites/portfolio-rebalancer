import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationName = "20260716169000_cancel_dispatch_audit";

let pool: Pool | undefined;

integrationDescribe("cancel dispatch audit PostgreSQL integration", () => {
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

  it("secret-free 운영자 승인은 현재 LIVE PENDING/PARTIAL 주문과 30초 TTL만 허용한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const pending = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const pendingAuthorization = await insertCancelAuthorization(client, pending);
      const stored = await client.query<{
        canonical_content: string;
        ttl_milliseconds: string;
      }>(
        `SELECT "canonical_content",
           (EXTRACT(EPOCH FROM ("expires_at" - "authorized_at")) * 1000)::BIGINT
             AS ttl_milliseconds
         FROM public."cancel_operator_authorization"
         WHERE "id" = $1`,
        [pendingAuthorization.id],
      );
      expect(stored.rows[0]?.canonical_content).not.toContain(pending.brokerAccountReferenceHmac);
      expect(stored.rows[0]?.canonical_content).not.toContain(pending.rawBrokerAccountReference);
      expect(stored.rows[0]?.ttl_milliseconds).toBe("20000");

      const partial = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PARTIAL_FILLED",
      });
      await insertCancelAuthorization(client, partial);

      await expectRejectedSql(client, () =>
        insertCancelAuthorization(client, pending, {
          ttlMilliseconds: 30_001,
        }),
      );
      await expectRejectedSql(client, () =>
        insertCancelAuthorization(client, pending, {
          canonicalBrokerOrderId: "wrong-broker-order",
        }),
      );
      await expectRejectedSql(client, () =>
        insertCancelAuthorization(client, pending, {
          authorizationDigest: "f".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertCancelAuthorization(client, pending, {
          authorizedAt: new Date(Date.now() - 5_100),
          ttlMilliseconds: 20_000,
        }),
      );

      const filled = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "FILLED",
      });
      await expectRejectedSql(client, () => insertCancelAuthorization(client, filled));

      const paper = await insertCancelableOrder(client, {
        mode: "PAPER",
        state: "PENDING",
      });
      await expectRejectedSql(client, () => insertCancelAuthorization(client, paper));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("exact cancel claim이 승인을 한 번 소비하고 주문별 재-dispatch를 차단한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const order = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const authorization = await insertCancelAuthorization(client, order);

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."cancel_operator_authorization"
           SET "consumed_at" = statement_timestamp()
           WHERE "id" = $1`,
          [authorization.id],
        ),
      );
      await expectRejectedSql(client, () =>
        insertCancelClaim(client, order, authorization, {
          brokerOrderId: "wrong-broker-order",
        }),
      );
      await expectRejectedSql(client, () =>
        insertCancelClaim(client, order, authorization, {
          canonicalPlanVersion: 2,
        }),
      );

      const claim = await insertCancelClaim(client, order, authorization);
      expect(
        await client.query(
          `SELECT operator_auth."consumed_at" IS NOT NULL AS consumed,
             claim."order_id", claim."ledger_state"::TEXT,
             claim."broker_order_id", claim."authorized_request_digest"
           FROM public."cancel_operator_authorization" AS operator_auth
           JOIN public."order_cancel_dispatch_claim" AS claim
             ON claim."cancel_operator_authorization_id" = operator_auth."id"
           WHERE operator_auth."id" = $1`,
          [authorization.id],
        ),
      ).toMatchObject({
        rows: [
          {
            consumed: true,
            order_id: order.orderId,
            ledger_state: "PENDING",
            broker_order_id: order.brokerOrderId,
            authorized_request_digest: authorization.canonicalRequestDigest,
          },
        ],
      });

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."cancel_operator_authorization"
           SET "actor" = 'tampered'
           WHERE "id" = $1`,
          [authorization.id],
        ),
      );
      await expectRejectedSql(client, () =>
        insertCancelClaim(client, order, authorization, {
          id: randomUUID(),
        }),
      );

      const secondAuthorization = await insertCancelAuthorization(client, order);
      await expectRejectedSql(client, () => insertCancelClaim(client, order, secondAuthorization), [
        "23505",
      ]);
      expect(
        await client.query(
          `SELECT "consumed_at"
           FROM public."cancel_operator_authorization"
           WHERE "id" = $1`,
          [secondAuthorization.id],
        ),
      ).toMatchObject({ rows: [{ consumed_at: null }] });

      expect(claim.claimEnvelopeDigest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("accepted CANCEL action은 authorization, digest와 원 broker ID가 같은 claim만 참조한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const first = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const firstAuthorization = await insertCancelAuthorization(client, first);
      const firstClaim = await insertCancelClaim(client, first, firstAuthorization);

      const second = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const secondAuthorization = await insertCancelAuthorization(client, second);
      const secondClaim = await insertCancelClaim(client, second, secondAuthorization);

      await expectRejectedSql(client, () =>
        insertAcceptedCancelAction(client, first, firstClaim, {
          cancelDispatchClaimId: secondClaim.id,
        }),
      );
      await expectRejectedSql(client, () =>
        insertAcceptedCancelAction(client, first, firstClaim, {
          canonicalRequestDigest: "f".repeat(64),
        }),
      );
      const actionId = await insertAcceptedCancelAction(client, first, firstClaim);

      expect(
        await client.query(
          `SELECT action."cancel_dispatch_claim_id", action."authorization_id",
             action."canonical_request_digest"
           FROM public."broker_order_action" AS action
           WHERE action."id" = $1`,
          [actionId],
        ),
      ).toMatchObject({
        rows: [
          {
            cancel_dispatch_claim_id: firstClaim.id,
            authorization_id: firstClaim.authorizationId,
            canonical_request_digest: firstClaim.authorizedRequestDigest,
          },
        ],
      });

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."broker_order_action"
           SET "request_id" = 'tampered'
           WHERE "id" = $1`,
          [actionId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."broker_order_action" WHERE "id" = $1`, [actionId]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejected/ambiguous CANCEL evidence는 원 주문 broker ID와 exact claim을 보존한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const rejectedOrder = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const rejectedAuthorization = await insertCancelAuthorization(client, rejectedOrder);
      const rejectedClaim = await insertCancelClaim(client, rejectedOrder, rejectedAuthorization);

      const otherOrder = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const otherAuthorization = await insertCancelAuthorization(client, otherOrder);
      const otherClaim = await insertCancelClaim(client, otherOrder, otherAuthorization);

      await expectRejectedSql(client, () =>
        insertCancelAttemptEvidence(client, rejectedOrder, rejectedClaim, "REJECTED", {
          cancelDispatchClaimId: otherClaim.id,
        }),
      );
      await expectRejectedSql(client, () =>
        insertCancelAttemptEvidence(client, rejectedOrder, rejectedClaim, "REJECTED", {
          brokerOrderId: "wrong-broker-order",
        }),
      );
      const rejectedEvidenceId = await insertCancelAttemptEvidence(
        client,
        rejectedOrder,
        rejectedClaim,
        "REJECTED",
      );

      const ambiguousOrder = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PARTIAL_FILLED",
      });
      const ambiguousAuthorization = await insertCancelAuthorization(client, ambiguousOrder);
      const ambiguousClaim = await insertCancelClaim(
        client,
        ambiguousOrder,
        ambiguousAuthorization,
      );
      const ambiguousEvidenceId = await insertCancelAttemptEvidence(
        client,
        ambiguousOrder,
        ambiguousClaim,
        "AMBIGUOUS",
      );

      expect(
        await client.query(
          `SELECT "id", "cancel_dispatch_claim_id", "broker_order_id",
             "write_outcome", "validated_normalized_state"::TEXT
           FROM public."broker_order_response_evidence"
           WHERE "id" IN ($1, $2)
           ORDER BY "write_outcome"`,
          [rejectedEvidenceId, ambiguousEvidenceId],
        ),
      ).toMatchObject({
        rows: [
          {
            id: ambiguousEvidenceId,
            cancel_dispatch_claim_id: ambiguousClaim.id,
            broker_order_id: ambiguousOrder.brokerOrderId,
            write_outcome: "AMBIGUOUS",
            validated_normalized_state: "UNKNOWN",
          },
          {
            id: rejectedEvidenceId,
            cancel_dispatch_claim_id: rejectedClaim.id,
            broker_order_id: rejectedOrder.brokerOrderId,
            write_outcome: "REJECTED",
            validated_normalized_state: null,
          },
        ],
      });

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."broker_order_response_evidence"
           SET "safe_error_code" = 'tampered'
           WHERE "id" = $1`,
          [ambiguousEvidenceId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(
          `DELETE FROM public."broker_order_response_evidence"
           WHERE "id" = $1`,
          [rejectedEvidenceId],
        ),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("operator authorization과 cancel claim의 UPDATE/DELETE/TRUNCATE를 거부한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const order = await insertCancelableOrder(client, {
        mode: "LIVE",
        state: "PENDING",
      });
      const authorization = await insertCancelAuthorization(client, order);
      const claim = await insertCancelClaim(client, order, authorization);

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."order_cancel_dispatch_claim"
           SET "broker_order_id" = 'tampered'
           WHERE "id" = $1`,
          [claim.id],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."order_cancel_dispatch_claim" WHERE "id" = $1`, [
          claim.id,
        ]),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."cancel_operator_authorization" WHERE "id" = $1`, [
          authorization.id,
        ]),
      );

      await client.query("SET LOCAL session_replication_role = replica");
      await expectRejectedSql(client, () =>
        client.query(`TRUNCATE public."order_cancel_dispatch_claim" CASCADE`),
      );
      await expectRejectedSql(client, () =>
        client.query(`TRUNCATE public."cancel_operator_authorization" CASCADE`),
      );
      await client.query("SET LOCAL session_replication_role = origin");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

type ExecutionMode = "PAPER" | "LIVE";
type CancelableState = "PENDING" | "PARTIAL_FILLED" | "FILLED";

interface CancelableOrderFixture {
  readonly accountId: string;
  readonly brokerAccountReferenceHmac: string;
  readonly rawBrokerAccountReference: string;
  readonly runId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly clientOrderId: string;
  readonly intentSha256: string;
  readonly orderId: string;
  readonly brokerOrderId: string;
  readonly state: CancelableState;
}

interface CancelAuthorizationFixture {
  readonly id: string;
  readonly authorizationId: string;
  readonly canonicalRequestDigest: string;
  readonly authorizationDigest: string;
  readonly authorizedAt: Date;
  readonly expiresAt: Date;
}

interface CancelClaimFixture {
  readonly id: string;
  readonly authorizationId: string;
  readonly authorizedRequestDigest: string;
  readonly claimEnvelopeDigest: string;
}

async function insertCancelableOrder(
  client: PoolClient,
  input: {
    readonly mode: ExecutionMode;
    readonly state: CancelableState;
  },
): Promise<CancelableOrderFixture> {
  const accountId = randomUUID();
  const brokerAccountReferenceHmac = randomHex64();
  const rawBrokerAccountReference = `synthetic-secret-reference-${randomUUID()}`;
  const targetConfigId = randomUUID();
  const targetConfigVersionId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const runId = randomUUID();
  const planId = randomUUID();
  const planOrderId = randomUUID();
  const dailyLimitId = randomUUID();
  const logicalOrderId = randomUUID();
  const orderId = randomUUID();
  const brokerOrderId = `broker-order-${randomUUID()}`;
  const snapshotDigest = randomHex64();
  const targetHash = randomHex64();
  const planCanonical = JSON.stringify({
    mode: input.mode,
    state: input.state,
    fixture: planId,
  });
  const planHash = sha256Hex(planCanonical);
  const now = Date.now();

  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-cancel', 'SYNTHETIC', $3)`,
    [accountId, brokerAccountReferenceHmac, new Date(now - 60_000)],
  );
  await client.query(
    `INSERT INTO public."target_config" ("id", "account_id")
     VALUES ($1, $2)`,
    [targetConfigId, accountId],
  );
  await client.query(
    `INSERT INTO public."target_config_version" (
       "id", "config_id", "version", "status", "content_hash", "app_version",
       "source", "cash_policy"
     ) VALUES ($1, $2, 1, 'ACTIVE', $3, 'integration-test', '{}'::JSONB,
       '{"mode":"EXCLUDED","version":"CASH_V1"}'::JSONB)`,
    [targetConfigVersionId, targetConfigId, targetHash],
  );
  await client.query(
    `INSERT INTO public."collection_run" (
       "id", "account_id", "status", "started_at", "app_version", "adapter_version"
     ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
    [collectionRunId, accountId, new Date(now - 50_000)],
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
      new Date(now - 40_000),
      snapshotDigest,
    ],
  );
  await client.query(
    `INSERT INTO public."rebalance_run" (
       "id", "account_id", "snapshot_id", "snapshot_digest",
       "target_config_version_id", "target_config_content_hash", "mode", "status",
       "dedupe_key", "started_at", "app_version", "policy_version"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::public."RebalanceMode", 'RUNNING',
       $8, $9, 'integration-test', 'SHADOW_PLAN_V1')`,
    [
      runId,
      accountId,
      snapshotId,
      snapshotDigest,
      targetConfigVersionId,
      targetHash,
      input.mode,
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
     ) VALUES ($1, $2, $3, $4, $5::public."RebalanceMode", 'PLANNED',
       'SHADOW_PLAN_V1', $6, 'BAND_EDGE', 100000, '["BUY_PHASE_READY"]'::JSONB,
       $7, '[]'::JSONB, '[]'::JSONB, '[]'::JSONB)`,
    [planId, runId, snapshotId, targetConfigVersionId, input.mode, planHash, planCanonical],
  );
  await client.query(
    `INSERT INTO public."rebalance_plan_order" (
       "id", "plan_id", "candidate_id", "phase", "ordinal", "asset_class_id",
       "instrument_key", "market_country", "currency", "symbol", "side",
       "order_type", "time_in_force", "quantity", "limit_price_minor",
       "notional_minor", "unallocated_minor"
     ) VALUES ($1, $2, $3, 'BUY', 0, 'CORE', 'KR:005930', 'KR', 'KRW',
       '005930', 'BUY', 'LIMIT', 'DAY', 2, 10000, 20000, 0)`,
    [planOrderId, planId, `CORE:KR:005930:BUY:${planOrderId}`],
  );
  await client.query(
    `INSERT INTO public."daily_trade_limit" (
       "id", "account_id", "trade_day", "market_country", "currency", "mode",
       "gross_limit_minor"
     ) VALUES ($1, $2,
       (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::DATE,
       'KR', 'KRW', $3::public."RebalanceMode", 300000)`,
    [dailyLimitId, accountId, input.mode],
  );

  const canonicalIntent = JSON.stringify({
    version: "TOSS_CLIENT_ORDER_ID_V1",
    logicalOrderId,
    rebalanceRunId: runId,
    planId,
    planVersion: 1,
    planHash,
    phase: "BUY",
    marketCountry: "KR",
    symbol: "005930",
    side: "BUY",
    orderType: "LIMIT",
    timeInForce: "DAY",
    quantity: "2",
    price: "10000",
  });
  const clientOrderId = tossClientOrderId(canonicalIntent);
  await withTriggerDisabled(client, "order_ledger", "order_ledger_guard", async () => {
    await withTriggerDisabled(client, "order_ledger", "order_ledger_initialize", async () => {
      await client.query(
        `INSERT INTO public."order_ledger" (
             "id", "plan_id", "plan_order_id", "account_id", "daily_trade_limit_id",
             "mode", "logical_order_id", "client_order_id", "client_order_id_version",
             "canonical_intent", "intent_sha256", "plan_version", "phase",
             "market_country", "currency", "symbol", "side", "order_type",
             "time_in_force", "quantity", "limit_price_minor",
             "planned_gross_notional_minor", "reserved_gross_minor",
             "reservation_basis_price_minor", "reservation_policy_version"
           ) VALUES ($1, $2, $3, $4, $5, $6::public."RebalanceMode", $7, $8,
             'TOSS_CLIENT_ORDER_ID_V1', $9, $10, 1, 'BUY', 'KR', 'KRW', '005930',
             'BUY', 'LIMIT', 'DAY', 2, 10000, 20000, 20000, 10000,
             'ORDER_GROSS_RESERVATION_V1')`,
        [
          orderId,
          planId,
          planOrderId,
          accountId,
          dailyLimitId,
          input.mode,
          logicalOrderId,
          clientOrderId,
          canonicalIntent,
          sha256Hex(canonicalIntent),
        ],
      );
    });
  });

  await withTriggerDisabled(
    client,
    "order_state_history",
    "order_state_history_guard",
    async () => {
      const filledQuantity =
        input.state === "PARTIAL_FILLED" ? 1n : input.state === "FILLED" ? 2n : 0n;
      await client.query(
        `INSERT INTO public."order_state_history" (
           "order_id", "sequence", "normalized_state", "actor", "broker_status_raw",
           "broker_order_id", "filled_quantity", "filled_gross_notional_minor",
           "fee_minor", "detail"
         ) VALUES ($1, 0, $2::public."OrderLedgerState", 'RECONCILER', $2, $3,
           $4, $5, 0, '{"source":"cancel-test-fixture"}'::JSONB)`,
        [
          orderId,
          input.state,
          brokerOrderId,
          filledQuantity.toString(),
          (filledQuantity * 10_000n).toString(),
        ],
      );
    },
  );

  return {
    accountId,
    brokerAccountReferenceHmac,
    rawBrokerAccountReference,
    runId,
    planId,
    planVersion: 1,
    planHash,
    planOrderId,
    logicalOrderId,
    clientOrderId,
    intentSha256: sha256Hex(canonicalIntent),
    orderId,
    brokerOrderId,
    state: input.state,
  };
}

async function insertCancelAuthorization(
  client: PoolClient,
  order: CancelableOrderFixture,
  overrides: {
    readonly id?: string;
    readonly authorizationId?: string;
    readonly authorizedAt?: Date;
    readonly ttlMilliseconds?: number;
    readonly canonicalRequestDigest?: string;
    readonly canonicalBrokerOrderId?: string;
    readonly authorizationDigest?: string;
  } = {},
): Promise<CancelAuthorizationFixture> {
  const id = overrides.id ?? randomUUID();
  const authorizationId = overrides.authorizationId ?? `cancel-auth-${randomUUID()}`;
  const actor = "integration-operator";
  const authorizedAt = overrides.authorizedAt ?? new Date(Date.now() - 100);
  const expiresAt = new Date(authorizedAt.getTime() + (overrides.ttlMilliseconds ?? 20_000));
  const canonicalRequestDigest = overrides.canonicalRequestDigest ?? cancelRequestDigest(order);
  const canonicalContent = JSON.stringify({
    version: "CANCEL_OPERATOR_AUTHORIZATION_V1",
    authorizationId,
    actor,
    action: "CANCEL",
    orderIdentity: {
      planId: order.planId,
      planOrderId: order.planOrderId,
      logicalOrderId: order.logicalOrderId,
      accountId: order.accountId,
      clientOrderId: order.clientOrderId,
      brokerOrderId: overrides.canonicalBrokerOrderId ?? order.brokerOrderId,
    },
    canonicalRequestDigest,
    authorizedAt: authorizedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    evidenceReference: id,
  });
  const authorizationDigest = overrides.authorizationDigest ?? sha256Hex(canonicalContent);
  await client.query(
    `INSERT INTO public."cancel_operator_authorization" (
       "id", "order_id", "authorization_id", "actor", "action",
       "confirmation_version", "canonical_content", "canonical_request_digest",
       "authorization_digest", "authorized_at", "expires_at"
     ) VALUES ($1, $2, $3, $4, 'CANCEL', 'CANCEL_ORDER_CONFIRMATION_V1',
       $5, $6, $7, $8, $9)`,
    [
      id,
      order.orderId,
      authorizationId,
      actor,
      canonicalContent,
      canonicalRequestDigest,
      authorizationDigest,
      authorizedAt,
      expiresAt,
    ],
  );
  return {
    id,
    authorizationId,
    canonicalRequestDigest,
    authorizationDigest,
    authorizedAt,
    expiresAt,
  };
}

async function insertCancelClaim(
  client: PoolClient,
  order: CancelableOrderFixture,
  authorization: CancelAuthorizationFixture,
  overrides: {
    readonly id?: string;
    readonly brokerOrderId?: string;
    readonly canonicalPlanVersion?: number;
    readonly authorizedRequestDigest?: string;
  } = {},
): Promise<CancelClaimFixture> {
  const id = overrides.id ?? randomUUID();
  const brokerOrderId = overrides.brokerOrderId ?? order.brokerOrderId;
  const authorizedRequestDigest =
    overrides.authorizedRequestDigest ?? authorization.canonicalRequestDigest;
  const canonicalRequest = JSON.stringify({
    version: "ORDER_CANCEL_DISPATCH_CLAIM_V1",
    cancelDispatchClaimId: id,
    cancelOperatorAuthorizationId: authorization.id,
    authorizationId: authorization.authorizationId,
    planId: order.planId,
    planVersion: overrides.canonicalPlanVersion ?? order.planVersion,
    planOrderId: order.planOrderId,
    logicalOrderId: order.logicalOrderId,
    accountId: order.accountId,
    clientOrderId: order.clientOrderId,
    canonicalIntentSha256: order.intentSha256,
    authorizedRequestDigest,
    brokerAccountReferenceHmac: order.brokerAccountReferenceHmac,
    brokerOrderId,
    ledgerState: order.state,
    operatorAuthorizationDigest: authorization.authorizationDigest,
    authorizationIssuedAt: authorization.authorizedAt.toISOString(),
    authorizationExpiresAt: authorization.expiresAt.toISOString(),
  });
  const claimEnvelopeDigest = sha256Hex(canonicalRequest);
  await client.query(
    `INSERT INTO public."order_cancel_dispatch_claim" (
       "id", "cancel_operator_authorization_id", "order_id", "authorization_id",
       "plan_id", "plan_version", "plan_order_id", "logical_order_id",
       "canonical_request", "claim_envelope_digest", "authorized_request_digest",
       "client_order_id", "broker_account_reference_hmac", "broker_order_id",
       "ledger_state", "operator_authorization_digest", "authorization_issued_at",
       "authorization_expires_at", "intent_audited_at", "dispatch_started_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15::public."OrderLedgerState", $16, $17, $18, statement_timestamp(),
       statement_timestamp())`,
    [
      id,
      authorization.id,
      order.orderId,
      authorization.authorizationId,
      order.planId,
      order.planVersion,
      order.planOrderId,
      order.logicalOrderId,
      canonicalRequest,
      claimEnvelopeDigest,
      authorizedRequestDigest,
      order.clientOrderId,
      order.brokerAccountReferenceHmac,
      brokerOrderId,
      order.state,
      authorization.authorizationDigest,
      authorization.authorizedAt,
      authorization.expiresAt,
    ],
  );
  return {
    id,
    authorizationId: authorization.authorizationId,
    authorizedRequestDigest,
    claimEnvelopeDigest,
  };
}

async function insertAcceptedCancelAction(
  client: PoolClient,
  order: CancelableOrderFixture,
  claim: CancelClaimFixture,
  overrides: {
    readonly cancelDispatchClaimId?: string;
    readonly canonicalRequestDigest?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const brokerActionOrderId = `cancel-action-${randomUUID()}`;
  await client.query(
    `INSERT INTO public."broker_order_action" (
       "id", "order_id", "action_kind", "original_broker_order_id",
       "broker_action_order_id", "broker_status_raw", "authorization_id",
       "cancel_dispatch_claim_id", "canonical_request_digest", "request_id",
       "http_status", "write_outcome", "redacted_body", "redaction_version",
       "observed_at"
     ) VALUES ($1, $2, 'CANCEL', $3, $4, 'REQUEST_ACCEPTED', $5, $6, $7,
       'request-cancel-accepted', 202, 'ACKNOWLEDGED', $8::JSONB,
       'ORDER_REDACTION_V1', statement_timestamp())`,
    [
      id,
      order.orderId,
      order.brokerOrderId,
      brokerActionOrderId,
      claim.authorizationId,
      overrides.cancelDispatchClaimId ?? claim.id,
      overrides.canonicalRequestDigest ?? claim.authorizedRequestDigest,
      JSON.stringify({
        orderId: brokerActionOrderId,
        status: "REQUEST_ACCEPTED",
      }),
    ],
  );
  return id;
}

async function insertCancelAttemptEvidence(
  client: PoolClient,
  order: CancelableOrderFixture,
  claim: CancelClaimFixture,
  outcome: "REJECTED" | "AMBIGUOUS",
  overrides: {
    readonly cancelDispatchClaimId?: string;
    readonly brokerOrderId?: string;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const brokerStatusRaw = outcome === "AMBIGUOUS" ? "AMBIGUOUS" : "CANCEL_REJECTED";
  const validatedState = outcome === "AMBIGUOUS" ? "UNKNOWN" : null;
  await client.query(
    `INSERT INTO public."broker_order_response_evidence" (
       "id", "order_id", "evidence_kind", "dispatch_claim_id",
       "cancel_dispatch_claim_id", "broker_order_id", "broker_status_raw",
       "normalization_version", "validated_normalized_state", "request_id",
       "http_status", "write_outcome", "safe_error_code", "redacted_body",
       "redaction_version", "observed_at"
     ) VALUES ($1, $2, 'CANCEL_ATTEMPT', NULL, $3, $4, $5,
       'TOSS_ORDER_NORMALIZATION_V1', $6::public."OrderLedgerState",
       'request-cancel-attempt', $7, $8, $9, $10::JSONB,
       'ORDER_REDACTION_V1', statement_timestamp())`,
    [
      id,
      order.orderId,
      overrides.cancelDispatchClaimId ?? claim.id,
      overrides.brokerOrderId ?? order.brokerOrderId,
      brokerStatusRaw,
      validatedState,
      outcome === "REJECTED" ? 422 : null,
      outcome,
      outcome === "REJECTED" ? "TOSS_CANCEL_REJECTED" : "TOSS_CANCEL_AMBIGUOUS",
      JSON.stringify({
        orderId: overrides.brokerOrderId ?? order.brokerOrderId,
        status: brokerStatusRaw,
      }),
    ],
  );
  return id;
}

async function withTriggerDisabled(
  client: PoolClient,
  table: string,
  trigger: string,
  action: () => Promise<void>,
): Promise<void> {
  await client.query(`ALTER TABLE public."${table}" DISABLE TRIGGER "${trigger}"`);
  try {
    await action();
  } finally {
    await client.query(`ALTER TABLE public."${table}" ENABLE ALWAYS TRIGGER "${trigger}"`);
  }
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

function cancelRequestDigest(order: CancelableOrderFixture): string {
  return sha256Hex(
    JSON.stringify({
      version: "LIVE_ORDER_REQUEST_V1",
      action: "CANCEL",
      planId: order.planId,
      planOrderId: order.planOrderId,
      logicalOrderId: order.logicalOrderId,
      accountId: order.accountId,
      brokerAccountReference: order.rawBrokerAccountReference,
      clientOrderId: order.clientOrderId,
      brokerOrderId: order.brokerOrderId,
      economicTerms: null,
    }),
  );
}

function tossClientOrderId(canonical: string): string {
  return `pr1_${createHash("sha256").update(canonical).digest("base64url").slice(0, 32)}`;
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
  if (!/(^|[_-])(test|testing|codex)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target an isolated test database",
    );
  }
}
