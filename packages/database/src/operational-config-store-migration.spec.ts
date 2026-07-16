import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260716168000_operational_config_store/migration.sql"),
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

describe("operational config store migration", () => {
  it("계좌별 운영 설정과 불변 version/activation 원장을 분리한다", () => {
    expect(migrationSql).toContain('CREATE TABLE public."operational_config"');
    expect(migrationSql).toContain('CREATE TABLE public."operational_config_version"');
    expect(migrationSql).toContain('CREATE TABLE public."operational_config_activation"');
    expect(migrationSql).toContain('"operational_config_account_id_key"');
    expect(migrationSql).toContain('"operational_config_version_config_version_key"');
    expect(migrationSql).toContain('"operational_config_version_config_hash_key"');
    expect(migrationSql).toContain('"operational_config_activation_config_version_key"');
    expect(migrationSql).toContain('"operational_config_activation_config_version_id_key"');
    expect(migrationSql).toContain('ADD COLUMN "operational_config_version_id" UUID');
    expect(migrationSql).toContain('CREATE VIEW public."operational_config_current"');
    expect(migrationSql).toContain('ORDER BY current_activation."version" DESC');
  });

  it("canonical JSON과 SHA-256 및 운영 hard cap을 DB check로 봉인한다", () => {
    expect(migrationSql).toContain('"content_hash" = pg_catalog.encode(');
    expect(migrationSql).toContain(
      "pg_catalog.sha256(pg_catalog.convert_to(\"canonical_content\", 'UTF8'))",
    );
    expect(migrationSql).toContain('"payload" = "canonical_content"::JSONB');
    expect(migrationSql).toContain('"payload" ->> \'schemaVersion\' = "schema_version"');
    expect(migrationSql).toContain(
      "(\"payload\" #>> '{live,maxSingleOrderGrossMinor}')::NUMERIC <= 100000",
    );
    expect(migrationSql).toContain(
      "(\"payload\" #>> '{live,maxDailyGrossMinor}')::NUMERIC <= 300000",
    );
    expect(migrationSql).toContain(
      "(\"payload\" #>> '{live,tinyLiveMaxGrossMinor}')::NUMERIC <= 50000",
    );
  });

  it("PAPER 준비 설정과 LIVE 설정을 분리하되 live.enabled 안전조건은 공통 강제한다", () => {
    expect(migrationSql).toContain("\"payload\" ->> 'mode' = 'PAPER'");
    expect(migrationSql).toContain("\"payload\" ->> 'mode' = 'LIVE'");
    expect(migrationSql).toContain("(\"payload\" #>> '{live,enabled}')::BOOLEAN = TRUE");
    expect(migrationSql).toContain("(\"payload\" #>> '{live,enabled}')::BOOLEAN = FALSE");
    expect(migrationSql).toContain("(\"payload\" ->> 'killSwitch')::BOOLEAN = FALSE");
    expect(migrationSql).toContain(
      "(\"payload\" #>> '{live,manualApprovalRequired}')::BOOLEAN = TRUE",
    );
    expect(migrationSql).toContain(
      "pg_catalog.jsonb_array_length(\"payload\" #> '{live,accountAllowlistHmacs}') > 0",
    );
  });

  it("version과 activation을 계좌 잠금 아래 연속 증가시키고 최신 version만 활성화한다", () => {
    const versionGuard = functionSql("guard_operational_config_version");
    const activationGuard = functionSql("guard_operational_config_activation");

    expect(versionGuard).toContain("FOR UPDATE;");
    expect(versionGuard).toContain(
      'NEW."version" IS DISTINCT FROM COALESCE(latest_version, 0) + 1',
    );
    expect(versionGuard).toContain("operational config versions must be contiguous");
    expect(versionGuard).toContain(
      "operational config account allowlist must contain unique SHA-256 HMAC values",
    );

    expect(activationGuard).toContain("FOR UPDATE;");
    expect(activationGuard).toContain(
      'latest_config_version_id IS DISTINCT FROM NEW."operational_config_version_id"',
    );
    expect(activationGuard).toContain(
      'NEW."version" IS DISTINCT FROM COALESCE(previous_version, 0) + 1',
    );
    expect(activationGuard).toContain(
      "activation must select the latest unactivated operational config version",
    );
  });

  it("승격 상태와 실행 위험 증거를 동일한 현재 ACTIVE 설정에 묶는다", () => {
    const promotionGuard = functionSql("guard_live_promotion_operational_config");
    const executionGuard = functionSql("guard_execution_risk_operational_config");

    expect(promotionGuard).toContain(
      'latest_active_version_id IS DISTINCT FROM NEW."operational_config_version_id"',
    );
    expect(promotionGuard).toContain(
      'config_account_hmac IS DISTINCT FROM NEW."account_allowlist_hmac"',
    );
    expect(promotionGuard).toContain(
      'config_hash IS DISTINCT FROM NEW."operational_config_sha256"',
    );
    expect(promotionGuard).toContain("NEW.\"state\"::TEXT = 'GRANTED'");
    expect(promotionGuard).toContain(
      "live promotion must bind the current active operational config and GRANTED requires ACTIVE LIVE policy",
    );
    for (const limitColumn of [
      "max_single_order_gross_minor",
      "max_daily_gross_minor",
      "tiny_live_max_gross_minor",
    ]) {
      expect(promotionGuard).toContain(`NEW."${limitColumn}"`);
    }

    expect(executionGuard).toContain(
      'promotion_config_version_id IS DISTINCT FROM NEW."operational_config_version_id"',
    );
    expect(executionGuard).toContain(
      'config_canonical IS DISTINCT FROM NEW."operational_config_canonical"',
    );
    expect(executionGuard).toContain(
      'config_hash IS DISTINCT FROM NEW."operational_config_sha256"',
    );
    expect(executionGuard).toContain(
      'latest_active_version_id IS DISTINCT FROM NEW."operational_config_version_id"',
    );
    expect(executionGuard).toContain(
      "execution risk evidence must bind the exact current ACTIVE config used by promotion",
    );
    expect(migrationSql).toContain(
      'CREATE TRIGGER live_promotion_operational_config_guard\nBEFORE INSERT ON public."live_promotion_event"',
    );
    expect(migrationSql).toContain(
      'CREATE TRIGGER execution_risk_operational_config_guard\nBEFORE INSERT ON public."execution_risk_evidence"',
    );
  });

  it("운영 설정 원장을 UPDATE/DELETE/TRUNCATE와 replica 우회에서도 보호한다", () => {
    for (const guard of [
      "guard_operational_config",
      "guard_operational_config_version",
      "guard_operational_config_activation",
    ]) {
      expect(functionSql(guard)).toContain("IF TG_OP <> 'INSERT' THEN");
    }
    expect(functionSql("reject_operational_config_truncate")).toContain(
      "operational config audit tables cannot be truncated",
    );

    for (const table of [
      "operational_config",
      "operational_config_version",
      "operational_config_activation",
    ]) {
      expect(migrationSql).toContain(`ALTER TABLE public."${table}"\nENABLE ALWAYS TRIGGER`);
    }
    expect(migrationSql).toContain(
      'ALTER TABLE public."live_promotion_event"\nENABLE ALWAYS TRIGGER live_promotion_operational_config_guard',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE public."execution_risk_evidence"\nENABLE ALWAYS TRIGGER execution_risk_operational_config_guard',
    );
  });
});
