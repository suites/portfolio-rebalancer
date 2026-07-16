import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const integrationDatabaseUrl = process.env.PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL;
const integrationDescribe = integrationDatabaseUrl ? describe : describe.skip;
const migrationNames = [
  "20260716167000_order_ledger_risk_reservations",
  "20260716170000_order_non_dispatch_recovery",
  "20260716171000_live_dispatch_db_safety",
] as const;

let pool: Pool | undefined;

integrationDescribe("order ledger and risk reservation PostgreSQL integration", () => {
  beforeAll(async () => {
    if (!integrationDatabaseUrl) return;
    assertIsolatedTestDatabase(integrationDatabaseUrl);
    pool = new Pool({ connectionString: integrationDatabaseUrl, max: 6 });
    const migrations = await pool.query<{ finished_at: Date | null }>(
      `SELECT "finished_at"
       FROM public."_prisma_migrations"
       WHERE "migration_name" = ANY($1::TEXT[])`,
      [migrationNames],
    );
    expect(migrations.rows).toHaveLength(migrationNames.length);
    expect(migrations.rows.every((migration) => migration.finished_at !== null)).toBe(true);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("PAPER 주문 의도·초기 상태·예약을 원자적으로 만들고 체결/해제를 함께 갱신한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 2n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId);

      expect(
        await client.query(
          `SELECT "sequence", "normalized_state"::TEXT
           FROM public."order_state_history"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({ rows: [{ sequence: 0, normalized_state: "PLANNED" }] });
      expect(
        await client.query(
          `SELECT "reserved_gross_minor", "filled_gross_minor", "released_gross_minor"
           FROM public."daily_trade_reservation"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({
        rows: [
          {
            reserved_gross_minor: "20000",
            filled_gross_minor: "0",
            released_gross_minor: "0",
          },
        ],
      });

      await expectRejectedSql(client, () =>
        client.query(`UPDATE public."order_ledger" SET "symbol" = '000660' WHERE "id" = $1`, [
          order.id,
        ]),
      );
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."daily_trade_reservation"
           SET "released_gross_minor" = 1
           WHERE "order_id" = $1`,
          [order.id],
        ),
      );
      await expectRejectedSql(client, () =>
        insertState(client, order.id, 1, "FILLED", {
          filledQuantity: 2n,
          filledGrossMinor: 20_000n,
        }),
      );

      await insertState(client, order.id, 1, "SUBMITTING");
      await insertState(client, order.id, 2, "PENDING");
      await insertState(client, order.id, 3, "PARTIAL_FILLED", {
        filledQuantity: 1n,
        filledGrossMinor: 10_000n,
        feeMinor: 10n,
      });
      await insertState(client, order.id, 4, "CANCELED", {
        filledQuantity: 1n,
        filledGrossMinor: 10_000n,
        feeMinor: 10n,
      });

      expect(
        await client.query(
          `SELECT "filled_gross_minor", "released_gross_minor"
           FROM public."daily_trade_reservation"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({
        rows: [{ filled_gross_minor: "10000", released_gross_minor: "10000" }],
      });
      expect(
        await client.query(
          `SELECT "normalized_state"::TEXT, "broker_status_raw", "broker_order_id"
           FROM public."order_ledger_current_state"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({
        rows: [
          {
            normalized_state: "CANCELED",
            broker_status_raw: null,
            broker_order_id: null,
          },
        ],
      });
      await expectRejectedSql(client, () =>
        insertState(client, order.id, 5, "PENDING", {
          filledQuantity: 1n,
          filledGrossMinor: 10_000n,
          feeMinor: 10n,
        }),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("PAPER 부분체결 후 REJECTED를 보존하고 broker 증거·child action을 섞지 않는다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 2n, 10_000n),
        planOrderInput("000660", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 40_000n);
      const rejectedOrder = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId);
      await insertState(client, rejectedOrder.id, 1, "SUBMITTING");
      await insertState(client, rejectedOrder.id, 2, "PENDING");
      await insertState(client, rejectedOrder.id, 3, "PARTIAL_FILLED", {
        filledQuantity: 1n,
        filledGrossMinor: 10_000n,
      });
      await insertState(client, rejectedOrder.id, 4, "REJECTED", {
        filledQuantity: 1n,
        filledGrossMinor: 10_000n,
      });

      const cancelOrder = await insertLedgerOrder(client, fixture, fixture.orders[1]!, limitId);
      await insertState(client, cancelOrder.id, 1, "SUBMITTING");
      await insertState(client, cancelOrder.id, 2, "PENDING");
      await expectRejectedSql(client, () =>
        insertBrokerResponseEvidence(client, {
          orderId: cancelOrder.id,
          evidenceKind: "CANCEL_ATTEMPT",
          brokerOrderId: "broker-paper-must-not-exist",
          brokerStatusRaw: "CANCEL_REJECTED",
        }),
      );
      await expectRejectedSql(client, () =>
        insertState(client, cancelOrder.id, 3, "CANCELED", {
          brokerOrderId: "broker-paper-must-not-exist",
          brokerStatusRaw: "CANCELED",
        }),
      );
      await insertState(client, cancelOrder.id, 3, "CANCELED");

      expect(
        await client.query(
          `SELECT "normalized_state"::TEXT, "broker_order_id", "broker_action_order_id"
           FROM public."order_ledger_current_state"
           WHERE "order_id" = $1`,
          [cancelOrder.id],
        ),
      ).toMatchObject({
        rows: [
          {
            normalized_state: "CANCELED",
            broker_order_id: null,
            broker_action_order_id: null,
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("canonical clientOrderId 36자와 logical_order_id 고유성을 DB에서 강제한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 1n, 10_000n),
        planOrderInput("000660", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);

      await expectRejectedSql(client, () =>
        insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
          clientOrderId: `pr1_${"A".repeat(32)}`,
        }),
      );

      const mismatchedCanonical = canonicalIntent(randomUUID(), fixture, fixture.orders[0]!, {
        quantity: "999",
      });
      await expectRejectedSql(client, () =>
        insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
          canonicalIntent: mismatchedCanonical,
        }),
      );

      const logicalOrderId = randomUUID();
      const first = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        logicalOrderId,
      });
      expect(first.clientOrderId).toHaveLength(36);
      expect(first.clientOrderId).toMatch(/^pr1_[A-Za-z0-9_-]{32}$/);

      await expectRejectedSql(
        client,
        () =>
          insertLedgerOrder(client, fixture, fixture.orders[1]!, limitId, {
            logicalOrderId,
          }),
        ["23505"],
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("pre-submit은 fresh getAccounts PASSED 결과로 현재 계좌를 정확히 재결합한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      await expectRejectedSql(client, () =>
        insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!, {
          accountReferenceHmac: "f".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!, {
          includeAccountValidation: false,
        }),
      );
      const valid = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      expect(valid.preSubmitEvidenceId).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("LIVE 제출은 기본 차단되고 승인 1회 소비와 DISENGAGED 킬스위치를 동시에 요구한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      await expectRejectedSql(client, () => insertDailyLimit(client, fixture, 300_001n));
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const evidence = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      await expectRejectedSql(client, () =>
        insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
          reservedGrossMinor: 100_001n,
        }),
      );
      const firstOrder = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: evidence.reservedGrossMinor,
        reservationEvidenceId: evidence.preSubmitEvidenceId,
      });

      await expectRejectedSql(client, () => insertState(client, firstOrder.id, 1, "SUBMITTING"));

      await expectRejectedSql(client, () =>
        insertApproval(client, fixture, fixture.orders[0]!, {
          approvalHash: "f".repeat(64),
        }),
      );
      await expectRejectedSql(client, () =>
        insertApproval(client, fixture, fixture.orders[0]!, {
          ttlMilliseconds: 601_000,
        }),
      );
      const firstApprovalId = await insertApproval(client, fixture, fixture.orders[0]!);
      await expectRejectedSql(client, () =>
        insertSubmissionAuthorization(
          client,
          fixture,
          fixture.orders[0]!,
          firstOrder,
          evidence,
          firstApprovalId,
        ),
      );
      await expectRejectedSql(client, () =>
        insertKillSwitchEvent(client, fixture.accountId, 1, "DISENGAGED"),
      );

      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await expectRejectedSql(client, () =>
        insertSubmissionAuthorization(
          client,
          fixture,
          fixture.orders[0]!,
          firstOrder,
          evidence,
          firstApprovalId,
        ),
      );
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."manual_order_approval"
           SET "consumed_at" = CURRENT_TIMESTAMP, "consumed_by_order_id" = $2
           WHERE "id" = $1`,
          [firstApprovalId, firstOrder.id],
        ),
      );

      const submissionAuthorization = await insertSubmissionAuthorization(
        client,
        fixture,
        fixture.orders[0]!,
        firstOrder,
        evidence,
        firstApprovalId,
      );
      await expectRejectedSql(client, () =>
        insertPreAuthorizationNonDispatchEvidence(client, {
          orderId: firstOrder.id,
          reservationId: submissionAuthorization.reservationId,
        }),
      );
      expect(
        await client.query(
          `SELECT approval."consumed_at" IS NOT NULL AS consumed,
             approval."consumed_by_order_id", state."normalized_state"::TEXT,
             state."submission_authorization_id",
             (SELECT COUNT(*)::INTEGER FROM public."order_dispatch_claim"
              WHERE "order_id" = $2) AS dispatch_count
           FROM public."manual_order_approval" AS approval
           JOIN public."order_ledger_current_state" AS state ON state."order_id" = $2
           WHERE approval."id" = $1`,
          [firstApprovalId, firstOrder.id],
        ),
      ).toMatchObject({
        rows: [
          {
            consumed: true,
            consumed_by_order_id: firstOrder.id,
            normalized_state: "SUBMITTING",
            submission_authorization_id: submissionAuthorization.id,
            dispatch_count: 0,
          },
        ],
      });

      await expectRejectedSql(client, () =>
        insertBrokerResponseEvidence(client, {
          orderId: firstOrder.id,
          evidenceKind: "SUBMIT",
          brokerOrderId: "broker-live-without-dispatch",
          brokerStatusRaw: "ACKNOWLEDGED",
          httpStatus: 200,
          writeOutcome: "ACKNOWLEDGED",
        }),
      );
      await expectRejectedSql(client, () =>
        insertDispatchClaim(
          client,
          fixture,
          fixture.orders[0]!,
          firstOrder,
          evidence,
          firstApprovalId,
          submissionAuthorization,
          { authorizedRequestDigest: "f".repeat(64) },
        ),
      );
      const dispatchClaimId = await insertDispatchClaim(
        client,
        fixture,
        fixture.orders[0]!,
        firstOrder,
        evidence,
        firstApprovalId,
        submissionAuthorization,
      );
      await expectRejectedSql(
        client,
        () =>
          insertDispatchClaim(
            client,
            fixture,
            fixture.orders[0]!,
            firstOrder,
            evidence,
            firstApprovalId,
            submissionAuthorization,
          ),
        ["23505"],
      );
      const submitEvidenceId = await insertBrokerResponseEvidence(client, {
        orderId: firstOrder.id,
        evidenceKind: "SUBMIT",
        dispatchClaimId,
        brokerOrderId: "broker-live-1",
        brokerStatusRaw: "ACKNOWLEDGED",
        httpStatus: 200,
        writeOutcome: "ACKNOWLEDGED",
      });
      await insertState(client, firstOrder.id, 2, "PENDING", {
        brokerOrderId: "broker-live-1",
        brokerStatusRaw: "ACKNOWLEDGED",
        brokerResponseEvidenceId: submitEvidenceId,
      });
      expect(
        await client.query(
          `SELECT "normalized_state"::TEXT, "dispatch_claim_id",
             "broker_response_http_status", "broker_response_write_outcome"
           FROM public."order_ledger_current_state"
           WHERE "order_id" = $1`,
          [firstOrder.id],
        ),
      ).toMatchObject({
        rows: [
          {
            normalized_state: "PENDING",
            dispatch_claim_id: dispatchClaimId,
            broker_response_http_status: 200,
            broker_response_write_outcome: "ACKNOWLEDGED",
          },
        ],
      });

      const cancelClaim = await insertCancelAuditClaim(
        client,
        fixture,
        fixture.orders[0]!,
        firstOrder,
        "broker-live-1",
      );
      const acceptedCancelActionId = await insertBrokerAction(client, {
        orderId: firstOrder.id,
        originalBrokerOrderId: "broker-live-1",
        brokerActionOrderId: "broker-live-cancel-child-1",
        cancelDispatchClaimId: cancelClaim.id,
        authorizationId: cancelClaim.authorizationId,
        canonicalRequestDigest: cancelClaim.authorizedRequestDigest,
      });
      const canceledEvidenceId = await insertBrokerResponseEvidence(client, {
        orderId: firstOrder.id,
        evidenceKind: "RECONCILE",
        brokerOrderId: "broker-live-1",
        brokerStatusRaw: "CANCELED",
      });
      await insertState(client, firstOrder.id, 3, "CANCELED", {
        brokerOrderId: "broker-live-1",
        brokerStatusRaw: "CANCELED",
        brokerActionId: acceptedCancelActionId,
        brokerResponseEvidenceId: canceledEvidenceId,
      });
      expect(
        await client.query(
          `SELECT "normalized_state"::TEXT, "broker_order_id", "broker_action_order_id",
             "broker_action_cancel_dispatch_claim_id"
           FROM public."order_ledger_current_state"
           WHERE "order_id" = $1`,
          [firstOrder.id],
        ),
      ).toMatchObject({
        rows: [
          {
            normalized_state: "CANCELED",
            broker_order_id: "broker-live-1",
            broker_action_order_id: "broker-live-cancel-child-1",
            broker_action_cancel_dispatch_claim_id: cancelClaim.id,
          },
        ],
      });
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."broker_order_action"
           SET "request_id" = 'tampered'
           WHERE "id" = $1`,
          [acceptedCancelActionId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."broker_order_response_evidence" WHERE "id" = $1`, [
          canceledEvidenceId,
        ]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("B는 A 이후 바뀐 ACTIVE config, promotion, kill switch를 계좌 잠금 아래 fail closed한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const prepareAuthorization = async (symbol: string) => {
        const fixture = await insertSealedPlan(client, "LIVE", [
          planOrderInput(symbol, 1n, 10_000n),
        ]);
        const limitId = await insertDailyLimit(client, fixture, 50_000n);
        const evidence = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
        const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
          reservedGrossMinor: evidence.reservedGrossMinor,
          reservationEvidenceId: evidence.preSubmitEvidenceId,
        });
        await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
        await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
        const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
        const authorization = await insertSubmissionAuthorization(
          client,
          fixture,
          fixture.orders[0]!,
          order,
          evidence,
          approvalId,
        );
        return { fixture, evidence, order, approvalId, authorization };
      };

      const configChanged = await prepareAuthorization("005930");
      const nextConfig = JSON.parse(configChanged.evidence.operationalConfigCanonical) as Record<
        string,
        unknown
      >;
      const live = nextConfig.live as Record<string, unknown>;
      live.approvalTtlSeconds = 299;
      const nextCanonical = JSON.stringify(nextConfig);
      const nextConfigVersionId = randomUUID();
      await client.query(
        `INSERT INTO public."operational_config_version" (
           "id", "config_id", "version", "schema_version", "canonical_content",
           "content_hash", "payload"
         ) VALUES ($1, $2, 2, 'OPERATIONAL_CONFIG_V1', $3::TEXT, $4,
           $3::TEXT::JSONB)`,
        [
          nextConfigVersionId,
          configChanged.evidence.operationalConfigId,
          nextCanonical,
          sha256Hex(nextCanonical),
        ],
      );
      await client.query(
        `INSERT INTO public."operational_config_activation" (
           "config_id", "version", "operational_config_version_id", "actor",
           "confirmation_version"
         ) VALUES ($1, 2, $2, 'integration-operator',
           'OPERATIONAL_CONFIG_ACTIVATION_V1')`,
        [configChanged.evidence.operationalConfigId, nextConfigVersionId],
      );
      await expectRejectedSql(client, () =>
        insertDispatchClaim(
          client,
          configChanged.fixture,
          configChanged.fixture.orders[0]!,
          configChanged.order,
          configChanged.evidence,
          configChanged.approvalId,
          configChanged.authorization,
        ),
      );

      const promotionRevoked = await prepareAuthorization("000660");
      await client.query(
        `INSERT INTO public."live_promotion_event" (
           "account_id", "version", "state", "operational_config_sha256",
           "operational_config_version_id", "account_allowlist_hmac",
           "max_single_order_gross_minor", "max_daily_gross_minor",
           "tiny_live_max_gross_minor", "actor", "reason"
         ) VALUES ($1, 3, 'REVOKED', $2, $3, $4, 100000, 300000, 50000,
           'integration-operator', 'integration-revocation')`,
        [
          promotionRevoked.fixture.accountId,
          promotionRevoked.evidence.operationalConfigSha256,
          promotionRevoked.evidence.operationalConfigVersionId,
          promotionRevoked.fixture.accountExternalRefHmac,
        ],
      );
      await expectRejectedSql(client, () =>
        insertDispatchClaim(
          client,
          promotionRevoked.fixture,
          promotionRevoked.fixture.orders[0]!,
          promotionRevoked.order,
          promotionRevoked.evidence,
          promotionRevoked.approvalId,
          promotionRevoked.authorization,
        ),
      );

      const killEngaged = await prepareAuthorization("035420");
      await insertKillSwitchEvent(client, killEngaged.fixture.accountId, 3, "ENGAGED");
      await expectRejectedSql(client, () =>
        insertDispatchClaim(
          client,
          killEngaged.fixture,
          killEngaged.fixture.orders[0]!,
          killEngaged.order,
          killEngaged.evidence,
          killEngaged.approvalId,
          killEngaged.authorization,
        ),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("B와 config activation은 같은 broker account 행 잠금으로 직렬화된다", async () => {
    const setupClient = await integrationClient();
    const lockClient = await integrationClient();
    const dispatchClient = await integrationClient();
    let lockOpen = false;
    try {
      const fixture = await insertSealedPlan(setupClient, "LIVE", [
        planOrderInput("068270", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(setupClient, fixture, 50_000n);
      const evidence = await insertLivePreSubmitEvidence(setupClient, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(setupClient, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: evidence.reservedGrossMinor,
        reservationEvidenceId: evidence.preSubmitEvidenceId,
      });
      await insertKillSwitchEvent(setupClient, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(setupClient, fixture.accountId, 2, "DISENGAGED");
      const approvalId = await insertApproval(setupClient, fixture, fixture.orders[0]!);
      const authorization = await insertSubmissionAuthorization(
        setupClient,
        fixture,
        fixture.orders[0]!,
        order,
        evidence,
        approvalId,
      );

      await lockClient.query("BEGIN");
      lockOpen = true;
      await lockClient.query(`SELECT 1 FROM public."broker_account" WHERE "id" = $1 FOR UPDATE`, [
        fixture.accountId,
      ]);
      await dispatchClient.query("SET statement_timeout = '200ms'");
      let timedOut: unknown;
      try {
        await insertDispatchClaim(
          dispatchClient,
          fixture,
          fixture.orders[0]!,
          order,
          evidence,
          approvalId,
          authorization,
        );
      } catch (error) {
        timedOut = error;
      }
      expect(sqlState(timedOut)).toBe("57014");

      await lockClient.query("COMMIT");
      lockOpen = false;
      await dispatchClient.query("SET statement_timeout = 0");
      await insertDispatchClaim(
        dispatchClient,
        fixture,
        fixture.orders[0]!,
        order,
        evidence,
        approvalId,
        authorization,
      );
    } finally {
      if (lockOpen) await lockClient.query("ROLLBACK");
      await dispatchClient.query("SET statement_timeout = 0").catch(() => undefined);
      setupClient.release();
      lockClient.release();
      dispatchClient.release();
    }
  });

  it("config activation은 account-first lock을 기다린 뒤에만 최신 ACTIVE를 바꾼다", async () => {
    const setupClient = await integrationClient();
    const lockClient = await integrationClient();
    const activationClient = await integrationClient();
    let lockOpen = false;
    try {
      const fixture = await insertSealedPlan(setupClient, "LIVE", [
        planOrderInput("051910", 1n, 10_000n),
      ]);
      const evidence = await insertLivePreSubmitEvidence(setupClient, fixture, fixture.orders[0]!);
      const nextConfig = JSON.parse(evidence.operationalConfigCanonical) as Record<string, unknown>;
      (nextConfig.live as Record<string, unknown>).approvalTtlSeconds = 298;
      const nextCanonical = JSON.stringify(nextConfig);
      const nextConfigVersionId = randomUUID();
      await setupClient.query(
        `INSERT INTO public."operational_config_version" (
           "id", "config_id", "version", "schema_version", "canonical_content",
           "content_hash", "payload"
         ) VALUES ($1, $2, 2, 'OPERATIONAL_CONFIG_V1', $3::TEXT, $4,
           $3::TEXT::JSONB)`,
        [
          nextConfigVersionId,
          evidence.operationalConfigId,
          nextCanonical,
          sha256Hex(nextCanonical),
        ],
      );

      await lockClient.query("BEGIN");
      lockOpen = true;
      await lockClient.query(`SELECT 1 FROM public."broker_account" WHERE "id" = $1 FOR UPDATE`, [
        fixture.accountId,
      ]);
      await activationClient.query("SET statement_timeout = '200ms'");
      let timedOut: unknown;
      try {
        await activationClient.query(
          `INSERT INTO public."operational_config_activation" (
             "config_id", "version", "operational_config_version_id", "actor",
             "confirmation_version"
           ) VALUES ($1, 2, $2, 'integration-operator',
             'OPERATIONAL_CONFIG_ACTIVATION_V1')`,
          [evidence.operationalConfigId, nextConfigVersionId],
        );
      } catch (error) {
        timedOut = error;
      }
      expect(sqlState(timedOut)).toBe("57014");

      await lockClient.query("COMMIT");
      lockOpen = false;
      await activationClient.query("SET statement_timeout = 0");
      await activationClient.query(
        `INSERT INTO public."operational_config_activation" (
           "config_id", "version", "operational_config_version_id", "actor",
           "confirmation_version"
         ) VALUES ($1, 2, $2, 'integration-operator',
           'OPERATIONAL_CONFIG_ACTIVATION_V1')`,
        [evidence.operationalConfigId, nextConfigVersionId],
      );
      expect(
        await activationClient.query(
          `SELECT "operational_config_version_id"
           FROM public."operational_config_current"
           WHERE "account_id" = $1`,
          [fixture.accountId],
        ),
      ).toMatchObject({ rows: [{ operational_config_version_id: nextConfigVersionId }] });
    } finally {
      if (lockOpen) await lockClient.query("ROLLBACK");
      await activationClient.query("SET statement_timeout = 0").catch(() => undefined);
      setupClient.release();
      lockClient.release();
      activationClient.release();
    }
  });

  it("A 이전 PLANNED 고착은 불변 증거로 REJECTED와 예약 해제를 원자 기록한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const liveEvidence = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: liveEvidence.reservedGrossMinor,
        reservationEvidenceId: liveEvidence.preSubmitEvidenceId,
      });
      const reservation = await client.query<{ id: string }>(
        `SELECT "id" FROM public."daily_trade_reservation" WHERE "order_id" = $1`,
        [order.id],
      );
      const evidenceId = await insertPreAuthorizationNonDispatchEvidence(client, {
        orderId: order.id,
        reservationId: reservation.rows[0]!.id,
      });
      const recovered = await client.query<{
        normalized_state: string;
        pre_authorization_non_dispatch_evidence_id: string;
        pre_authorization_non_dispatch_safe_reason_code: string;
        pre_authorization_non_dispatch_proof_sha256: string;
        released_gross_minor: string;
      }>(
        `SELECT state."normalized_state"::TEXT,
           state."pre_authorization_non_dispatch_evidence_id",
           state."pre_authorization_non_dispatch_safe_reason_code",
           state."pre_authorization_non_dispatch_proof_sha256",
           reservation."released_gross_minor"
         FROM public."order_ledger_current_state" AS state
         JOIN public."daily_trade_reservation" AS reservation
           ON reservation."order_id" = state."order_id"
         WHERE state."order_id" = $1`,
        [order.id],
      );
      expect(recovered.rows).toMatchObject([
        {
          normalized_state: "REJECTED",
          pre_authorization_non_dispatch_evidence_id: evidenceId,
          pre_authorization_non_dispatch_safe_reason_code: "PRE_AUTHORIZATION_NOT_COMPLETED",
          released_gross_minor: liveEvidence.reservedGrossMinor.toString(),
        },
      ]);
      expect(recovered.rows[0]?.pre_authorization_non_dispatch_proof_sha256).toMatch(
        /^[0-9a-f]{64}$/,
      );

      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
      const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
      await expectRejectedSql(client, () =>
        insertSubmissionAuthorization(
          client,
          fixture,
          fixture.orders[0]!,
          order,
          liveEvidence,
          approvalId,
        ),
      );
      await expectRejectedSql(client, () =>
        insertBrokerResponseEvidence(client, {
          orderId: order.id,
          evidenceKind: "SUBMIT",
          brokerOrderId: "must-never-exist",
          brokerStatusRaw: "ACKNOWLEDGED",
          httpStatus: 200,
          writeOutcome: "ACKNOWLEDGED",
        }),
      );
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."order_pre_auth_non_dispatch_evidence"
           SET "actor" = 'tampered' WHERE "id" = $1`,
          [evidenceId],
        ),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("A 이후 B가 없으면 불변 증명으로 REJECTED를 닫고 이후 제출을 영구 차단한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const liveEvidence = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: liveEvidence.reservedGrossMinor,
        reservationEvidenceId: liveEvidence.preSubmitEvidenceId,
      });
      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
      const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
      const authorization = await insertSubmissionAuthorization(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        liveEvidence,
        approvalId,
      );

      await expectRejectedSql(client, () =>
        insertNonDispatchEvidence(client, {
          submissionAuthorizationId: authorization.id,
          orderId: randomUUID(),
        }),
      );
      await expectRejectedSql(
        client,
        () =>
          insertNonDispatchEvidence(client, {
            submissionAuthorizationId: randomUUID(),
            orderId: order.id,
          }),
        ["23503"],
      );
      const evidenceId = await insertNonDispatchEvidence(client, {
        submissionAuthorizationId: authorization.id,
        orderId: order.id,
      });
      await expectRejectedSql(client, () =>
        insertDispatchClaim(
          client,
          fixture,
          fixture.orders[0]!,
          order,
          liveEvidence,
          approvalId,
          authorization,
        ),
      );
      const recovered = await client.query<{
        normalized_state: string;
        actor: string;
        non_dispatch_evidence_id: string;
        broker_order_id: string | null;
        broker_response_evidence_id: string | null;
        non_dispatch_safe_reason_code: string;
        non_dispatch_proof_sha256: string;
        canonical_proof: string;
        released_gross_minor: string;
      }>(
        `SELECT current_state."normalized_state"::TEXT, current_state."actor",
           current_state."non_dispatch_evidence_id", current_state."broker_order_id",
           current_state."broker_response_evidence_id",
           current_state."non_dispatch_safe_reason_code",
           current_state."non_dispatch_proof_sha256",
           non_dispatch."canonical_proof", reservation."released_gross_minor"
         FROM public."order_ledger_current_state" AS current_state
         JOIN public."order_non_dispatch_evidence" AS non_dispatch
           ON non_dispatch."id" = current_state."non_dispatch_evidence_id"
         JOIN public."daily_trade_reservation" AS reservation
           ON reservation."order_id" = current_state."order_id"
         WHERE current_state."order_id" = $1`,
        [order.id],
      );
      expect(recovered.rows).toMatchObject([
        {
          normalized_state: "REJECTED",
          actor: "RECOVERY",
          non_dispatch_evidence_id: evidenceId,
          broker_order_id: null,
          broker_response_evidence_id: null,
          non_dispatch_safe_reason_code: "AUTHORIZATION_NOT_DISPATCHED",
          released_gross_minor: liveEvidence.reservedGrossMinor.toString(),
        },
      ]);
      expect(recovered.rows[0]?.non_dispatch_proof_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(recovered.rows[0]?.canonical_proof).not.toContain(fixture.accountExternalRefHmac);
      expect(recovered.rows[0]?.canonical_proof).not.toContain("synthetic-live-account-reference");

      await expectRejectedSql(client, () =>
        insertNonDispatchEvidence(client, {
          submissionAuthorizationId: authorization.id,
          orderId: order.id,
        }),
      );
      await expectRejectedSql(client, () =>
        insertBrokerResponseEvidence(client, {
          orderId: order.id,
          evidenceKind: "SUBMIT",
          brokerOrderId: "must-never-exist",
          brokerStatusRaw: "ACKNOWLEDGED",
          httpStatus: 200,
          writeOutcome: "ACKNOWLEDGED",
        }),
      );
      expect(
        await client.query(
          `SELECT
             (SELECT COUNT(*)::INTEGER FROM public."order_dispatch_claim"
              WHERE "order_id" = $1) AS dispatch_count,
             (SELECT COUNT(*)::INTEGER FROM public."broker_order_response_evidence"
              WHERE "order_id" = $1 AND "evidence_kind" = 'SUBMIT') AS submit_count`,
          [order.id],
        ),
      ).toMatchObject({ rows: [{ dispatch_count: 0, submit_count: 0 }] });

      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."order_non_dispatch_evidence"
           SET "actor" = 'tampered'
           WHERE "id" = $1`,
          [evidenceId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."order_non_dispatch_evidence" WHERE "id" = $1`, [
          evidenceId,
        ]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("B가 먼저 존재하면 비전송 증명을 만들 수 없다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("000660", 1n, 20_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const liveEvidence = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: liveEvidence.reservedGrossMinor,
        reservationEvidenceId: liveEvidence.preSubmitEvidenceId,
      });
      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
      const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
      const authorization = await insertSubmissionAuthorization(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        liveEvidence,
        approvalId,
      );
      await insertDispatchClaim(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        liveEvidence,
        approvalId,
        authorization,
      );

      await expectRejectedSql(client, () =>
        insertNonDispatchEvidence(client, {
          submissionAuthorizationId: authorization.id,
          orderId: order.id,
        }),
      );
      expect(
        await client.query(
          `SELECT COUNT(*)::INTEGER AS proof_count
           FROM public."order_non_dispatch_evidence"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({ rows: [{ proof_count: 0 }] });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("B 뒤 SUBMIT 증거가 없으면 exact claim의 no-ID UNKNOWN_BLOCKED만 첫 결과로 허용한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const preSubmit = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: preSubmit.reservedGrossMinor,
        reservationEvidenceId: preSubmit.preSubmitEvidenceId,
      });
      const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
      const submissionAuthorization = await insertSubmissionAuthorization(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        preSubmit,
        approvalId,
      );
      const dispatchClaimId = await insertDispatchClaim(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        preSubmit,
        approvalId,
        submissionAuthorization,
      );

      await expectRejectedSql(client, () =>
        insertBrokerResponseEvidence(client, {
          orderId: order.id,
          evidenceKind: "RECONCILE",
          dispatchClaimId,
          brokerOrderId: "unsafe-economic-match",
          brokerStatusRaw: "PENDING",
          httpStatus: 200,
          writeOutcome: "OBSERVED",
        }),
      );
      const blockedEvidenceId = await insertBrokerResponseEvidence(client, {
        orderId: order.id,
        evidenceKind: "RECONCILE",
        dispatchClaimId,
        brokerStatusRaw: "INTEGRITY_BLOCKED",
        safeErrorCode: "IDEMPOTENCY_WINDOW_EXPIRED",
        httpStatus: null,
        writeOutcome: "INTEGRITY_BLOCKED",
      });
      await insertState(client, order.id, 2, "UNKNOWN_BLOCKED", {
        brokerStatusRaw: "INTEGRITY_BLOCKED",
        brokerResponseEvidenceId: blockedEvidenceId,
      });

      expect(
        await client.query(
          `SELECT current_state."normalized_state"::TEXT,
                  current_state."broker_order_id",
                  evidence."dispatch_claim_id",
                  reservation."released_gross_minor"
           FROM public."order_ledger_current_state" AS current_state
           JOIN public."broker_order_response_evidence" AS evidence
             ON evidence."id" = current_state."broker_response_evidence_id"
           JOIN public."daily_trade_reservation" AS reservation
             ON reservation."order_id" = current_state."order_id"
           WHERE current_state."order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({
        rows: [
          {
            normalized_state: "UNKNOWN_BLOCKED",
            broker_order_id: null,
            dispatch_claim_id: dispatchClaimId,
            released_gross_minor: "0",
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("UNKNOWN_BLOCKED는 자동 재제출을 막고 OPERATOR가 저장된 broker evidence로만 복구한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "LIVE", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const preSubmit = await insertLivePreSubmitEvidence(client, fixture, fixture.orders[0]!);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: preSubmit.reservedGrossMinor,
        reservationEvidenceId: preSubmit.preSubmitEvidenceId,
      });
      const approvalId = await insertApproval(client, fixture, fixture.orders[0]!);
      await insertKillSwitchEvent(client, fixture.accountId, 1, "ENGAGED");
      await insertKillSwitchEvent(client, fixture.accountId, 2, "DISENGAGED");
      const submissionAuthorization = await insertSubmissionAuthorization(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        preSubmit,
        approvalId,
      );
      const dispatchClaimId = await insertDispatchClaim(
        client,
        fixture,
        fixture.orders[0]!,
        order,
        preSubmit,
        approvalId,
        submissionAuthorization,
      );
      const ambiguousEvidenceId = await insertBrokerResponseEvidence(client, {
        orderId: order.id,
        evidenceKind: "SUBMIT",
        dispatchClaimId,
        brokerStatusRaw: "AMBIGUOUS",
        safeErrorCode: "TOSS_CREATE_ORDER_TIMEOUT",
        httpStatus: null,
        writeOutcome: "AMBIGUOUS",
      });
      await insertState(client, order.id, 2, "UNKNOWN", {
        brokerStatusRaw: "AMBIGUOUS",
        brokerResponseEvidenceId: ambiguousEvidenceId,
      });
      const blockedEvidenceId = await insertBrokerResponseEvidence(client, {
        orderId: order.id,
        evidenceKind: "RECONCILE",
        brokerStatusRaw: "INTEGRITY_BLOCKED",
        safeErrorCode: "IDEMPOTENCY_WINDOW_EXPIRED",
        httpStatus: null,
        writeOutcome: "INTEGRITY_BLOCKED",
      });
      await insertState(client, order.id, 3, "UNKNOWN_BLOCKED", {
        brokerStatusRaw: "INTEGRITY_BLOCKED",
        brokerResponseEvidenceId: blockedEvidenceId,
      });

      expect(
        await client.query(
          `SELECT "filled_gross_minor", "released_gross_minor"
           FROM public."daily_trade_reservation"
           WHERE "order_id" = $1`,
          [order.id],
        ),
      ).toMatchObject({
        rows: [{ filled_gross_minor: "0", released_gross_minor: "0" }],
      });
      await expectRejectedSql(client, () => insertState(client, order.id, 4, "SUBMITTING"));
      await expectRejectedSql(client, () =>
        insertState(client, order.id, 4, "PENDING", {
          actor: "OPERATOR",
          brokerStatusRaw: "PENDING",
          brokerOrderId: "broker-reconciled-1",
        }),
      );
      const evidenceId = await insertBrokerResponseEvidence(client, {
        orderId: order.id,
        evidenceKind: "RECONCILE",
        brokerOrderId: "broker-reconciled-1",
        brokerStatusRaw: "PENDING",
      });
      await expectRejectedSql(client, () =>
        insertState(client, order.id, 4, "PENDING", {
          brokerStatusRaw: "PENDING",
          brokerOrderId: "broker-reconciled-1",
          brokerResponseEvidenceId: evidenceId,
        }),
      );
      await insertState(client, order.id, 4, "PENDING", {
        actor: "OPERATOR",
        brokerStatusRaw: "PENDING",
        brokerOrderId: "broker-reconciled-1",
        brokerResponseEvidenceId: evidenceId,
      });
      const recoveredState = await client.query<{
        normalized_state: string;
        actor: string;
        body_sha256: string;
        expected_sha256: string;
      }>(
        `SELECT state."normalized_state"::TEXT, state."actor",
             evidence."body_sha256",
             pg_catalog.encode(
               pg_catalog.sha256(pg_catalog.convert_to(evidence."redacted_body"::TEXT, 'UTF8')),
               'hex'
             ) AS expected_sha256
           FROM public."order_ledger_current_state" AS state
           JOIN public."broker_order_response_evidence" AS evidence
             ON evidence."id" = state."broker_response_evidence_id"
           WHERE state."order_id" = $1`,
        [order.id],
      );
      expect(recoveredState).toMatchObject({
        rows: [
          {
            normalized_state: "PENDING",
            actor: "OPERATOR",
          },
        ],
      });
      expect(recoveredState.rows[0]?.body_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(recoveredState.rows[0]?.expected_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(recoveredState.rows[0]?.body_sha256).toBe(recoveredState.rows[0]?.expected_sha256);
      await expectRejectedSql(client, () =>
        client.query(
          `UPDATE public."broker_order_response_evidence"
           SET "safe_error_code" = 'tampered'
           WHERE "id" = $1`,
          [evidenceId],
        ),
      );
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."broker_order_response_evidence" WHERE "id" = $1`, [
          evidenceId,
        ]),
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("SELL 체결액이 계획가를 웃돌아도 보수 예약 안에서는 체결하고 잔여 예약만 해제한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 1n, 10_000n, "SELL"),
        planOrderInput("000660", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 30_000n);

      await expectRejectedSql(client, () =>
        insertLedgerOrder(client, fixture, fixture.orders[1]!, limitId, {
          reservedGrossMinor: 9_999n,
        }),
      );

      const sellOrder = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId, {
        reservedGrossMinor: 12_000n,
      });
      await insertState(client, sellOrder.id, 1, "SUBMITTING");
      await insertState(client, sellOrder.id, 2, "PENDING");
      await insertState(client, sellOrder.id, 3, "FILLED", {
        filledQuantity: 1n,
        filledGrossMinor: 11_000n,
      });

      expect(
        await client.query(
          `SELECT "reserved_gross_minor", "filled_gross_minor", "released_gross_minor"
           FROM public."daily_trade_reservation"
           WHERE "order_id" = $1`,
          [sellOrder.id],
        ),
      ).toMatchObject({
        rows: [
          {
            reserved_gross_minor: "12000",
            filled_gross_minor: "11000",
            released_gross_minor: "1000",
          },
        ],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("Phase A SELL 종료 뒤 관측된 최신 snapshot으로만 Phase B version 2 BUY를 연다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 1n, 10_000n, "SELL"),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 50_000n);
      const sellOrder = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId);
      await insertState(client, sellOrder.id, 1, "SUBMITTING");
      await insertState(client, sellOrder.id, 2, "PENDING");

      const staleCollectionRunId = randomUUID();
      const staleSnapshotId = randomUUID();
      await client.query(
        `INSERT INTO public."collection_run" (
           "id", "account_id", "status", "started_at", "app_version", "adapter_version"
         ) VALUES ($1, $2, 'RUNNING', statement_timestamp(), 'integration-test', 'integration-test')`,
        [staleCollectionRunId, fixture.accountId],
      );
      await client.query(
        `INSERT INTO public."portfolio_snapshot" (
           "id", "collection_run_id", "account_id", "target_config_version_id",
           "observed_at", "validation_status", "base_currency", "managed_cash_minor",
           "securities_value_minor", "total_value_minor", "digest"
         ) VALUES ($1, $2, $3, $4, statement_timestamp(), 'VERIFIED', 'KRW', 0,
           90000, 90000, $5)`,
        [
          staleSnapshotId,
          staleCollectionRunId,
          fixture.accountId,
          fixture.targetConfigVersionId,
          randomHex64(),
        ],
      );
      const staleCanonical = JSON.stringify({ phase: "BUY", snapshotId: staleSnapshotId });
      await expectRejectedSql(client, () =>
        client.query(
          `INSERT INTO public."rebalance_plan_version" (
             "plan_id", "version", "phase", "snapshot_id", "target_config_version_id",
             "mode", "status", "canonical_version", "plan_hash", "canonical_content"
           ) VALUES ($1, 2, 'BUY', $2, $3, 'PAPER', 'PLANNED', 'SHADOW_PLAN_V2', $4, $5)`,
          [
            fixture.planId,
            staleSnapshotId,
            fixture.targetConfigVersionId,
            sha256Hex(staleCanonical),
            staleCanonical,
          ],
        ),
      );

      await insertState(client, sellOrder.id, 3, "FILLED", {
        filledQuantity: 1n,
        filledGrossMinor: 10_000n,
      });
      const terminal = await client.query<{ occurred_at: Date }>(
        `SELECT "occurred_at" FROM public."order_ledger_current_state" WHERE "order_id" = $1`,
        [sellOrder.id],
      );
      const refreshedObservedAt = new Date(
        Math.max(Date.now(), terminal.rows[0]!.occurred_at.getTime() + 1),
      );
      const refreshedCollectionRunId = randomUUID();
      const refreshedSnapshotId = randomUUID();
      await client.query(
        `INSERT INTO public."collection_run" (
           "id", "account_id", "status", "started_at", "app_version", "adapter_version"
         ) VALUES ($1, $2, 'RUNNING', $3, 'integration-test', 'integration-test')`,
        [refreshedCollectionRunId, fixture.accountId, refreshedObservedAt],
      );
      await client.query(
        `INSERT INTO public."portfolio_snapshot" (
           "id", "collection_run_id", "account_id", "target_config_version_id",
           "observed_at", "validation_status", "base_currency", "managed_cash_minor",
           "securities_value_minor", "total_value_minor", "digest"
         ) VALUES ($1, $2, $3, $4, $5, 'VERIFIED', 'KRW', 0, 90000, 90000, $6)`,
        [
          refreshedSnapshotId,
          refreshedCollectionRunId,
          fixture.accountId,
          fixture.targetConfigVersionId,
          refreshedObservedAt,
          randomHex64(),
        ],
      );
      const phaseBCanonical = JSON.stringify({ phase: "BUY", snapshotId: refreshedSnapshotId });
      const phaseBPlanHash = sha256Hex(phaseBCanonical);
      await client.query(
        `INSERT INTO public."rebalance_plan_version" (
           "plan_id", "version", "phase", "snapshot_id", "target_config_version_id",
           "mode", "status", "canonical_version", "plan_hash", "canonical_content"
         ) VALUES ($1, 2, 'BUY', $2, $3, 'PAPER', 'PLANNED', 'SHADOW_PLAN_V2', $4, $5)`,
        [
          fixture.planId,
          refreshedSnapshotId,
          fixture.targetConfigVersionId,
          phaseBPlanHash,
          phaseBCanonical,
        ],
      );
      const phaseBOrder: PlanOrderFixture = {
        id: randomUUID(),
        planVersion: 2,
        planHash: phaseBPlanHash,
        phase: "BUY",
        marketCountry: "KR",
        currency: "KRW",
        symbol: "000660",
        side: "BUY",
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: 1n,
        limitPriceMinor: 10_000n,
        notionalMinor: 10_000n,
      };
      await client.query(
        `INSERT INTO public."rebalance_plan_order" (
           "id", "plan_id", "plan_version", "candidate_id", "phase", "ordinal",
           "asset_class_id", "instrument_key", "market_country", "currency", "symbol",
           "side", "order_type", "time_in_force", "quantity", "limit_price_minor",
           "notional_minor", "unallocated_minor"
         ) VALUES ($1, $2, 2, 'CORE:KR:000660:BUY', 'BUY', 0, 'CORE', 'KR:000660',
           'KR', 'KRW', '000660', 'BUY', 'LIMIT', 'DAY', 1, 10000, 10000, 0)`,
        [phaseBOrder.id, fixture.planId],
      );
      const phaseBLedger = await insertLedgerOrder(client, fixture, phaseBOrder, limitId);
      expect(phaseBLedger.clientOrderId).not.toBe(sellOrder.clientOrderId);
      expect(
        await client.query(
          `SELECT "plan_id", "plan_version", "phase" FROM public."order_ledger" WHERE "id" = $1`,
          [phaseBLedger.id],
        ),
      ).toMatchObject({
        rows: [{ plan_id: fixture.planId, plan_version: 2, phase: "BUY" }],
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("동시 주문 예약을 거래일 버킷에서 직렬화해 합산 한도 초과를 하나만 거부한다", async () => {
    const setupClient = await integrationClient();
    let fixture: SealedPlanFixture;
    let limitId: string;
    try {
      fixture = await insertSealedPlan(setupClient, "PAPER", [
        planOrderInput("005930", 1n, 10_000n),
        planOrderInput("000660", 1n, 10_000n),
      ]);
      limitId = await insertDailyLimit(setupClient, fixture, 15_000n);
    } finally {
      setupClient.release();
    }

    const firstClient = await integrationClient();
    const secondClient = await integrationClient();
    let firstCommitted = false;
    let secondRolledBack = false;
    await firstClient.query("BEGIN");
    await secondClient.query("BEGIN");
    try {
      await insertLedgerOrder(firstClient, fixture!, fixture!.orders[0]!, limitId!);

      let secondSettled = false;
      const secondInsert = insertLedgerOrder(
        secondClient,
        fixture!,
        fixture!.orders[1]!,
        limitId!,
      ).then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      void secondInsert.finally(() => {
        secondSettled = true;
      });

      await delay(50);
      expect(secondSettled).toBe(false);
      await firstClient.query("COMMIT");
      firstCommitted = true;

      const secondResult = await secondInsert;
      expect(sqlState(secondResult.error)).toBe("23514");
      await secondClient.query("ROLLBACK");
      secondRolledBack = true;

      expect(
        await pool!.query<{ count: string }>(
          `SELECT COUNT(*)::TEXT AS count
           FROM public."daily_trade_reservation"
           WHERE "daily_trade_limit_id" = $1`,
          [limitId!],
        ),
      ).toMatchObject({ rows: [{ count: "1" }] });
    } finally {
      if (!firstCommitted) {
        await firstClient.query("ROLLBACK").catch(() => undefined);
      }
      if (!secondRolledBack) {
        await secondClient.query("ROLLBACK").catch(() => undefined);
      }
      firstClient.release();
      secondClient.release();
    }
  });

  it("ALWAYS trigger가 replica role에서도 변경과 TRUNCATE를 차단한다", async () => {
    const client = await integrationClient();
    await client.query("BEGIN");
    try {
      const fixture = await insertSealedPlan(client, "PAPER", [
        planOrderInput("005930", 1n, 10_000n),
      ]);
      const limitId = await insertDailyLimit(client, fixture, 20_000n);
      const order = await insertLedgerOrder(client, fixture, fixture.orders[0]!, limitId);

      await client.query("SET LOCAL session_replication_role = replica");
      await expectRejectedSql(client, () =>
        client.query(`DELETE FROM public."order_state_history" WHERE "order_id" = $1`, [order.id]),
      );
      await expectRejectedSql(client, () =>
        client.query(`TRUNCATE public."daily_trade_limit" CASCADE`),
      );
      await expectRejectedSql(
        client,
        () => client.query(`TRUNCATE public."broker_order_response_evidence"`),
        ["23514", "0A000"],
      );
      await client.query("SET LOCAL session_replication_role = origin");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

type ExecutionMode = "PAPER" | "LIVE";
type NormalizedState =
  | "SUBMITTING"
  | "PENDING"
  | "PARTIAL_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "UNKNOWN"
  | "UNKNOWN_BLOCKED";

interface PlanOrderFixture {
  readonly id: string;
  readonly planVersion: number;
  readonly planHash: string;
  readonly phase: "BUY" | "SELL";
  readonly marketCountry: "KR";
  readonly currency: "KRW";
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly orderType: "LIMIT";
  readonly timeInForce: "DAY";
  readonly quantity: bigint;
  readonly limitPriceMinor: bigint;
  readonly notionalMinor: bigint;
}

interface SealedPlanFixture {
  readonly accountId: string;
  readonly accountExternalRefHmac: string;
  readonly collectionRunId: string;
  readonly snapshotId: string;
  readonly targetConfigVersionId: string;
  readonly runId: string;
  readonly planId: string;
  readonly planHash: string;
  readonly mode: ExecutionMode;
  readonly orders: readonly PlanOrderFixture[];
}

interface LedgerOrderFixture {
  readonly id: string;
  readonly logicalOrderId: string;
  readonly clientOrderId: string;
  readonly canonicalIntent: string;
  readonly intentSha256: string;
}

function planOrderInput(
  symbol: string,
  quantity: bigint,
  limitPriceMinor: bigint,
  phase: "BUY" | "SELL" = "BUY",
) {
  return { symbol, quantity, limitPriceMinor, phase };
}

async function insertSealedPlan(
  client: PoolClient,
  mode: ExecutionMode,
  orderInputs: readonly ReturnType<typeof planOrderInput>[],
): Promise<SealedPlanFixture> {
  const accountId = randomUUID();
  const collectionRunId = randomUUID();
  const snapshotId = randomUUID();
  const configId = randomUUID();
  const targetConfigVersionId = randomUUID();
  const runId = randomUUID();
  const planId = randomUUID();
  const snapshotDigest = randomHex64();
  const targetContentHash = randomHex64();
  const accountExternalRefHmac = randomHex64();
  const canonicalContent = JSON.stringify({ mode, orders: orderInputs.length });
  const planHash = sha256Hex(canonicalContent);
  const now = Date.now();

  await client.query(
    `INSERT INTO public."broker_account" (
       "id", "broker", "external_ref_hmac", "masked_number", "account_type_raw", "last_seen_at"
     ) VALUES ($1, 'TOSS', $2, '***-ledger', 'SYNTHETIC', $3)`,
    [accountId, accountExternalRefHmac, new Date(now - 60_000)],
  );
  await client.query(`INSERT INTO public."target_config" ("id", "account_id") VALUES ($1, $2)`, [
    configId,
    accountId,
  ]);
  await client.query(
    `INSERT INTO public."target_config_version" (
       "id", "config_id", "version", "status", "content_hash", "app_version", "source", "cash_policy"
     ) VALUES ($1, $2, 1, 'ACTIVE', $3, 'integration-test', '{}'::JSONB,
       '{"mode":"EXCLUDED","version":"CASH_V1"}'::JSONB)`,
    [targetConfigVersionId, configId, targetContentHash],
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
       "id", "account_id", "snapshot_id", "snapshot_digest", "target_config_version_id",
       "target_config_content_hash", "mode", "status", "dedupe_key", "started_at",
       "app_version", "policy_version"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::public."RebalanceMode", 'RUNNING', $8,
       $9, 'integration-test', 'SHADOW_PLAN_V1')`,
    [
      runId,
      accountId,
      snapshotId,
      snapshotDigest,
      targetConfigVersionId,
      targetContentHash,
      mode,
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
     ) VALUES ($1, $2, $3, $4, $5::public."RebalanceMode", 'PLANNED', 'SHADOW_PLAN_V1',
       $6, 'BAND_EDGE', 100000, '["BUY_PHASE_READY"]'::JSONB, $7,
       '[]'::JSONB, '[]'::JSONB, '[]'::JSONB)`,
    [planId, runId, snapshotId, targetConfigVersionId, mode, planHash, canonicalContent],
  );

  const orders: PlanOrderFixture[] = [];
  for (const [index, input] of orderInputs.entries()) {
    const order: PlanOrderFixture = {
      id: randomUUID(),
      planVersion: 1,
      planHash,
      phase: input.phase,
      marketCountry: "KR",
      currency: "KRW",
      symbol: input.symbol,
      side: input.phase,
      orderType: "LIMIT",
      timeInForce: "DAY",
      quantity: input.quantity,
      limitPriceMinor: input.limitPriceMinor,
      notionalMinor: input.quantity * input.limitPriceMinor,
    };
    await client.query(
      `INSERT INTO public."rebalance_plan_order" (
         "id", "plan_id", "candidate_id", "phase", "ordinal", "asset_class_id",
         "instrument_key", "market_country", "currency", "symbol", "side",
         "order_type", "time_in_force", "quantity", "limit_price_minor",
         "notional_minor", "unallocated_minor"
       ) VALUES ($1, $2, $3, $4, $5, 'CORE', $6, 'KR', 'KRW', $7, $8,
         'LIMIT', 'DAY', $9, $10, $11, 0)`,
      [
        order.id,
        planId,
        `CORE:KR:${order.symbol}:${order.phase}`,
        order.phase,
        index,
        `KR:${order.symbol}`,
        order.symbol,
        order.side,
        order.quantity.toString(),
        order.limitPriceMinor.toString(),
        order.notionalMinor.toString(),
      ],
    );
    orders.push(order);
  }

  await client.query(
    `UPDATE public."rebalance_run"
     SET "status" = 'PLANNED', "completed_at" = $2
     WHERE "id" = $1`,
    [runId, new Date(now - 20_000)],
  );

  return {
    accountId,
    accountExternalRefHmac,
    collectionRunId,
    snapshotId,
    targetConfigVersionId,
    runId,
    planId,
    planHash,
    mode,
    orders,
  };
}

async function insertDailyLimit(
  client: PoolClient,
  fixture: SealedPlanFixture,
  grossLimitMinor: bigint,
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."daily_trade_limit" (
       "id", "account_id", "trade_day", "market_country", "currency", "mode", "gross_limit_minor"
     ) VALUES ($1, $2, $3::DATE, 'KR', 'KRW', $4::public."RebalanceMode", $5)`,
    [id, fixture.accountId, kstDateString(new Date()), fixture.mode, grossLimitMinor.toString()],
  );
  return id;
}

async function insertLedgerOrder(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  dailyLimitId: string,
  overrides: {
    readonly logicalOrderId?: string;
    readonly clientOrderId?: string;
    readonly canonicalIntent?: string;
    readonly reservedGrossMinor?: bigint;
    readonly reservationEvidenceId?: string;
  } = {},
): Promise<LedgerOrderFixture> {
  const id = randomUUID();
  const logicalOrderId = overrides.logicalOrderId ?? randomUUID();
  const canonical =
    overrides.canonicalIntent ?? canonicalIntent(logicalOrderId, fixture, planOrder);
  const clientOrderId = overrides.clientOrderId ?? tossClientOrderId(canonical);
  const reservedGrossMinor = overrides.reservedGrossMinor ?? planOrder.notionalMinor;
  const reservationBasisPriceMinor = reservedGrossMinor / planOrder.quantity;
  await client.query(
    `INSERT INTO public."order_ledger" (
       "id", "plan_id", "plan_order_id", "account_id", "daily_trade_limit_id", "mode",
       "logical_order_id", "client_order_id", "client_order_id_version",
       "canonical_intent", "intent_sha256", "plan_version", "phase",
       "market_country", "currency", "symbol", "side", "order_type",
       "time_in_force", "quantity", "limit_price_minor", "planned_gross_notional_minor",
       "reserved_gross_minor", "reservation_basis_price_minor", "reservation_policy_version",
       "reservation_evidence_id"
     ) VALUES ($1, $2, $3, $4, $5, $6::public."RebalanceMode", $7, $8,
       'TOSS_CLIENT_ORDER_ID_V1', $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20, $21, $22, $23, 'ORDER_GROSS_RESERVATION_V1', $24)`,
    [
      id,
      fixture.planId,
      planOrder.id,
      fixture.accountId,
      dailyLimitId,
      fixture.mode,
      logicalOrderId,
      clientOrderId,
      canonical,
      sha256Hex(canonical),
      planOrder.planVersion,
      planOrder.phase,
      planOrder.marketCountry,
      planOrder.currency,
      planOrder.symbol,
      planOrder.side,
      planOrder.orderType,
      planOrder.timeInForce,
      planOrder.quantity.toString(),
      planOrder.limitPriceMinor.toString(),
      planOrder.notionalMinor.toString(),
      reservedGrossMinor.toString(),
      reservationBasisPriceMinor.toString(),
      overrides.reservationEvidenceId ?? null,
    ],
  );
  return {
    id,
    logicalOrderId,
    clientOrderId,
    canonicalIntent: canonical,
    intentSha256: sha256Hex(canonical),
  };
}

async function insertState(
  client: PoolClient,
  orderId: string,
  sequence: number,
  state: NormalizedState,
  options: {
    readonly brokerStatusRaw?: string;
    readonly brokerOrderId?: string;
    readonly brokerActionId?: string;
    readonly brokerResponseEvidenceId?: string;
    readonly manualApprovalId?: string;
    readonly actor?: "EXECUTOR" | "RECONCILER" | "OPERATOR";
    readonly filledQuantity?: bigint;
    readonly filledGrossMinor?: bigint;
    readonly feeMinor?: bigint;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO public."order_state_history" (
       "order_id", "sequence", "normalized_state", "actor", "broker_status_raw",
       "broker_order_id", "broker_action_id", "broker_response_evidence_id",
       "manual_approval_id", "filled_quantity", "filled_gross_notional_minor",
       "fee_minor", "detail"
     ) VALUES ($1, $2, $3::public."OrderLedgerState", $4, $5, $6, $7, $8, $9, $10,
       $11, $12,
       '{"source":"integration-test"}'::JSONB)`,
    [
      orderId,
      sequence,
      state,
      options.actor ?? (state === "SUBMITTING" ? "EXECUTOR" : "RECONCILER"),
      options.brokerStatusRaw ?? null,
      options.brokerOrderId ?? null,
      options.brokerActionId ?? null,
      options.brokerResponseEvidenceId ?? null,
      options.manualApprovalId ?? null,
      (options.filledQuantity ?? 0n).toString(),
      (options.filledGrossMinor ?? 0n).toString(),
      (options.feeMinor ?? 0n).toString(),
    ],
  );
}

async function insertApproval(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  options: {
    readonly approvalHash?: string;
    readonly ttlMilliseconds?: number;
  } = {},
): Promise<string> {
  const id = randomUUID();
  const actor = "integration-operator";
  const confirmationVersion = "LIVE_ORDER_CONFIRMATION_V1";
  const createdAt = new Date(Date.now() - 250);
  const expiresAt = new Date(createdAt.getTime() + (options.ttlMilliseconds ?? 5 * 60 * 1_000));
  const canonicalContent = JSON.stringify({
    version: confirmationVersion,
    accountId: fixture.accountId,
    planOrderId: planOrder.id,
    planHash: fixture.planHash,
    actor,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  await client.query(
    `INSERT INTO public."manual_order_approval" (
       "id", "plan_order_id", "account_id", "approval_hash", "plan_hash", "actor",
       "confirmation_version", "canonical_content", "created_at", "expires_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      planOrder.id,
      fixture.accountId,
      options.approvalHash ?? sha256Hex(canonicalContent),
      fixture.planHash,
      actor,
      confirmationVersion,
      canonicalContent,
      createdAt,
      expiresAt,
    ],
  );
  return id;
}

async function insertCancelAuditClaim(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  order: LedgerOrderFixture,
  brokerOrderId: string,
): Promise<{
  readonly id: string;
  readonly authorizationId: string;
  readonly authorizedRequestDigest: string;
}> {
  const operatorAuthorizationId = randomUUID();
  const authorizationId = `cancel-auth-${randomUUID()}`;
  const actor = "integration-operator";
  const authorizedAt = new Date(Date.now() - 100);
  const expiresAt = new Date(authorizedAt.getTime() + 20_000);
  const authorizedRequestDigest = sha256Hex(
    JSON.stringify({
      version: "LIVE_ORDER_REQUEST_V1",
      action: "CANCEL",
      planId: fixture.planId,
      planOrderId: planOrder.id,
      logicalOrderId: order.logicalOrderId,
      accountId: fixture.accountId,
      brokerAccountReference: "synthetic-live-account-reference",
      clientOrderId: order.clientOrderId,
      brokerOrderId,
      economicTerms: null,
    }),
  );
  const operatorCanonical = JSON.stringify({
    version: "CANCEL_OPERATOR_AUTHORIZATION_V1",
    authorizationId,
    actor,
    action: "CANCEL",
    orderIdentity: {
      planId: fixture.planId,
      planOrderId: planOrder.id,
      logicalOrderId: order.logicalOrderId,
      accountId: fixture.accountId,
      clientOrderId: order.clientOrderId,
      brokerOrderId,
    },
    canonicalRequestDigest: authorizedRequestDigest,
    authorizedAt: authorizedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    evidenceReference: operatorAuthorizationId,
  });
  const operatorAuthorizationDigest = sha256Hex(operatorCanonical);
  await client.query(
    `INSERT INTO public."cancel_operator_authorization" (
       "id", "order_id", "authorization_id", "actor", "action",
       "confirmation_version", "canonical_content", "canonical_request_digest",
       "authorization_digest", "authorized_at", "expires_at"
     ) VALUES ($1, $2, $3, $4, 'CANCEL', 'CANCEL_ORDER_CONFIRMATION_V1',
       $5, $6, $7, $8, $9)`,
    [
      operatorAuthorizationId,
      order.id,
      authorizationId,
      actor,
      operatorCanonical,
      authorizedRequestDigest,
      operatorAuthorizationDigest,
      authorizedAt,
      expiresAt,
    ],
  );

  const id = randomUUID();
  const canonicalRequest = JSON.stringify({
    version: "ORDER_CANCEL_DISPATCH_CLAIM_V1",
    cancelDispatchClaimId: id,
    cancelOperatorAuthorizationId: operatorAuthorizationId,
    authorizationId,
    planId: fixture.planId,
    planVersion: planOrder.planVersion,
    planOrderId: planOrder.id,
    logicalOrderId: order.logicalOrderId,
    accountId: fixture.accountId,
    clientOrderId: order.clientOrderId,
    canonicalIntentSha256: order.intentSha256,
    authorizedRequestDigest,
    brokerAccountReferenceHmac: fixture.accountExternalRefHmac,
    brokerOrderId,
    ledgerState: "PENDING",
    operatorAuthorizationDigest,
    authorizationIssuedAt: authorizedAt.toISOString(),
    authorizationExpiresAt: expiresAt.toISOString(),
  });
  await client.query(
    `INSERT INTO public."order_cancel_dispatch_claim" (
       "id", "cancel_operator_authorization_id", "order_id", "authorization_id",
       "plan_id", "plan_version", "plan_order_id", "logical_order_id",
       "canonical_request", "claim_envelope_digest", "authorized_request_digest",
       "client_order_id", "broker_account_reference_hmac", "broker_order_id",
       "ledger_state", "operator_authorization_digest", "authorization_issued_at",
       "authorization_expires_at", "intent_audited_at", "dispatch_started_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       'PENDING', $15, $16, $17, statement_timestamp(), statement_timestamp())`,
    [
      id,
      operatorAuthorizationId,
      order.id,
      authorizationId,
      fixture.planId,
      planOrder.planVersion,
      planOrder.id,
      order.logicalOrderId,
      canonicalRequest,
      sha256Hex(canonicalRequest),
      authorizedRequestDigest,
      order.clientOrderId,
      fixture.accountExternalRefHmac,
      brokerOrderId,
      operatorAuthorizationDigest,
      authorizedAt,
      expiresAt,
    ],
  );
  return { id, authorizationId, authorizedRequestDigest };
}

async function insertBrokerAction(
  client: PoolClient,
  input: {
    readonly orderId: string;
    readonly originalBrokerOrderId: string;
    readonly brokerActionOrderId: string;
    readonly cancelDispatchClaimId: string;
    readonly authorizationId: string;
    readonly canonicalRequestDigest: string;
    readonly actionKind?: "CANCEL" | "REPLACE";
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."broker_order_action" (
       "id", "order_id", "action_kind", "original_broker_order_id",
       "broker_action_order_id", "broker_status_raw", "authorization_id",
       "cancel_dispatch_claim_id", "canonical_request_digest", "request_id",
       "http_status", "write_outcome", "redacted_body", "redaction_version", "observed_at"
     ) VALUES ($1, $2, $3::public."BrokerOrderActionKind", $4, $5, 'REQUEST_ACCEPTED',
       $6, $7, $8, 'request-action', 202, 'ACKNOWLEDGED', $9::JSONB,
       'ORDER_REDACTION_V1', statement_timestamp())`,
    [
      id,
      input.orderId,
      input.actionKind ?? "CANCEL",
      input.originalBrokerOrderId,
      input.brokerActionOrderId,
      input.authorizationId,
      input.cancelDispatchClaimId,
      input.canonicalRequestDigest,
      JSON.stringify({
        orderId: input.brokerActionOrderId,
        status: "REQUEST_ACCEPTED",
      }),
    ],
  );
  return id;
}

async function insertBrokerResponseEvidence(
  client: PoolClient,
  input: {
    readonly orderId: string;
    readonly evidenceKind: "SUBMIT" | "RECONCILE" | "CANCEL_ATTEMPT" | "REPLACE_ATTEMPT";
    readonly dispatchClaimId?: string;
    readonly brokerOrderId?: string;
    readonly brokerStatusRaw?: string;
    readonly safeErrorCode?: string;
    readonly httpStatus?: number | null;
    readonly writeOutcome?:
      "ACKNOWLEDGED" | "REJECTED" | "AMBIGUOUS" | "INTEGRITY_BLOCKED" | "OBSERVED";
  },
): Promise<string> {
  const id = randomUUID();
  const validatedNormalizedState = normalizedStateForEvidence(
    input.evidenceKind,
    input.brokerStatusRaw,
  );
  const writeOutcome =
    input.writeOutcome ??
    (input.evidenceKind === "RECONCILE"
      ? "OBSERVED"
      : input.evidenceKind === "SUBMIT"
        ? (input.brokerStatusRaw as "ACKNOWLEDGED" | "REJECTED" | "AMBIGUOUS" | "INTEGRITY_BLOCKED")
        : "REJECTED");
  await client.query(
    `INSERT INTO public."broker_order_response_evidence" (
       "id", "order_id", "evidence_kind", "dispatch_claim_id", "broker_order_id",
       "broker_status_raw", "normalization_version", "validated_normalized_state",
       "request_id", "http_status", "write_outcome", "safe_error_code", "redacted_body",
       "redaction_version", "observed_at"
     ) VALUES ($1, $2, $3::public."BrokerOrderEvidenceKind", $4, $5, $6,
       'TOSS_ORDER_NORMALIZATION_V1', $7::public."OrderLedgerState", 'request-evidence',
       $8, $9, $10, $11::JSONB, 'ORDER_REDACTION_V1', statement_timestamp())`,
    [
      id,
      input.orderId,
      input.evidenceKind,
      input.dispatchClaimId ?? null,
      input.brokerOrderId ?? null,
      input.brokerStatusRaw ?? null,
      validatedNormalizedState,
      input.httpStatus === undefined
        ? input.evidenceKind === "RECONCILE"
          ? 200
          : 422
        : input.httpStatus,
      writeOutcome,
      input.safeErrorCode ?? null,
      JSON.stringify({
        orderId: input.brokerOrderId ?? null,
        status: input.brokerStatusRaw ?? null,
        safeErrorCode: input.safeErrorCode ?? null,
      }),
    ],
  );
  return id;
}

function normalizedStateForEvidence(
  evidenceKind: "SUBMIT" | "RECONCILE" | "CANCEL_ATTEMPT" | "REPLACE_ATTEMPT",
  brokerStatusRaw: string | undefined,
): NormalizedState | null {
  if (evidenceKind === "SUBMIT") {
    if (brokerStatusRaw === "ACKNOWLEDGED" || brokerStatusRaw === "PENDING") return "PENDING";
    if (brokerStatusRaw === "REJECTED") return "REJECTED";
    if (brokerStatusRaw === "AMBIGUOUS") return "UNKNOWN";
    if (brokerStatusRaw === "INTEGRITY_BLOCKED") return "UNKNOWN_BLOCKED";
    return null;
  }
  if (evidenceKind === "RECONCILE") {
    if (brokerStatusRaw === "PENDING" || brokerStatusRaw === "PENDING_CANCEL") return "PENDING";
    if (brokerStatusRaw === "PARTIAL_FILLED") return "PARTIAL_FILLED";
    if (brokerStatusRaw === "FILLED") return "FILLED";
    if (brokerStatusRaw === "CANCELED") return "CANCELED";
    if (brokerStatusRaw === "REJECTED") return "REJECTED";
    return "UNKNOWN_BLOCKED";
  }
  if (brokerStatusRaw === "AMBIGUOUS") return "UNKNOWN";
  if (brokerStatusRaw === "INTEGRITY_BLOCKED") return "UNKNOWN_BLOCKED";
  return null;
}

async function insertKillSwitchEvent(
  client: PoolClient,
  accountId: string,
  version: number,
  state: "ENGAGED" | "DISENGAGED",
): Promise<void> {
  await client.query(
    `INSERT INTO public."kill_switch_event" (
       "account_id", "version", "state", "reason", "actor"
     ) VALUES ($1, $2, $3::public."KillSwitchState", 'integration-test', 'integration-test')`,
    [accountId, version, state],
  );
}

interface LiveEvidenceFixture {
  readonly executionRiskEvidenceId: string;
  readonly preSubmitEvidenceId: string;
  readonly reservationBasisPriceMinor: bigint;
  readonly reservedGrossMinor: bigint;
  readonly operationalConfigId: string;
  readonly operationalConfigVersionId: string;
  readonly operationalConfigCanonical: string;
  readonly operationalConfigSha256: string;
  readonly grantedPromotionId: string;
}

async function insertLivePreSubmitEvidence(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  options: {
    readonly accountReferenceHmac?: string;
    readonly includeAccountValidation?: boolean;
  } = {},
): Promise<LiveEvidenceFixture> {
  const evaluatedAt = new Date(Date.now() - 100);
  const expiresAt = new Date(evaluatedAt.getTime() + 20_000);
  const operationalConfig = JSON.stringify({
    schemaVersion: "OPERATIONAL_CONFIG_V1",
    mode: "LIVE",
    killSwitch: false,
    freshness: {
      quote: {
        planMaxAgeSeconds: 30,
        preSubmitMaxAgeSeconds: 30,
        futureToleranceSeconds: 5,
      },
      calendar: { maxAgeSeconds: 86_400, futureToleranceSeconds: 5 },
    },
    limits: {
      minimumOrderGrossMinor: "10000",
      feeBufferMinor: "5000",
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      maxDailyTurnoverBasisPoints: 500,
      maxAbsolutePriceChangeBasisPoints: 1_000,
      maxInstrumentWeightBasisPoints: 3000,
      maxAssetClassWeightBasisPoints: 7000,
      maxRiskyWeightBasisPoints: 8000,
    },
    live: {
      enabled: true,
      manualApprovalRequired: true,
      marketCountry: "KR",
      allowedSession: "REGULAR_MARKET",
      orderType: "LIMIT",
      timeInForce: "DAY",
      accountAllowlistHmacs: [fixture.accountExternalRefHmac],
      approvalTtlSeconds: 300,
      maxSingleOrderGrossMinor: "100000",
      maxDailyGrossMinor: "300000",
      tinyLiveMaxGrossMinor: "50000",
    },
  });
  const operationalConfigSha256 = sha256Hex(operationalConfig);
  const operationalConfigId = randomUUID();
  const operationalConfigVersionId = randomUUID();
  await client.query(
    `INSERT INTO public."operational_config" ("id", "account_id")
     VALUES ($1, $2)`,
    [operationalConfigId, fixture.accountId],
  );
  await client.query(
    `INSERT INTO public."operational_config_version" (
       "id", "config_id", "version", "schema_version", "canonical_content",
       "content_hash", "payload"
     ) VALUES ($1, $2, 1, 'OPERATIONAL_CONFIG_V1', $3, $4, $5::JSONB)`,
    [
      operationalConfigVersionId,
      operationalConfigId,
      operationalConfig,
      operationalConfigSha256,
      operationalConfig,
    ],
  );
  await client.query(
    `INSERT INTO public."operational_config_activation" (
       "config_id", "version", "operational_config_version_id", "actor",
       "confirmation_version"
     ) VALUES ($1, 1, $2, 'integration-operator',
       'OPERATIONAL_CONFIG_ACTIVATION_V1')`,
    [operationalConfigId, operationalConfigVersionId],
  );
  const revokedPromotionId = randomUUID();
  const grantedPromotionId = randomUUID();

  for (const [version, state, id] of [
    [1, "REVOKED", revokedPromotionId],
    [2, "GRANTED", grantedPromotionId],
  ] as const) {
    await client.query(
      `INSERT INTO public."live_promotion_event" (
         "id", "account_id", "version", "state", "operational_config_sha256",
         "operational_config_version_id", "account_allowlist_hmac",
         "max_single_order_gross_minor", "max_daily_gross_minor",
         "tiny_live_max_gross_minor", "actor", "reason"
       ) VALUES ($1, $2, $3, $4::public."LivePromotionState", $5, $6, $7,
         100000, 300000, 50000, 'integration-operator', 'integration-test')`,
      [
        id,
        fixture.accountId,
        version,
        state,
        operationalConfigSha256,
        operationalConfigVersionId,
        fixture.accountExternalRefHmac,
      ],
    );
  }

  const executionRiskEvidenceId = randomUUID();
  await client.query(
    `INSERT INTO public."execution_risk_evidence" (
       "id", "plan_id", "plan_version", "account_id", "promotion_event_id",
       "operational_config_canonical", "operational_config_sha256",
       "operational_config_version_id", "account_allowlist_hmac",
       "checks", "evaluated_at", "expires_at"
     ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9::JSONB, $10, $11)`,
    [
      executionRiskEvidenceId,
      fixture.planId,
      fixture.accountId,
      grantedPromotionId,
      operationalConfig,
      operationalConfigSha256,
      operationalConfigVersionId,
      fixture.accountExternalRefHmac,
      JSON.stringify(passedChecks(EXECUTION_RISK_CHECK_CODES)),
      evaluatedAt,
      expiresAt,
    ],
  );

  const priceObservedAt = new Date(evaluatedAt.getTime() - 20);
  const priceBody = {
    result: [
      {
        symbol: planOrder.symbol,
        currency: planOrder.currency,
        lastPrice: planOrder.limitPriceMinor.toString(),
        timestamp: priceObservedAt.toISOString(),
      },
    ],
  };
  const plannedPriceValidation = await insertPassedBrokerValidation(client, {
    correlationId: randomUUID(),
    collectionRunId: fixture.collectionRunId,
    workflowType: "COLLECTION",
    operationId: "getPrices",
    ordinal: 0,
    completedAt: priceObservedAt,
    requestSummary: { symbol: planOrder.symbol },
    redactedBody: priceBody,
  });
  const plannedPriceSnapshotId = randomUUID();
  await client.query(
    `INSERT INTO public."price_snapshot" (
       "id", "snapshot_id", "request_attempt_id", "market_country", "symbol",
       "currency", "last_price", "provider_observed_at", "received_at"
     ) VALUES ($1, $2, $3, 'KR', $4, 'KRW', $5, $6, $6)`,
    [
      plannedPriceSnapshotId,
      fixture.snapshotId,
      plannedPriceValidation.attemptId,
      planOrder.symbol,
      planOrder.limitPriceMinor.toString(),
      priceObservedAt,
    ],
  );

  const preSubmitEvidenceId = randomUUID();
  const lowerLimit = planOrder.limitPriceMinor / 2n;
  const upperLimit = planOrder.limitPriceMinor + planOrder.limitPriceMinor / 2n;
  const reservationBasisPriceMinor =
    planOrder.side === "BUY" ? planOrder.limitPriceMinor : upperLimit;
  const reservedGrossMinor = planOrder.quantity * reservationBasisPriceMinor;
  const accountValidation =
    options.includeAccountValidation === false
      ? null
      : await insertPassedBrokerValidation(client, {
          correlationId: preSubmitEvidenceId,
          workflowType: "PRE_SUBMIT",
          operationId: "getAccounts",
          ordinal: 0,
          completedAt: evaluatedAt,
          requestSummary: {},
          redactedBody: {
            result: [
              {
                accountReferenceHmac:
                  options.accountReferenceHmac ?? fixture.accountExternalRefHmac,
                accountNo: "***-ledger",
                accountType: "SYNTHETIC",
              },
            ],
          },
        });
  const validationInputs = [
    {
      operationId: "getPrices",
      requestSummary: { symbol: planOrder.symbol },
      redactedBody: {
        result: [
          {
            symbol: planOrder.symbol,
            currency: "KRW",
            lastPrice: planOrder.limitPriceMinor.toString(),
            timestamp: evaluatedAt.toISOString(),
          },
        ],
      },
    },
    {
      operationId: "getPriceLimit",
      requestSummary: { symbol: planOrder.symbol },
      redactedBody: {
        result: {
          currency: "KRW",
          lowerLimitPrice: lowerLimit.toString(),
          upperLimitPrice: upperLimit.toString(),
          timestamp: evaluatedAt.toISOString(),
        },
      },
    },
    {
      operationId: "getKrMarketCalendar",
      requestSummary: {},
      redactedBody: {
        result: {
          today: {
            date: kstDateString(evaluatedAt),
            integrated: {
              regularMarket: {
                startTime: new Date(evaluatedAt.getTime() - 60 * 60 * 1_000).toISOString(),
                endTime: new Date(evaluatedAt.getTime() + 60 * 60 * 1_000).toISOString(),
              },
            },
          },
        },
      },
    },
    {
      operationId: planOrder.side === "BUY" ? "getBuyingPower" : "getSellableQuantity",
      requestSummary: { symbol: planOrder.symbol, accountId: fixture.accountId },
      redactedBody:
        planOrder.side === "BUY"
          ? { result: { currency: "KRW", cashBuyingPower: "1000000" } }
          : { result: { sellableQuantity: planOrder.quantity.toString() } },
    },
    {
      operationId: "getStocks",
      requestSummary: { symbol: planOrder.symbol },
      redactedBody: {
        result: [
          {
            symbol: planOrder.symbol,
            name: "Synthetic stock",
            englishName: "Synthetic stock",
            isinCode: "KR7000000000",
            market: "KOSPI",
            securityType: "STOCK",
            isCommonShare: true,
            status: "ACTIVE",
            currency: "KRW",
            listDate: "2000-01-01",
            delistDate: null,
            sharesOutstanding: "1000000",
            leverageFactor: null,
            koreanMarketDetail: {
              liquidationTrading: false,
              nxtSupported: true,
              krxTradingSuspended: false,
              nxtTradingSuspended: false,
            },
          },
        ],
      },
    },
    {
      operationId: "getStockWarnings",
      requestSummary: { symbol: planOrder.symbol },
      redactedBody: { result: [] },
    },
    {
      operationId: "getOrders",
      requestSummary: { accountId: fixture.accountId },
      redactedBody: {
        result: {
          orders: [],
          nextCursor: null,
          hasNext: false,
        },
      },
    },
  ] as const;
  const validationIds: string[] = [];
  for (const [ordinal, input] of validationInputs.entries()) {
    const validation = await insertPassedBrokerValidation(client, {
      correlationId: preSubmitEvidenceId,
      workflowType: "PRE_SUBMIT",
      operationId: input.operationId,
      ordinal,
      completedAt: evaluatedAt,
      requestSummary: input.requestSummary,
      redactedBody: input.redactedBody,
    });
    validationIds.push(validation.validationId);
  }

  await client.query(
    `INSERT INTO public."pre_submit_evidence" (
       "id", "execution_risk_evidence_id", "plan_order_id", "account_id",
       "account_response_validation_id", "planned_price_snapshot_id",
       "quote_response_validation_id",
       "price_limit_response_validation_id", "calendar_response_validation_id",
       "capacity_response_validation_id", "instrument_response_validation_id",
       "warnings_response_validation_id", "open_orders_response_validation_id",
       "planned_quote_price_minor", "current_quote_price_minor", "lower_price_limit_minor",
       "upper_price_limit_minor", "reservation_basis_price_minor", "reserved_gross_minor",
       "checks", "evaluated_at", "expires_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $14, $15, $16, $17, $18, $19::JSONB, $20, $21)`,
    [
      preSubmitEvidenceId,
      executionRiskEvidenceId,
      planOrder.id,
      fixture.accountId,
      accountValidation?.validationId ?? null,
      plannedPriceSnapshotId,
      ...validationIds,
      planOrder.limitPriceMinor.toString(),
      lowerLimit.toString(),
      upperLimit.toString(),
      reservationBasisPriceMinor.toString(),
      reservedGrossMinor.toString(),
      JSON.stringify(passedChecks(preSubmitCheckCodes(planOrder.side))),
      evaluatedAt,
      expiresAt,
    ],
  );

  return {
    executionRiskEvidenceId,
    preSubmitEvidenceId,
    reservationBasisPriceMinor,
    reservedGrossMinor,
    operationalConfigId,
    operationalConfigVersionId,
    operationalConfigCanonical: operationalConfig,
    operationalConfigSha256,
    grantedPromotionId,
  };
}

async function insertPassedBrokerValidation(
  client: PoolClient,
  input: {
    readonly correlationId: string;
    readonly collectionRunId?: string;
    readonly workflowType: string;
    readonly operationId: string;
    readonly ordinal: number;
    readonly completedAt: Date;
    readonly requestSummary: unknown;
    readonly redactedBody: unknown;
  },
): Promise<{ readonly attemptId: string; readonly validationId: string }> {
  const attemptId = randomUUID();
  const validationId = randomUUID();
  await client.query(
    `INSERT INTO public."broker_request_attempt" (
       "id", "workflow_type", "correlation_id", "collection_run_id", "operation_id",
       "ordinal", "attempt", "rate_limit_group", "started_at", "completed_at",
       "outcome", "http_status", "redacted_request_summary"
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'integration-test', $7, $8,
       'SUCCEEDED', 200, $9::JSONB)`,
    [
      attemptId,
      input.workflowType,
      input.correlationId,
      input.collectionRunId ?? null,
      input.operationId,
      input.ordinal,
      new Date(input.completedAt.getTime() - 10),
      input.completedAt,
      JSON.stringify(input.requestSummary),
    ],
  );
  await client.query(
    `INSERT INTO public."broker_response_validation" (
       "id", "request_attempt_id", "operation_id", "outcome", "redacted_body",
       "body_sha256", "validated_at"
     ) VALUES ($1, $2, $3, 'PASSED', $4::JSONB, $5, $6)`,
    [
      validationId,
      attemptId,
      input.operationId,
      JSON.stringify(input.redactedBody),
      randomHex64(),
      input.completedAt,
    ],
  );
  return { attemptId, validationId };
}

function passedChecks(codes: readonly string[]): readonly { code: string; outcome: "PASSED" }[] {
  return codes.map((code) => ({ code, outcome: "PASSED" as const }));
}

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

const PRE_SUBMIT_BASE_CHECK_CODES = [
  "PRE_SUBMIT_EVIDENCE_IDENTITY_MATCHED",
  "QUOTE_FRESH",
  "PRICE_MOVEMENT_ACCEPTABLE",
  "PRICE_LIMIT_FRESH",
  "MARKET_SESSION_OPEN",
  "ORDER_PRICE_WITHIN_DAILY_LIMITS",
  "ORDER_RESERVATION_READY",
  "INSTRUMENT_WARNING_EVIDENCE_FRESH",
  "INSTRUMENT_TRADE_RESTRICTIONS_CLEAR",
  "BROKER_OPEN_ORDERS_RECONCILED",
  "NO_CONFLICTING_BROKER_OPEN_ORDER",
] as const;

function preSubmitCheckCodes(side: "BUY" | "SELL"): readonly string[] {
  return [
    ...PRE_SUBMIT_BASE_CHECK_CODES,
    ...(side === "BUY"
      ? ["BUYING_POWER_FRESH", "BUYING_POWER_SUFFICIENT"]
      : ["SELLABLE_QUANTITY_FRESH", "SELLABLE_QUANTITY_SUFFICIENT"]),
  ];
}

async function insertSubmissionAuthorization(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  order: LedgerOrderFixture,
  evidence: LiveEvidenceFixture,
  approvalId: string,
): Promise<{ readonly id: string; readonly reservationId: string; readonly expiresAt: Date }> {
  const reservation = await client.query<{ id: string }>(
    `SELECT "id" FROM public."daily_trade_reservation" WHERE "order_id" = $1`,
    [order.id],
  );
  const reservationId = reservation.rows[0]!.id;
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 8_000);
  const authorizedRequestDigestValue = liveAuthorizedRequestDigest(fixture, planOrder, order);
  const canonicalPreparation = JSON.stringify({
    version: "ORDER_SUBMISSION_AUTHORIZATION_V1",
    submissionAuthorizationId: id,
    planId: fixture.planId,
    planVersion: 1,
    planOrderId: planOrder.id,
    logicalOrderId: order.logicalOrderId,
    accountId: fixture.accountId,
    clientOrderId: order.clientOrderId,
    canonicalIntentSha256: order.intentSha256,
    authorizedRequestDigest: authorizedRequestDigestValue,
    brokerAccountReferenceHmac: fixture.accountExternalRefHmac,
    executionRiskEvidenceId: evidence.executionRiskEvidenceId,
    preSubmitEvidenceId: evidence.preSubmitEvidenceId,
    reservationId,
    approvalId,
    expiresAt: expiresAt.toISOString(),
  });
  await client.query(
    `INSERT INTO public."order_submission_authorization" (
       "id", "order_id", "logical_order_id", "plan_id", "plan_version", "plan_order_id",
       "canonical_preparation", "canonical_preparation_digest", "authorized_request_digest",
       "client_order_id",
       "broker_account_reference_hmac", "execution_risk_evidence_id",
       "pre_submit_evidence_id", "reservation_id", "approval_id", "expires_at"
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      order.id,
      order.logicalOrderId,
      fixture.planId,
      planOrder.id,
      canonicalPreparation,
      sha256Hex(canonicalPreparation),
      authorizedRequestDigestValue,
      order.clientOrderId,
      fixture.accountExternalRefHmac,
      evidence.executionRiskEvidenceId,
      evidence.preSubmitEvidenceId,
      reservationId,
      approvalId,
      expiresAt,
    ],
  );
  return { id, reservationId, expiresAt };
}

async function insertNonDispatchEvidence(
  client: PoolClient,
  input: {
    readonly submissionAuthorizationId: string;
    readonly orderId: string;
    readonly actor?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."order_non_dispatch_evidence" (
       "id", "submission_authorization_id", "order_id", "actor"
     ) VALUES ($1, $2, $3, $4)`,
    [id, input.submissionAuthorizationId, input.orderId, input.actor ?? "integration-recovery"],
  );
  return id;
}

async function insertPreAuthorizationNonDispatchEvidence(
  client: PoolClient,
  input: {
    readonly orderId: string;
    readonly reservationId: string;
    readonly actor?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO public."order_pre_auth_non_dispatch_evidence" (
       "id", "order_id", "reservation_id", "actor"
     ) VALUES ($1, $2, $3, $4)`,
    [id, input.orderId, input.reservationId, input.actor ?? "integration-recovery"],
  );
  return id;
}

async function insertDispatchClaim(
  client: PoolClient,
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  order: LedgerOrderFixture,
  evidence: LiveEvidenceFixture,
  approvalId: string,
  submissionAuthorization: {
    readonly id: string;
    readonly reservationId: string;
    readonly expiresAt: Date;
  },
  options: { readonly authorizedRequestDigest?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const authorizationId = `submit-auth-${randomUUID()}`;
  const authorizationIssuedAt = new Date(Date.now() - 20);
  const authorizationExpiresAt = new Date(
    Math.min(Date.now() + 5_000, submissionAuthorization.expiresAt.getTime() - 1),
  );
  const authorizedRequestDigestValue =
    options.authorizedRequestDigest ?? liveAuthorizedRequestDigest(fixture, planOrder, order);
  const canonicalRequest = JSON.stringify({
    version: "ORDER_DISPATCH_CLAIM_V1",
    dispatchClaimId: id,
    submissionAuthorizationId: submissionAuthorization.id,
    authorizationId,
    planId: fixture.planId,
    planVersion: 1,
    planOrderId: planOrder.id,
    logicalOrderId: order.logicalOrderId,
    accountId: fixture.accountId,
    clientOrderId: order.clientOrderId,
    canonicalIntentSha256: order.intentSha256,
    authorizedRequestDigest: authorizedRequestDigestValue,
    brokerAccountReferenceHmac: fixture.accountExternalRefHmac,
    executionRiskEvidenceId: evidence.executionRiskEvidenceId,
    preSubmitEvidenceId: evidence.preSubmitEvidenceId,
    reservationId: submissionAuthorization.reservationId,
    approvalId,
    authorizationIssuedAt: authorizationIssuedAt.toISOString(),
    authorizationExpiresAt: authorizationExpiresAt.toISOString(),
  });
  await client.query(
    `INSERT INTO public."order_dispatch_claim" (
       "id", "submission_authorization_id", "order_id", "logical_order_id",
       "authorization_id", "plan_id", "plan_version", "plan_order_id",
       "canonical_request", "claim_envelope_digest", "authorized_request_digest",
       "client_order_id",
       "broker_account_reference_hmac", "authorization_issued_at",
       "authorization_expires_at", "intent_audited_at", "dispatch_started_at"
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
    [
      id,
      submissionAuthorization.id,
      order.id,
      order.logicalOrderId,
      authorizationId,
      fixture.planId,
      planOrder.id,
      canonicalRequest,
      sha256Hex(canonicalRequest),
      authorizedRequestDigestValue,
      order.clientOrderId,
      fixture.accountExternalRefHmac,
      authorizationIssuedAt,
      authorizationExpiresAt,
      new Date(),
    ],
  );
  return id;
}

function liveAuthorizedRequestDigest(
  fixture: SealedPlanFixture,
  planOrder: PlanOrderFixture,
  order: LedgerOrderFixture,
): string {
  return sha256Hex(
    JSON.stringify({
      version: "LIVE_ORDER_REQUEST_V1",
      action: "SUBMIT",
      planId: fixture.planId,
      planOrderId: planOrder.id,
      logicalOrderId: order.logicalOrderId,
      accountId: fixture.accountId,
      brokerAccountReference: "synthetic-live-account-reference",
      clientOrderId: order.clientOrderId,
      brokerOrderId: null,
      economicTerms: {
        marketCountry: planOrder.marketCountry,
        currency: planOrder.currency,
        symbol: planOrder.symbol,
        side: planOrder.side,
        orderType: planOrder.orderType,
        timeInForce: planOrder.timeInForce,
        quantity: planOrder.quantity.toString(),
        limitPriceMinor: planOrder.limitPriceMinor.toString(),
      },
    }),
  );
}

function canonicalIntent(
  logicalOrderId: string,
  fixture: SealedPlanFixture,
  order: PlanOrderFixture,
  overrides: { readonly quantity?: string } = {},
): string {
  return JSON.stringify({
    version: "TOSS_CLIENT_ORDER_ID_V1",
    logicalOrderId,
    rebalanceRunId: fixture.runId,
    planId: fixture.planId,
    planVersion: order.planVersion,
    planHash: order.planHash,
    phase: order.phase,
    marketCountry: order.marketCountry,
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    quantity: overrides.quantity ?? order.quantity.toString(),
    price: order.limitPriceMinor.toString(),
  });
}

function tossClientOrderId(canonical: string): string {
  return `pr1_${createHash("sha256").update(canonical).digest("base64url").slice(0, 32)}`;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function kstDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function assertIsolatedTestDatabase(connectionString: string): void {
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(^|[_-])(test|testing)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "PORTFOLIO_REBALANCER_DATABASE_INTEGRATION_URL must target a database whose name contains test",
    );
  }
}
