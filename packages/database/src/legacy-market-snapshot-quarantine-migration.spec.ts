import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716163000_quarantine_legacy_market_snapshots/migration.sql",
  ),
  "utf8",
);

describe("legacy market snapshot quarantine migration", () => {
  it("완료된 collection run에 응답 검증을 뒤늦게 붙이지 못하게 한다", () => {
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION require_succeeded_broker_response_attempt()",
    );
    expect(migrationSql).toContain("attempt_collection_run_id IS NOT NULL");
    expect(migrationSql).toContain("\"status\" = 'RUNNING'");
    expect(migrationSql).toContain(
      "collection response validation can only be appended while the collection run is running",
    );
  });

  it("기존 검증 증거를 합성하지 않고 legacy snapshot을 BLOCKED로 격리한다", () => {
    expect(migrationSql).toContain('CREATE TABLE "legacy_unverified_market_snapshot"');
    expect(migrationSql).toContain("attempt.\"operation_id\" = 'getHoldings'");
    expect(migrationSql).toContain("validation.\"outcome\" = 'PASSED'");
    expect(migrationSql).toContain("attempt.\"operation_id\" IS DISTINCT FROM 'getPrices'");
    expect(migrationSql).toContain("WHEN 'KR' THEN 'getKrMarketCalendar'");
    expect(migrationSql).toContain("WHEN 'US' THEN 'getUsMarketCalendar'");
    expect(migrationSql).toContain("SET \"validation_status\" = 'BLOCKED'");
    expect(migrationSql).not.toContain('INSERT INTO "broker_response_validation"');
  });

  it("격리 이유를 append-only snapshot check에 남긴다", () => {
    expect(migrationSql).toContain('DISABLE TRIGGER "portfolio_snapshot_immutable"');
    expect(migrationSql).toContain('ENABLE TRIGGER "portfolio_snapshot_immutable"');
    expect(migrationSql).toContain('DISABLE TRIGGER "snapshot_check_insert_while_running"');
    expect(migrationSql).toContain("  gen_random_uuid(),");
    expect(migrationSql).toContain("'BROKER_RESPONSE_PROVENANCE'");
    expect(migrationSql).toContain("'BLOCKED'");
    expect(migrationSql).toContain('ENABLE TRIGGER "snapshot_check_insert_while_running"');
    expect(migrationSql).toContain('DROP TABLE "legacy_unverified_market_snapshot"');
  });
});
