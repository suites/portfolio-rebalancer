import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716162000_broker_response_validation_provenance/migration.sql",
  ),
  "utf8",
);

describe("broker response validation provenance migration", () => {
  it("응답 검증 결과를 request attempt당 하나의 DB-safe 증거로 저장한다", () => {
    expect(migrationSql).toContain('CREATE TYPE "BrokerResponseValidationOutcome"');
    expect(migrationSql).toContain("'PASSED'");
    expect(migrationSql).toContain("'SCHEMA_ERROR'");
    expect(migrationSql).toContain('CREATE TABLE "broker_response_validation"');
    expect(migrationSql).toContain('"broker_response_validation_request_attempt_id_key"');
    expect(migrationSql).toContain('"broker_response_validation_operation_id_check"');
    expect(migrationSql).toContain("BTRIM(\"operation_id\") <> ''");
    expect(migrationSql).toContain('"broker_response_validation_outcome_check"');
    expect(migrationSql).toContain("\"outcome\" = 'PASSED'");
    expect(migrationSql).toContain('"safe_error_code" IS NULL');
    expect(migrationSql).toContain("\"outcome\" = 'SCHEMA_ERROR'");
    expect(migrationSql).toContain("BTRIM(\"safe_error_code\") <> ''");
    expect(migrationSql).toContain("\"body_sha256\" ~ '^[0-9a-f]{64}$'");
    expect(migrationSql).toContain('REFERENCES "broker_request_attempt"("id")');
  });

  it("HTTP 성공 attempt만 검증하고 검증 시각 역전을 차단한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION require_succeeded_broker_response_attempt()");
    expect(migrationSql).toContain("\"outcome\" = 'SUCCEEDED'");
    expect(migrationSql).toContain('"http_status" BETWEEN 200 AND 299');
    expect(migrationSql).toContain('NEW."operation_id" <> attempt_operation_id');
    expect(migrationSql).toContain('NEW."validated_at" < attempt_completed_at');
    expect(migrationSql).toContain("CREATE TRIGGER broker_response_validation_succeeded_attempt");
    expect(migrationSql).toContain('BEFORE INSERT ON "broker_response_validation"');
  });

  it("응답 검증 증거의 UPDATE와 DELETE를 append-only trigger로 차단한다", () => {
    expect(migrationSql).toContain("CREATE TRIGGER broker_response_validation_immutable");
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "broker_response_validation"');
    expect(migrationSql).toContain("EXECUTE FUNCTION reject_immutable_change()");
  });

  it("기존 무출처 행을 거부한 뒤 가격·캘린더 request attempt를 NOT NULL로 만든다", () => {
    expect(migrationSql).toContain('FROM "price_snapshot"\n    WHERE "request_attempt_id" IS NULL');
    expect(migrationSql).toContain(
      'FROM "market_calendar_snapshot"\n    WHERE "request_attempt_id" IS NULL',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "price_snapshot"\nALTER COLUMN "request_attempt_id" SET NOT NULL',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "market_calendar_snapshot"\nALTER COLUMN "request_attempt_id" SET NOT NULL',
    );
  });

  it("시장 증거가 같은 collection run의 성공·검증 통과 attempt에서만 오도록 강제한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION require_market_snapshot_provenance()");
    expect(migrationSql).toContain(
      'snapshot."collection_run_id",\n    attempt."collection_run_id"',
    );
    expect(migrationSql).toContain(
      "attempt_collection_run_id IS DISTINCT FROM snapshot_collection_run_id",
    );
    expect(migrationSql).toContain("attempt_outcome <> 'SUCCEEDED'");
    expect(migrationSql).toContain("response_validation_outcome IS DISTINCT FROM 'PASSED'");
    expect(migrationSql).toContain("expected_operation_id := 'getPrices'");
    expect(migrationSql).toContain("WHEN 'KR' THEN expected_operation_id := 'getKrMarketCalendar'");
    expect(migrationSql).toContain("WHEN 'US' THEN expected_operation_id := 'getUsMarketCalendar'");
    expect(migrationSql).toContain("attempt_operation_id <> expected_operation_id");
    expect(migrationSql).toContain("CREATE TRIGGER price_snapshot_provenance_guard");
    expect(migrationSql).toContain("CREATE TRIGGER market_calendar_snapshot_provenance_guard");
    expect(migrationSql.match(/BEFORE INSERT ON "(price|market_calendar)_snapshot"/g)).toHaveLength(
      2,
    );
  });
});
