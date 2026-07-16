import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260716171000_live_dispatch_db_safety/migration.sql"),
  "utf8",
);

const functionSql = (name: string): string => {
  const starts = [
    migrationSql.lastIndexOf(`CREATE FUNCTION public.${name}(`),
    migrationSql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),
  ];
  const start = Math.max(...starts);
  if (start < 0) throw new Error(`migration function not found: ${name}`);
  const end = migrationSql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`migration function is not terminated: ${name}`);
  return migrationSql.slice(start, end + "\n$$;".length);
};

describe("live dispatch database safety migration", () => {
  it("B 직전에 계좌 잠금 아래 최신 ACTIVE config, promotion, kill switch를 다시 검증한다", () => {
    const guard = functionSql("guard_order_dispatch_claim_live_policy");

    expect(guard).toContain("FOR UPDATE OF account");
    expect(guard).toContain('FROM public."operational_config_current" AS current_config');
    expect(guard).toContain("current_config_version_id IS DISTINCT FROM risk_config_version_id");
    expect(guard).toContain("current_config_sha IS DISTINCT FROM risk_config_sha");
    expect(guard).toContain("current_config_canonical IS DISTINCT FROM risk_config_canonical");
    expect(guard).toContain("latest_promotion_state IS DISTINCT FROM 'GRANTED'");
    expect(guard).toContain(
      "latest_promotion_config_version_id IS DISTINCT FROM current_config_version_id",
    );
    expect(guard).toContain("latest_kill_state IS DISTINCT FROM 'DISENGAGED'");
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER order_dispatch_claim_01_live_policy_guard",
    );
  });

  it("activation, promotion, kill event가 같은 broker account 행을 먼저 잠가 B와 직렬화한다", () => {
    const lock = functionSql("lock_operational_config_activation_account");
    const eventLock = functionSql("lock_account_scoped_safety_event");

    expect(lock).toContain('FROM public."operational_config" AS config');
    expect(lock).toContain('FROM public."broker_account" AS account');
    expect(lock).toContain("FOR UPDATE;");
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER operational_config_activation_00_account_lock",
    );
    expect(eventLock).toContain('WHERE account."id" = NEW."account_id"');
    expect(eventLock).toContain("FOR UPDATE;");
    expect(migrationSql).toContain("ENABLE ALWAYS TRIGGER live_promotion_event_00_account_lock");
    expect(migrationSql).toContain("ENABLE ALWAYS TRIGGER kill_switch_event_00_account_lock");
  });

  it("새 pre-submit evidence는 getAccounts PASSED 결과로 exact account를 재결합한다", () => {
    const guard = functionSql("guard_pre_submit_account_binding");

    expect(migrationSql).toContain('ADD COLUMN "account_response_validation_id" UUID');
    expect(guard).toContain("validation_operation IS DISTINCT FROM 'getAccounts'");
    expect(guard).toContain("validation_outcome IS DISTINCT FROM 'PASSED'");
    expect(guard).toContain('attempt_correlation_id IS DISTINCT FROM NEW."id"');
    expect(guard).toContain("item ->> 'accountReferenceHmac' = account_hmac::TEXT");
    expect(guard).toContain("item ->> 'accountNo' = account_masked_number");
    expect(guard).toContain("item ->> 'accountType' = account_type_raw");
    expect(guard).toContain("matching_account_count IS DISTINCT FROM 1");
  });

  it("PLANNED 전용 불변 증거가 REJECTED와 reservation release를 원자적으로 만든다", () => {
    const evidenceGuard = functionSql("guard_order_pre_auth_non_dispatch_evidence");
    const initializer = functionSql("initialize_order_pre_auth_non_dispatch_evidence");
    const stateGuard = functionSql("guard_order_state_history");

    expect(migrationSql).toContain('CREATE TABLE public."order_pre_auth_non_dispatch_evidence"');
    expect(evidenceGuard).toContain("latest_state IS DISTINCT FROM 'PLANNED'");
    expect(evidenceGuard).toContain("authorization_count <> 0");
    expect(evidenceGuard).toContain("dispatch_count <> 0");
    expect(evidenceGuard).toContain("broker_evidence_count <> 0");
    expect(evidenceGuard).toContain("reservation_released <> 0");
    expect(initializer).toContain('INSERT INTO public."order_state_history"');
    expect(initializer).toContain('"pre_authorization_non_dispatch_evidence_id"');
    expect(initializer).toContain("'REJECTED'");
    expect(stateGuard).toContain(
      "pre-authorization recovery must atomically close the exact PLANNED LIVE order",
    );
    expect(stateGuard).toContain(
      "WHEN NEW.\"normalized_state\"::TEXT IN ('FILLED', 'CANCELED', 'REJECTED')",
    );
  });

  it("pre-authorization 복구 후 A와 broker evidence를 영구 거부한다", () => {
    expect(functionSql("guard_authorization_after_pre_authorization_recovery")).toContain(
      "permanently forbids later submission authorization",
    );
    expect(functionSql("guard_broker_evidence_after_pre_authorization_recovery")).toContain(
      "permanently forbids later broker evidence",
    );
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER order_submission_authorization_00_pre_auth_recovery_guard",
    );
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER broker_order_response_00_pre_auth_recovery_guard",
    );
  });

  it("B 뒤 결과 저장 중단은 자동 주문 귀속 없이 exact claim의 no-ID UNKNOWN_BLOCKED만 허용한다", () => {
    const evidenceGuard = functionSql("guard_broker_order_response_evidence");
    const stateGuard = functionSql("guard_order_state_history");

    expect(evidenceGuard).toContain(
      "dispatch-crash reconciliation may only seal a no-ID UNKNOWN_BLOCKED against the exact B claim",
    );
    expect(evidenceGuard).toContain("prior_submit_evidence_count <> 0");
    expect(evidenceGuard).toContain('NEW."broker_order_id" IS NOT NULL');
    expect(stateGuard).toContain("evidence_kind = 'RECONCILE'");
    expect(stateGuard).toContain("evidence_validated_state = 'UNKNOWN_BLOCKED'");
    expect(stateGuard).toContain("evidence_broker_order_id IS NULL");
    expect(stateGuard).toContain(
      "first LIVE broker outcome must be SUBMIT evidence or a no-ID UNKNOWN_BLOCKED bound to the exact one-time dispatch claim",
    );
  });

  it("broker account identity는 불변이고 refresh metadata만 단조 갱신한다", () => {
    const guard = functionSql("guard_broker_account_identity");

    expect(guard).toContain('NEW."id" IS DISTINCT FROM OLD."id"');
    expect(guard).toContain('NEW."broker" IS DISTINCT FROM OLD."broker"');
    expect(guard).toContain('NEW."external_ref_hmac" IS DISTINCT FROM OLD."external_ref_hmac"');
    expect(guard).toContain('NEW."first_seen_at" IS DISTINCT FROM OLD."first_seen_at"');
    expect(guard).toContain('NEW."last_seen_at" < OLD."last_seen_at"');
    expect(migrationSql).toContain("ENABLE ALWAYS TRIGGER broker_account_identity_guard");
  });
});
