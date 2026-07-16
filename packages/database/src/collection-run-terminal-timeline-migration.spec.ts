import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716164000_collection_run_terminal_timeline/migration.sql",
  ),
  "utf8",
);

describe("collection run terminal timeline migration", () => {
  it("기존 terminal run의 완료 시각을 마지막 request/validation 증거까지 전진시킨다", () => {
    expect(migrationSql).toContain("WITH terminal_evidence AS");
    expect(migrationSql).toContain('MAX(attempt."completed_at")');
    expect(migrationSql).toContain('MAX(validation."validated_at")');
    expect(migrationSql).toContain('SET "completed_at" = evidence."corrected_completed_at"');
  });

  it("RUNNING과 terminal 상태의 completed_at 모양을 DB check로 고정한다", () => {
    expect(migrationSql).toContain('"collection_run_terminal_completion_check"');
    expect(migrationSql).toContain("\"status\" = 'RUNNING'");
    expect(migrationSql).toContain('"completed_at" IS NULL');
    expect(migrationSql).toContain("\"status\" IN ('SUCCEEDED', 'FAILED')");
    expect(migrationSql).toContain('"completed_at" IS NOT NULL');
  });

  it("collection request와 validation append가 terminal 전환과 직렬화되도록 run row를 잠근다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION require_running_collection_run_for_attempt()");
    expect(migrationSql).toContain("CREATE TRIGGER broker_request_attempt_insert_while_running");
    expect(migrationSql).toContain('BEFORE INSERT ON "broker_request_attempt"');
    expect(migrationSql).toContain(
      "CREATE OR REPLACE FUNCTION require_succeeded_broker_response_attempt()",
    );
    expect(migrationSql.match(/FOR UPDATE;/g)).toHaveLength(2);
  });

  it("terminal 전환이 마지막 request/validation보다 빠르지 않고 이후 변경되지 않게 한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION guard_collection_run_terminal_timeline()");
    expect(migrationSql).toContain('MAX("completed_at")');
    expect(migrationSql).toContain('MAX(validation."validated_at")');
    expect(migrationSql).toContain('NEW."completed_at" < latest_evidence_at');
    expect(migrationSql).toContain("terminal collection run is immutable");
    expect(migrationSql).toContain("CREATE TRIGGER collection_run_terminal_timeline_guard");
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "collection_run"');
  });
});
