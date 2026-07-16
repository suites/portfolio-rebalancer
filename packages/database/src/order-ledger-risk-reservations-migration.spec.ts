import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716167000_order_ledger_risk_reservations/migration.sql",
  ),
  "utf8",
);

const functionSql = (name: string): string => {
  const starts = [
    migrationSql.lastIndexOf(`CREATE FUNCTION public.${name}(`),
    migrationSql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
  ];
  const start = Math.max(...starts);
  if (start < 0) {
    throw new Error(`migration function not found: ${name}`);
  }

  const end = migrationSql.indexOf("\n$$;", start);
  if (end < 0) {
    throw new Error(`migration function is not terminated: ${name}`);
  }

  return migrationSql.slice(start, end + "\n$$;".length);
};

describe("order ledger and risk reservation migration", () => {
  it("logical order와 clientOrderId를 plan version까지 포함한 canonical intent에서 고정한다", () => {
    const ledgerGuard = functionSql("guard_order_ledger");

    expect(migrationSql).toContain('CREATE TABLE public."order_ledger"');
    expect(migrationSql).toContain('"order_ledger_logical_order_id_key"');
    expect(migrationSql).toContain('"order_ledger_client_order_id_key"');
    expect(migrationSql).toContain("CREATE FUNCTION public.expected_toss_client_order_id");
    expect(migrationSql).toContain("'^pr1_[A-Za-z0-9_-]{32}$'");
    expect(ledgerGuard).toContain("'planId', linked_plan_id::TEXT");
    expect(ledgerGuard).toContain("'planVersion', NEW.\"plan_version\"");
    expect(ledgerGuard).toContain("'planHash', linked_plan_hash::TEXT");
    expect(ledgerGuard).toContain("canonical order intent does not match immutable ledger columns");
    expect(ledgerGuard).toContain("order intent is immutable");
  });

  it("Phase A 이후 refreshed snapshot으로만 Phase B BUY plan version 2를 연다", () => {
    const versionGuard = functionSql("guard_rebalance_plan_version");
    const planOrderGuard = functionSql("guard_rebalance_plan_order");

    expect(migrationSql).toContain('CREATE TABLE public."rebalance_plan_version"');
    expect(migrationSql).toContain('ADD COLUMN "plan_version" INTEGER NOT NULL DEFAULT 1');
    expect(migrationSql).toContain('"rebalance_plan_version_plan_version_key"');
    expect(migrationSql).toContain('"rebalance_plan_order_plan_version_candidate_key"');
    expect(migrationSql).toContain('"rebalance_plan_order_plan_version_phase_ordinal_key"');
    expect(migrationSql).toContain(
      'REFERENCES public."rebalance_plan_version"("plan_id", "version")',
    );
    expect(functionSql("initialize_rebalance_plan_version")).toContain("'INITIAL'");

    expect(versionGuard).toContain("latest_version IS DISTINCT FROM 1");
    expect(versionGuard).toContain('NEW."version" <> 2');
    expect(versionGuard).toContain("NEW.\"phase\" IS DISTINCT FROM 'BUY'");
    expect(versionGuard).toContain("snapshot_validation_status IS DISTINCT FROM 'VERIFIED'");
    expect(versionGuard).toContain('latest_snapshot_id IS DISTINCT FROM NEW."snapshot_id"');
    expect(versionGuard).toContain("snapshot_observed_at <= previous_terminal_at");
    expect(versionGuard).toContain("previous_non_sell_count <> 0");
    expect(versionGuard).toContain("previous_unresolved_count <> 0");
    expect(versionGuard).toContain(
      "Phase B version 2 requires a refreshed verified snapshot after all Phase A SELL orders are terminal",
    );
    expect(planOrderGuard).toContain(
      "(NEW.\"plan_version\" = 2 AND run_status IS DISTINCT FROM 'PLANNED')",
    );
    expect(planOrderGuard).toContain(
      "plan orders must belong to an open matching plan version and saga phase",
    );
  });

  it("LIVE 실행 위험과 pre-submit 증거를 최신 snapshot 및 broker validation에 고정한다", () => {
    const riskGuard = functionSql("guard_execution_risk_evidence");
    const preSubmitGuard = functionSql("guard_pre_submit_evidence");

    expect(migrationSql).toContain('CREATE TABLE public."execution_risk_evidence"');
    expect(migrationSql).toContain('CREATE TABLE public."pre_submit_evidence"');
    expect(migrationSql).toContain('"expires_at" <= "evaluated_at" + INTERVAL \'30 seconds\'');

    expect(riskGuard).toContain("latest_snapshot_id IS DISTINCT FROM plan_snapshot_id");
    expect(riskGuard).toContain("promotion_state IS DISTINCT FROM 'GRANTED'");
    expect(riskGuard).toContain('latest_promotion_id IS DISTINCT FROM NEW."promotion_event_id"');
    for (const check of [
      "KILL_SWITCH_RELEASED",
      "PLAN_IDENTITY_CURRENT",
      "NO_UNRESOLVED_ORDERS",
      "LIVE_EXPLICITLY_ENABLED",
      "LIVE_ACCOUNT_ALLOWLISTED",
      "LIVE_MANUAL_APPROVAL_VALID",
    ]) {
      expect(riskGuard).toContain(`'${check}'`);
    }
    expect(riskGuard).toContain('NEW."expires_at" <= pg_catalog.statement_timestamp()');

    for (const operation of [
      "getPrices",
      "getPriceLimit",
      "getKrMarketCalendar",
      "getBuyingPower",
      "getSellableQuantity",
      "getStocks",
      "getStockWarnings",
      "getOrders",
    ]) {
      expect(preSubmitGuard).toContain(`'${operation}'`);
    }
    for (const check of [
      "QUOTE_FRESH",
      "PRICE_LIMIT_FRESH",
      "MARKET_SESSION_OPEN",
      "BUYING_POWER_FRESH",
      "BUYING_POWER_SUFFICIENT",
      "SELLABLE_QUANTITY_FRESH",
      "SELLABLE_QUANTITY_SUFFICIENT",
      "INSTRUMENT_WARNING_EVIDENCE_FRESH",
      "INSTRUMENT_TRADE_RESTRICTIONS_CLEAR",
      "BROKER_OPEN_ORDERS_RECONCILED",
      "NO_CONFLICTING_BROKER_OPEN_ORDER",
    ]) {
      expect(preSubmitGuard).toContain(`'${check}'`);
    }
    expect(preSubmitGuard).toContain('attempt_correlation_id IS DISTINCT FROM NEW."id"');
    expect(preSubmitGuard).toContain(
      "pre-submit evidence requires fresh, passed broker validations with exact operation and request scope",
    );
    expect(preSubmitGuard).toContain(
      'NEW."reservation_basis_price_minor" IS DISTINCT FROM order_limit_price',
    );
    expect(preSubmitGuard).toContain(
      'NEW."reservation_basis_price_minor" IS DISTINCT FROM upper_limit',
    );
    expect(preSubmitGuard).toContain(
      "SELL capacity or verified upper-limit reservation basis is insufficient",
    );
    expect(preSubmitGuard).toContain(
      "pg_catalog.jsonb_array_length(validation_bodies[7] #> '{result,orders}') <> 0",
    );
    expect(preSubmitGuard).toContain(
      "FROM pg_catalog.jsonb_array_elements(validation_bodies[5] -> 'result') AS item",
    );
    expect(preSubmitGuard).toContain("stock_item_count IS DISTINCT FROM 1");
  });

  it("KR 현재 거래일 한도를 잠그고 검증된 reservation basis로만 금액을 예약한다", () => {
    const ledgerGuard = functionSql("guard_order_ledger");
    const reservationGuard = functionSql("guard_daily_trade_reservation");

    expect(migrationSql).toContain('CREATE TABLE public."daily_trade_limit"');
    expect(migrationSql).toContain('CREATE TABLE public."daily_trade_reservation"');
    expect(migrationSql).toContain(
      '"trade_day" = ("created_at" AT TIME ZONE \'Asia/Seoul\')::DATE',
    );
    expect(ledgerGuard).toContain(
      "limit_trade_day IS DISTINCT FROM (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Seoul')::DATE",
    );
    expect(ledgerGuard).toContain(
      "order intent daily limit scope does not match its account, market, currency and mode",
    );
    expect(ledgerGuard).toContain(
      'reservation_evidence_basis IS DISTINCT FROM NEW."reservation_basis_price_minor"',
    );
    expect(ledgerGuard).toContain(
      'reservation_evidence_reserved IS DISTINCT FROM NEW."reserved_gross_minor"',
    );
    expect(ledgerGuard).toContain(
      "LIVE order reservation must use its exact unexpired pre-submit evidence",
    );

    expect(reservationGuard).toContain("FOR UPDATE;");
    expect(reservationGuard).toContain(
      'current_usage + NEW."reserved_gross_minor"::NUMERIC > daily_limit_minor::NUMERIC',
    );
    expect(reservationGuard).toContain("daily KR gross trade limit would be exceeded");
    expect(reservationGuard).toContain(
      'NEW."filled_gross_minor" + NEW."released_gross_minor" > NEW."reserved_gross_minor"',
    );
    expect(migrationSql).toContain('"reserved_gross_minor" <= 100000');
    expect(migrationSql).toContain('"gross_limit_minor" <= 300000');
  });

  it("OrderSubmissionAuthorization이 증거와 승인을 소비하고 SUBMITTING을 원자적으로 기록한다", () => {
    const authorizationGuard = functionSql("guard_order_submission_authorization");
    const authorizationInitializer = functionSql("initialize_order_submission_authorization");

    expect(migrationSql).toContain('CREATE TABLE public."order_submission_authorization"');
    for (const uniqueIndex of [
      "order_submission_authorization_order_id_key",
      "order_submission_authorization_logical_order_id_key",
      "order_submission_authorization_client_order_id_key",
      "order_submission_authorization_reservation_id_key",
      "order_submission_authorization_approval_id_key",
    ]) {
      expect(migrationSql).toContain(`"${uniqueIndex}"`);
    }
    expect(migrationSql).toContain('"expires_at" <= "prepared_at" + INTERVAL \'30 seconds\'');
    expect(authorizationGuard).toContain('NEW."prepared_at" := pg_catalog.statement_timestamp()');
    expect(authorizationGuard).toContain("latest_state IS DISTINCT FROM 'PLANNED'");
    expect(authorizationGuard).toContain('risk_expires_at <= NEW."prepared_at"');
    expect(authorizationGuard).toContain('pre_expires_at <= NEW."prepared_at"');
    expect(authorizationGuard).toContain("approval_consumed_at IS NOT NULL");
    expect(authorizationGuard).toContain(
      "submission authorization must exclusively bind fresh LIVE risk, pre-submit, reservation, approval and kill-switch evidence",
    );
    expect(authorizationGuard).toContain("'version', 'ORDER_SUBMISSION_AUTHORIZATION_V1'");
    expect(migrationSql).toContain('"authorized_request_digest" CHAR(64) NOT NULL');
    expect(authorizationGuard).toContain(
      "'authorizedRequestDigest', NEW.\"authorized_request_digest\"::TEXT",
    );
    expect(authorizationGuard).toContain('UPDATE public."manual_order_approval"');
    expect(authorizationInitializer).toContain('INSERT INTO public."order_state_history"');
    expect(authorizationInitializer).toContain("'SUBMITTING'");
    expect(authorizationInitializer).toContain('"submission_authorization_id"');
  });

  it("OrderDispatchClaim을 제출 직전 한 번만 만들고 canonical broker request를 감사한다", () => {
    const dispatchGuard = functionSql("guard_order_dispatch_claim");

    expect(migrationSql).toContain('CREATE TABLE public."order_dispatch_claim"');
    for (const uniqueIndex of [
      "order_dispatch_claim_submission_authorization_id_key",
      "order_dispatch_claim_order_id_key",
      "order_dispatch_claim_logical_order_id_key",
      "order_dispatch_claim_authorization_id_key",
      "order_dispatch_claim_client_order_id_key",
    ]) {
      expect(migrationSql).toContain(`"${uniqueIndex}"`);
    }
    expect(migrationSql).toContain(
      '"authorization_expires_at" <= "authorization_issued_at" + INTERVAL \'30 seconds\'',
    );
    expect(migrationSql).toContain('"dispatch_started_at" < "authorization_expires_at"');
    expect(dispatchGuard).toContain('NEW."claimed_at" := pg_catalog.statement_timestamp()');
    expect(dispatchGuard).toContain('NEW."intent_audited_at" := NEW."claimed_at"');
    expect(dispatchGuard).toContain('NEW."dispatch_started_at" := NEW."claimed_at"');
    expect(dispatchGuard).toContain("latest_state IS DISTINCT FROM 'SUBMITTING'");
    expect(dispatchGuard).toContain(
      'latest_state_authorization_id IS DISTINCT FROM NEW."submission_authorization_id"',
    );
    expect(dispatchGuard).toContain('auth_expires_at <= NEW."claimed_at"');
    expect(dispatchGuard).toContain(
      "dispatch claim must be the first one-time audit of the exact unexpired SUBMITTING authorization",
    );
    expect(dispatchGuard).toContain("'version', 'ORDER_DISPATCH_CLAIM_V1'");
    expect(migrationSql).toContain('"claim_envelope_digest" CHAR(64) NOT NULL');
    expect(dispatchGuard).toContain(
      'auth_authorized_request_digest IS DISTINCT FROM NEW."authorized_request_digest"',
    );
    expect(dispatchGuard).toContain(
      "dispatch canonical request does not match its immutable claim columns",
    );
  });

  it("broker 원문을 sealed normalization policy로 검증하고 정확한 dispatch claim과 상태에 연결한다", () => {
    const normalization = functionSql("expected_broker_normalized_state");
    const evidenceGuard = functionSql("guard_broker_order_response_evidence");
    const stateGuard = functionSql("guard_order_state_history");

    expect(migrationSql).toContain('CREATE TABLE public."broker_order_response_evidence"');
    expect(migrationSql).toContain('"validated_normalized_state" public."OrderLedgerState"');
    expect(migrationSql).toContain('"dispatch_claim_id" UUID');
    expect(migrationSql).toContain('"request_id" TEXT');
    expect(migrationSql).toContain('"http_status" INTEGER');
    expect(migrationSql).toContain('"write_outcome" TEXT NOT NULL');
    for (const kind of ["SUBMIT", "RECONCILE", "CANCEL_ATTEMPT", "REPLACE_ATTEMPT"]) {
      expect(migrationSql).toContain(`'${kind}'`);
    }
    expect(normalization).toContain("evidence_kind = 'SUBMIT' AND broker_status_raw = 'AMBIGUOUS'");
    expect(normalization).toContain("evidence_kind = 'RECONCILE' AND broker_status_raw = 'FILLED'");
    expect(normalization).toContain("THEN 'UNKNOWN_BLOCKED'::public.\"OrderLedgerState\"");

    expect(evidenceGuard).toContain(
      "NEW.\"normalization_version\" IS DISTINCT FROM 'TOSS_ORDER_NORMALIZATION_V1'",
    );
    expect(evidenceGuard).toContain(
      'expected_state IS DISTINCT FROM NEW."validated_normalized_state"',
    );
    expect(evidenceGuard).toContain(
      "broker response evidence normalized outcome does not match the sealed normalization policy",
    );
    expect(evidenceGuard).toContain(
      "broker order response evidence requires an existing LIVE logical order",
    );
    expect(evidenceGuard).toContain('claim_order_id IS DISTINCT FROM NEW."order_id"');
    expect(evidenceGuard).toContain('NEW."observed_at" < claim_dispatch_started_at');
    expect(evidenceGuard).toContain(
      "SUBMIT response evidence must bind its exact dispatch claim, HTTP outcome and broker order ID",
    );
    expect(evidenceGuard).toContain("NEW.\"write_outcome\" = 'INTEGRITY_BLOCKED'");
    expect(evidenceGuard).toContain(
      "RECONCILE evidence must be an observed broker order or a sealed integrity block",
    );

    expect(stateGuard).toContain(
      'evidence_validated_state IS DISTINCT FROM NEW."normalized_state"::TEXT',
    );
    expect(stateGuard).toContain(
      "normalized state must match its exact validated broker response evidence",
    );
    expect(stateGuard).toContain(
      "dispatch_authorization_id IS DISTINCT FROM previous_submission_authorization_id",
    );
    expect(stateGuard).toContain(
      "first LIVE broker outcome must bind the exact one-time dispatch claim",
    );
    expect(stateGuard).toContain(
      'known_broker_order_id IS NOT NULL AND NEW."broker_order_id" IS DISTINCT FROM known_broker_order_id',
    );
    expect(stateGuard).toContain(
      "every LIVE broker state requires append-only validated response evidence",
    );
    expect(stateGuard).toContain(
      "PAPER state events must keep broker fields empty and store simulator evidence in detail",
    );
  });

  it("cancel child action, UNKNOWN_BLOCKED 복구와 manual approval를 원 주문과 분리해 보존한다", () => {
    const stateGuard = functionSql("guard_order_state_history");

    expect(migrationSql).toContain('CREATE TABLE public."broker_order_action"');
    expect(migrationSql).toContain('"original_broker_order_id" TEXT NOT NULL');
    expect(migrationSql).toContain('"broker_action_order_id" TEXT NOT NULL');
    expect(migrationSql).toContain('"original_broker_order_id" <> "broker_action_order_id"');
    expect(migrationSql).toContain("\"broker_status_raw\" = 'REQUEST_ACCEPTED'");
    expect(functionSql("guard_broker_order_action")).toContain(
      "broker order action requires an existing LIVE logical order",
    );
    expect(stateGuard).toContain(
      "cancel or replace rejection cannot mutate the original logical order state",
    );
    expect(stateGuard).toContain(
      "CANCELED may reference only an accepted CANCEL child action plus final broker evidence",
    );
    expect(stateGuard).toContain(
      "UNKNOWN_BLOCKED recovery requires OPERATOR and exact reconciliation evidence",
    );
    expect(stateGuard).toContain("OPERATOR actor is reserved for UNKNOWN_BLOCKED recovery");
    expect(stateGuard).toContain(
      "LIVE SUBMITTING requires its atomic submission authorization and consumed approval",
    );
    expect(stateGuard).toContain("PAPER submission must not consume LIVE authorization state");
  });

  it("모든 감사 guard를 고정 search_path의 ALWAYS trigger와 개별 TRUNCATE guard로 설치한다", () => {
    const guardedTriggers: Array<[table: string, trigger: string]> = [
      ["daily_trade_limit", "daily_trade_limit_guard"],
      ["rebalance_plan", "rebalance_plan_initialize_version"],
      ["rebalance_plan_version", "rebalance_plan_version_guard"],
      ["live_promotion_event", "live_promotion_event_guard"],
      ["execution_risk_evidence", "execution_risk_evidence_guard"],
      ["pre_submit_evidence", "pre_submit_evidence_guard"],
      ["order_ledger", "order_ledger_guard"],
      ["order_ledger", "order_ledger_initialize"],
      ["order_state_history", "order_state_history_guard"],
      ["broker_order_action", "broker_order_action_guard"],
      ["broker_order_response_evidence", "broker_order_response_evidence_guard"],
      ["daily_trade_reservation", "daily_trade_reservation_guard"],
      ["order_submission_authorization", "order_submission_authorization_guard"],
      ["order_submission_authorization", "order_submission_authorization_initialize"],
      ["order_dispatch_claim", "order_dispatch_claim_guard"],
      ["manual_order_approval", "manual_order_approval_guard"],
      ["kill_switch_event", "kill_switch_event_guard"],
    ];
    const truncatedTables = [
      "daily_trade_limit",
      "rebalance_plan_version",
      "live_promotion_event",
      "execution_risk_evidence",
      "pre_submit_evidence",
      "order_ledger",
      "order_state_history",
      "broker_order_action",
      "broker_order_response_evidence",
      "daily_trade_reservation",
      "order_submission_authorization",
      "order_dispatch_claim",
      "manual_order_approval",
      "kill_switch_event",
    ];
    const protectedFunctions = [
      "expected_toss_client_order_id",
      "has_required_passed_checks",
      "expected_broker_normalized_state",
      "guard_live_promotion_event",
      "guard_execution_risk_evidence",
      "guard_pre_submit_evidence",
      "guard_order_submission_authorization",
      "initialize_order_submission_authorization",
      "guard_order_dispatch_claim",
      "guard_daily_trade_limit",
      "guard_order_ledger",
      "guard_broker_order_action",
      "guard_broker_order_response_evidence",
      "guard_daily_trade_reservation",
      "guard_manual_order_approval",
      "guard_kill_switch_event",
      "guard_order_state_history",
      "initialize_rebalance_plan_version",
      "guard_rebalance_plan_version",
      "guard_rebalance_plan_order",
      "initialize_order_ledger",
      "reject_order_ledger_truncate",
    ];

    for (const name of protectedFunctions) {
      expect(functionSql(name), `${name} search_path`).toContain("SET search_path TO pg_catalog");
    }

    for (const [table, trigger] of guardedTriggers) {
      expect(migrationSql).toContain(
        `ALTER TABLE public."${table}" ENABLE ALWAYS TRIGGER "${trigger}";`,
      );
    }

    expect(migrationSql).toContain("CREATE FUNCTION public.reject_order_ledger_truncate()");
    for (const table of truncatedTables) {
      const trigger = `${table}_truncate_guard`;
      expect(migrationSql).toContain(`CREATE TRIGGER ${trigger}`);
      expect(migrationSql).toContain(`BEFORE TRUNCATE ON public."${table}"`);
      expect(migrationSql).toContain(
        `ALTER TABLE public."${table}" ENABLE ALWAYS TRIGGER "${trigger}";`,
      );
    }
  });
});
