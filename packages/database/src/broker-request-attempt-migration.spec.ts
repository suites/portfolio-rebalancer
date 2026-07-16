import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260716160000_broker_request_attempt/migration.sql"),
  "utf8",
);

describe("broker_request_attempt migration", () => {
  it("workflow 시도 식별자와 outcome별 상태 불변식을 DB에서 검증한다", () => {
    expect(migrationSql).toContain('"broker_request_attempt_identity_key"');
    expect(migrationSql).toContain('"broker_request_attempt_outcome_check"');
    expect(migrationSql).toContain("\"outcome\" = 'SUCCEEDED'");
    expect(migrationSql).toContain("\"outcome\" IN ('TIMEOUT', 'NETWORK_ERROR')");
    expect(migrationSql).toContain("JSONB_TYPEOF(\"redacted_request_summary\") = 'object'");
  });

  it("UPDATE와 DELETE를 기존 append-only 거부 함수로 차단한다", () => {
    expect(migrationSql).toContain("CREATE TRIGGER broker_request_attempt_immutable");
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "broker_request_attempt"');
    expect(migrationSql).toContain("EXECUTE FUNCTION reject_immutable_change()");
  });
});
