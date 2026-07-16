import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(__dirname, "../prisma/migrations/20260716169000_cancel_dispatch_audit/migration.sql"),
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

describe("cancel dispatch audit migration", () => {
  it("운영자 승인과 취소 dispatch claim을 주문별 불변 원장으로 분리한다", () => {
    expect(migrationSql).toContain('CREATE TABLE public."cancel_operator_authorization"');
    expect(migrationSql).toContain('CREATE TABLE public."order_cancel_dispatch_claim"');
    expect(migrationSql).toContain('"cancel_operator_authorization_authorization_id_key"');
    expect(migrationSql).toContain('"cancel_operator_authorization_digest_key"');
    expect(migrationSql).toContain('"order_cancel_dispatch_claim_operator_authorization_id_key"');
    expect(migrationSql).toContain('"order_cancel_dispatch_claim_order_id_key"');
    expect(migrationSql).toContain('"order_cancel_dispatch_claim_authorization_id_key"');
    expect(migrationSql).toContain('ADD COLUMN "cancel_dispatch_claim_id" UUID');
    expect(migrationSql).toContain('"broker_order_action_cancel_dispatch_claim_id_key"');
    expect(migrationSql).toContain('"broker_order_response_evidence_cancel_dispatch_claim_id_key"');
  });

  it("운영자 canonical은 계좌 secret 없이 현재 LIVE 미체결 주문만 30초 승인한다", () => {
    const authorizationGuard = functionSql("guard_cancel_operator_authorization");

    expect(migrationSql).toContain("\"confirmation_version\" = 'CANCEL_ORDER_CONFIRMATION_V1'");
    expect(migrationSql).toContain('"expires_at" <= "authorized_at" + INTERVAL \'30 seconds\'');
    expect(migrationSql).toContain('"authorization_digest" = pg_catalog.encode(');
    expect(authorizationGuard).toContain("linked_mode IS DISTINCT FROM 'LIVE'");
    expect(authorizationGuard).toContain("linked_state NOT IN ('PENDING', 'PARTIAL_FILLED')");
    expect(authorizationGuard).toContain(
      "NEW.\"authorized_at\" < pg_catalog.statement_timestamp() - INTERVAL '5 seconds'",
    );
    expect(authorizationGuard).toContain("'version', 'CANCEL_OPERATOR_AUTHORIZATION_V1'");
    expect(authorizationGuard).toContain(
      "'canonicalRequestDigest', NEW.\"canonical_request_digest\"::TEXT",
    );
    expect(authorizationGuard).not.toContain("'brokerAccountReference'");
    expect(authorizationGuard).not.toContain("external_ref_hmac");
    expect(authorizationGuard).toContain(
      "cancel operator authorization must seal one current cancelable LIVE order without account secrets",
    );
  });

  it("claim이 승인·원 주문·현재 상태·broker ID와 exact canonical을 원자적으로 고정한다", () => {
    const claimGuard = functionSql("guard_order_cancel_dispatch_claim");

    expect(migrationSql).toContain("\"ledger_state\" IN ('PENDING', 'PARTIAL_FILLED')");
    expect(migrationSql).toContain(
      '"authorization_expires_at" <= "authorization_issued_at" + INTERVAL \'30 seconds\'',
    );
    expect(claimGuard).toContain("FOR UPDATE;");
    expect(claimGuard).toContain('operator_order_id IS DISTINCT FROM NEW."order_id"');
    expect(claimGuard).toContain(
      'operator_request_digest IS DISTINCT FROM NEW."authorized_request_digest"',
    );
    expect(claimGuard).toContain(
      'operator_digest IS DISTINCT FROM NEW."operator_authorization_digest"',
    );
    expect(claimGuard).toContain("linked_state NOT IN ('PENDING', 'PARTIAL_FILLED')");
    expect(claimGuard).toContain('linked_broker_order_id IS DISTINCT FROM NEW."broker_order_id"');
    expect(claimGuard).toContain("'version', 'ORDER_CANCEL_DISPATCH_CLAIM_V1'");
    expect(claimGuard).toContain(
      "cancel dispatch canonical request does not match its immutable claim columns",
    );
    expect(claimGuard).toContain('UPDATE public."cancel_operator_authorization"');
    expect(claimGuard).toContain('SET "consumed_at" = pg_catalog.statement_timestamp()');
  });

  it("운영자 승인을 dispatch claim에서만 한 번 소비한다", () => {
    const authorizationGuard = functionSql("guard_cancel_operator_authorization");

    expect(authorizationGuard).toContain(
      "cancel operator authorization is append-only and can only be consumed by its dispatch claim",
    );
    expect(authorizationGuard).toContain('OLD."consumed_at" IS NOT NULL');
    expect(authorizationGuard).toContain('NEW."consumed_at" IS NULL');
    expect(authorizationGuard).toContain(
      'NEW."consumed_at" IS DISTINCT FROM pg_catalog.statement_timestamp()',
    );
    expect(authorizationGuard).toContain(
      "cancel operator authorization consumption is immutable and one-time",
    );
  });

  it("accepted action과 rejected/ambiguous evidence를 정확한 취소 claim에 묶는다", () => {
    const actionGuard = functionSql("guard_broker_order_action_cancel_dispatch");
    const evidenceGuard = functionSql("guard_broker_response_cancel_dispatch");

    expect(actionGuard).toContain("NEW.\"action_kind\"::TEXT = 'CANCEL'");
    expect(actionGuard).toContain('claim_authorization_id IS DISTINCT FROM NEW."authorization_id"');
    expect(actionGuard).toContain(
      'claim_request_digest IS DISTINCT FROM NEW."canonical_request_digest"',
    );
    expect(actionGuard).toContain(
      'claim_broker_order_id IS DISTINCT FROM NEW."original_broker_order_id"',
    );
    expect(actionGuard).toContain(
      "accepted CANCEL action must bind its exact one-time pre-dispatch claim",
    );

    expect(evidenceGuard).toContain("NEW.\"evidence_kind\"::TEXT = 'CANCEL_ATTEMPT'");
    expect(evidenceGuard).toContain('claim_order_id IS DISTINCT FROM NEW."order_id"');
    expect(evidenceGuard).toContain('claim_broker_order_id IS DISTINCT FROM NEW."broker_order_id"');
    expect(evidenceGuard).toContain(
      "CANCEL attempt evidence must bind its exact one-time pre-dispatch claim",
    );
  });

  it("UPDATE/DELETE/TRUNCATE 우회를 ALWAYS trigger로 차단하고 current view에 claim을 노출한다", () => {
    expect(functionSql("guard_order_cancel_dispatch_claim")).toContain("IF TG_OP <> 'INSERT' THEN");
    expect(migrationSql).toContain('BEFORE TRUNCATE ON public."cancel_operator_authorization"');
    expect(migrationSql).toContain('BEFORE TRUNCATE ON public."order_cancel_dispatch_claim"');
    for (const table of [
      "cancel_operator_authorization",
      "order_cancel_dispatch_claim",
      "broker_order_action",
      "broker_order_response_evidence",
    ]) {
      expect(migrationSql).toContain(`ALTER TABLE public."${table}"\nENABLE ALWAYS TRIGGER`);
    }
    expect(migrationSql).toContain(
      'action."cancel_dispatch_claim_id" AS "broker_action_cancel_dispatch_claim_id"',
    );
    expect(migrationSql).toContain(
      'evidence."cancel_dispatch_claim_id" AS "broker_response_cancel_dispatch_claim_id"',
    );
  });
});
