import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716165000_market_snapshot_payload_provenance/migration.sql",
  ),
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

describe("market snapshot payload provenance migration", () => {
  it("모든 trigger function을 public에 고정하고 pg_catalog 외 search_path를 제거한다", () => {
    for (const functionName of [
      "reject_immutable_change",
      "require_running_collection_run",
      "require_running_collection_snapshot",
      "require_succeeded_broker_response_attempt",
      "require_running_collection_run_for_attempt",
      "guard_collection_run_terminal_timeline",
      "require_market_snapshot_provenance",
    ]) {
      expect(migrationSql).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}()`);
    }

    expect(migrationSql.match(/SET search_path TO pg_catalog/g)).toHaveLength(7);
    expect(migrationSql).toContain('FROM public."collection_run"');
    expect(migrationSql).toContain('FROM public."portfolio_snapshot" AS snapshot');
    expect(migrationSql).toContain('FROM public."broker_request_attempt"');
    expect(migrationSql).toContain('JOIN public."broker_response_validation" AS validation');
    expect(migrationSql).toContain("TG_TABLE_SCHEMA <> 'public'");
  });

  it("선행 terminal timeline의 row-lock 직렬화 semantics를 유지한다", () => {
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.require_running_collection_run_for_attempt()",
    );
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION public.guard_collection_run_terminal_timeline()",
    );
    expect(migrationSql.match(/FOR UPDATE(?: OF run)?;/g)).toHaveLength(4);
    expect(migrationSql).toContain('FROM public."broker_request_attempt"');
    expect(migrationSql).toContain('FROM public."broker_response_validation" AS validation');
  });

  it("가격 행을 검증 통과 원문의 단일 result 항목과 정확히 대조한다", () => {
    expect(migrationSql).toContain(
      "pg_catalog.jsonb_typeof(response_validation_body -> 'result') IS DISTINCT FROM 'array'",
    );
    expect(migrationSql).toContain(
      "FROM pg_catalog.jsonb_array_elements(response_validation_body -> 'result') AS item(value)",
    );
    expect(migrationSql).toContain("matching_price_item_count <> 1");
    expect(migrationSql).toContain("item.value ->> 'symbol' = NEW.\"symbol\"");
    expect(migrationSql).toContain(
      "matching_price_item ->> 'currency' IS DISTINCT FROM NEW.\"currency\"",
    );
    expect(migrationSql).toContain(
      "matching_price_item ->> 'lastPrice' IS DISTINCT FROM NEW.\"last_price\"",
    );
    expect(migrationSql).toContain("matching_price_item ->> 'timestamp'");
    expect(migrationSql).toContain(
      'NEW."provider_observed_at" IS DISTINCT FROM raw_price_timestamp::TIMESTAMPTZ',
    );
  });

  it("가격·캘린더 수신시각과 캘린더 기준일을 원 요청 증거에 묶는다", () => {
    expect(migrationSql).toContain('NEW."received_at" IS DISTINCT FROM attempt_completed_at');
    expect(migrationSql).toContain("raw_calendar_result -> 'today' ->> 'date'");
    expect(migrationSql).toContain("raw_calendar_result -> 'previousBusinessDay' ->> 'date'");
    expect(migrationSql).toContain("raw_calendar_result -> 'nextBusinessDay' ->> 'date'");
    expect(migrationSql).toContain(
      "IS DISTINCT FROM NEW.\"calendar\" -> 'previousBusinessDay' ->> 'date'",
    );
  });

  it("모든 현재 append-only 증거 테이블에 restart-safe TRUNCATE guard를 설치한다", () => {
    for (const table of immutableEvidenceTables) {
      expect(migrationSql).toContain(
        `DROP TRIGGER IF EXISTS ${table}_immutable_truncate ON public."${table}"`,
      );
      expect(migrationSql).toContain(
        `CREATE TRIGGER ${table}_immutable_truncate\nBEFORE TRUNCATE ON public."${table}"`,
      );
      expect(migrationSql).toContain(`ENABLE ALWAYS TRIGGER "${table}_immutable_truncate"`);
      expect(migrationSql).toContain(`ENABLE ALWAYS TRIGGER "${table}_immutable"`);
    }

    expect(migrationSql.match(/BEFORE TRUNCATE ON public\./g)).toHaveLength(
      immutableEvidenceTables.length + 1,
    );
    expect(migrationSql).toContain(
      'BEFORE TRUNCATE ON public."collection_run"\nFOR EACH STATEMENT',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE public."collection_run" ENABLE ALWAYS TRIGGER "collection_run_terminal_timeline_guard"',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE public."collection_run" ENABLE ALWAYS TRIGGER "collection_run_terminal_timeline_truncate"',
    );
  });

  it("insert provenance trigger도 replica role에서 항상 실행되도록 고정한다", () => {
    for (const triggerName of [
      "raw_broker_response_insert_while_running",
      "portfolio_snapshot_insert_while_running",
      "holding_snapshot_insert_while_running",
      "snapshot_check_insert_while_running",
      "buying_power_snapshot_insert_while_running",
      "price_snapshot_insert_while_running",
      "price_snapshot_provenance_guard",
      "market_calendar_snapshot_insert_while_running",
      "market_calendar_snapshot_provenance_guard",
      "broker_request_attempt_insert_while_running",
      "broker_response_validation_succeeded_attempt",
    ]) {
      expect(migrationSql).toContain(`ENABLE ALWAYS TRIGGER "${triggerName}"`);
    }
  });
});
