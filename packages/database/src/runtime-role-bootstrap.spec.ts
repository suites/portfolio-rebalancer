import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const bootstrapSql = readFileSync(resolve(__dirname, "../sql/runtime-role-privileges.sql"), "utf8");
const bootstrapScript = readFileSync(
  resolve(__dirname, "../scripts/bootstrap-runtime-role.cjs"),
  "utf8",
);

describe("runtime database role bootstrap", () => {
  it("runtime과 migration 소유자를 분리하고 위험한 role 속성을 제거한다", () => {
    expect(bootstrapSql).toContain("runtime and migration database roles must be different");
    expect(bootstrapSql).toContain(
      "LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
    expect(bootstrapSql).toContain("runtime roles must not own public application objects");
    expect(bootstrapScript).toContain("migration과 runtime 데이터베이스 역할은 달라야 합니다.");
  });

  it("PUBLIC CREATE/TEMP와 runtime TRUNCATE·migration ledger 접근을 제거한다", () => {
    expect(bootstrapSql).toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect(bootstrapSql).toContain("REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC");
    expect(bootstrapSql).toContain(`AND object."relname" <> '_prisma_migrations'`);
    expect(bootstrapSql).toContain(`REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations"`);
    expect(bootstrapSql).not.toContain("GRANT TRUNCATE");
  });

  it("정상 app INSERT와 필요한 행 잠금·단조 갱신만 명시적으로 허용한다", () => {
    expect(bootstrapSql).toContain("GRANT SELECT, INSERT ON TABLE public.%I");
    for (const table of [
      "collection_run",
      "runtime_lease",
      "instrument_catalog",
      "target_config_version",
      "rebalance_run",
      "order_ledger",
      "daily_trade_limit",
      "manual_order_approval",
      "daily_trade_reservation",
      "order_submission_authorization",
      "cancel_operator_authorization",
      "operational_config",
    ]) {
      expect(bootstrapSql).toContain(`'${table}'`);
    }
    expect(bootstrapSql).toContain(
      "GRANT UPDATE (masked_number, account_type_raw, last_seen_at) ON TABLE public.broker_account",
    );
    expect(bootstrapSql).not.toContain("'broker_account',");
    expect(bootstrapSql).toContain("GRANT DELETE ON TABLE public.runtime_lease");
    for (const functionName of [
      "expected_toss_client_order_id",
      "has_required_passed_checks",
      "expected_broker_normalized_state",
    ]) {
      expect(bootstrapSql).toContain(`'${functionName}'`);
    }
    expect(bootstrapSql).toContain(`procedure_object."proname" IN`);
  });

  it("새 migration object는 bootstrap 재실행 전 자동 노출하지 않는다", () => {
    expect(bootstrapSql).toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public");
    expect(bootstrapSql).toContain("REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC");
    expect(bootstrapSql).not.toContain("ALTER DEFAULT PRIVILEGES IN SCHEMA public\nGRANT");
  });

  it("bootstrap 출력이나 오류에 연결 URL과 비밀번호를 쓰지 않는다", () => {
    expect(bootstrapScript).not.toContain("console.log(configuration");
    expect(bootstrapScript).not.toContain("runtimeDatabaseUrl}@");
    expect(bootstrapScript).toContain("Restricted runtime database role is ready");
  });
});
