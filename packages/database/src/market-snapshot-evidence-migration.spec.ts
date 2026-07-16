import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260716161000_market_snapshot_evidence/migration.sql"),
  "utf8",
);

describe("market snapshot evidence migration", () => {
  it("가격·시장·통화·시간과 calendar JSON/SHA 불변식을 DB에서 검증한다", () => {
    expect(migrationSql).toContain("\"market_country\" IN ('KR', 'US')");
    expect(migrationSql).toContain("BTRIM(\"symbol\") <> ''");
    expect(migrationSql).toContain('"price_snapshot_market_currency_check"');
    expect(migrationSql).toContain("(\"market_country\" = 'KR' AND \"currency\" = 'KRW')");
    expect(migrationSql).toContain("(\"market_country\" = 'US' AND \"currency\" = 'USD')");
    expect(migrationSql).toContain('"price_snapshot_price_check"');
    expect(migrationSql).toContain('"last_price"::NUMERIC > 0');
    expect(migrationSql).toContain('"price_snapshot_time_check"');
    expect(migrationSql).toContain(
      '"provider_observed_at" <= "received_at" + INTERVAL \'60 seconds\'',
    );
    expect(migrationSql).toContain('"market_calendar_snapshot_json_check"');
    expect(migrationSql).toContain("JSONB_TYPEOF(\"calendar\") = 'object'");
    expect(migrationSql).toContain("JSONB_TYPEOF(\"calendar\"->'today'->'sessions') = 'array'");
    expect(migrationSql).toContain('"calendar"->>\'marketCountry\' = "market_country"');
    expect(migrationSql).toContain("\"calendar\"->'today'->>'date' = \"requested_date\"::TEXT");
    expect(migrationSql).toContain(") IS TRUE");
    expect(migrationSql).toContain("\"calendar_sha256\" ~ '^[0-9a-f]{64}$'");
  });

  it("snapshot별 식별자 UNIQUE와 request attempt FK/index를 설치한다", () => {
    expect(migrationSql).toContain('"price_snapshot_snapshot_market_symbol_key"');
    expect(migrationSql).toContain('"market_calendar_snapshot_snapshot_market_key"');
    expect(migrationSql).toContain('"price_snapshot_request_attempt_id_idx"');
    expect(migrationSql).toContain('"market_calendar_snapshot_request_attempt_id_idx"');
    expect(migrationSql).toContain('REFERENCES "broker_request_attempt"("id")');
  });

  it("두 증거 테이블의 UPDATE와 DELETE를 append-only trigger로 차단한다", () => {
    expect(migrationSql).toContain("CREATE TRIGGER price_snapshot_immutable");
    expect(migrationSql).toContain("CREATE TRIGGER market_calendar_snapshot_immutable");
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "price_snapshot"');
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "market_calendar_snapshot"');
    expect(migrationSql.match(/EXECUTE FUNCTION reject_immutable_change\(\)/g)).toHaveLength(2);
  });

  it("collection 완료 뒤 부모와 snapshot 자식 증거의 추가 INSERT를 차단한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION require_running_collection_run()");
    expect(migrationSql).toContain("CREATE FUNCTION require_running_collection_snapshot()");
    expect(migrationSql).toContain("AND \"status\" = 'RUNNING'");
    expect(migrationSql).toContain("CREATE TRIGGER raw_broker_response_insert_while_running");
    expect(migrationSql).toContain("CREATE TRIGGER portfolio_snapshot_insert_while_running");
    for (const table of [
      "holding_snapshot",
      "buying_power_snapshot",
      "price_snapshot",
      "market_calendar_snapshot",
      "snapshot_check",
    ]) {
      expect(migrationSql).toContain(`BEFORE INSERT ON "${table}"`);
      expect(migrationSql).toContain(
        "FOR EACH ROW EXECUTE FUNCTION require_running_collection_snapshot()",
      );
    }
  });
});
