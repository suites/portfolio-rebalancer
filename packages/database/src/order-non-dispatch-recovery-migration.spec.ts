import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716170000_order_non_dispatch_recovery/migration.sql",
  ),
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

describe("order non-dispatch recovery migration", () => {
  it("A와 주문에 각각 하나뿐인 불변 비전송 증명을 저장한다", () => {
    expect(migrationSql).toContain('CREATE TABLE public."order_non_dispatch_evidence"');
    expect(migrationSql).toContain('"order_non_dispatch_evidence_submission_authorization_id_key"');
    expect(migrationSql).toContain('"order_non_dispatch_evidence_order_id_key"');
    expect(migrationSql).toContain('"order_non_dispatch_evidence_logical_order_id_key"');
    expect(migrationSql).toContain('ADD COLUMN "non_dispatch_evidence_id" UUID');
    expect(migrationSql).toContain('"order_state_history_non_dispatch_evidence_id_key"');
    expect(migrationSql).toContain(
      "\"actor\" IN ('EXECUTOR', 'RECONCILER', 'OPERATOR', 'RECOVERY')",
    );
  });

  it("현재 LIVE SUBMITTING A를 잠그고 B와 SUBMIT 증거가 모두 없을 때만 증명한다", () => {
    const guard = functionSql("guard_order_non_dispatch_evidence");

    expect(guard).toContain('FROM public."order_submission_authorization" AS auth');
    expect(guard).toContain("FOR UPDATE;");
    expect(guard).toContain("linked_mode IS DISTINCT FROM 'LIVE'");
    expect(guard).toContain("latest_state IS DISTINCT FROM 'SUBMITTING'");
    expect(guard).toContain(
      'latest_submission_authorization_id IS DISTINCT FROM NEW."submission_authorization_id"',
    );
    expect(guard).toContain('FROM public."order_dispatch_claim" AS claim');
    expect(guard).toContain("evidence.\"evidence_kind\"::TEXT = 'SUBMIT'");
    expect(guard).toContain("dispatch_claim_count <> 0");
    expect(guard).toContain("submit_evidence_count <> 0");
    expect(guard).toContain(
      "exact current LIVE SUBMITTING authorization with no dispatch claim or broker submission evidence",
    );
  });

  it("DB가 secret-free canonical proof와 SHA-256을 직접 고정한다", () => {
    const guard = functionSql("guard_order_non_dispatch_evidence");

    expect(guard).toContain("'version', 'ORDER_NON_DISPATCH_EVIDENCE_V1'");
    expect(guard).toContain(
      "'submissionAuthorizationId', NEW.\"submission_authorization_id\"::TEXT",
    );
    expect(guard).toContain("'authorizationPreparationDigest', auth_preparation_digest::TEXT");
    expect(guard).toContain("'authorizedRequestDigest', auth_authorized_request_digest::TEXT");
    expect(guard).toContain('NEW."proof_sha256" := pg_catalog.encode(');
    expect(guard).not.toContain("broker_account_reference_hmac");
    expect(guard).not.toContain("external_ref_hmac");
  });

  it("증명 INSERT가 같은 트랜잭션에서 REJECTED를 기록하고 예약을 해제한다", () => {
    const initializer = functionSql("initialize_order_non_dispatch_evidence");
    const stateGuard = functionSql("guard_order_state_history");

    expect(initializer).toContain('INSERT INTO public."order_state_history"');
    expect(initializer).toContain('"non_dispatch_evidence_id"');
    expect(initializer).toContain("'REJECTED'");
    expect(initializer).toContain("'RECOVERY'");
    expect(stateGuard).toContain(
      "non-dispatch recovery must atomically close the exact SUBMITTING authorization without broker evidence",
    );
    expect(stateGuard).toContain("RECOVERY actor is reserved for immutable non-dispatch evidence");
    expect(stateGuard).toContain('AND NEW."non_dispatch_evidence_id" IS NULL THEN');
    expect(stateGuard).toContain(
      "WHEN NEW.\"normalized_state\"::TEXT IN ('FILLED', 'CANCELED', 'REJECTED')",
    );
  });

  it("복구 뒤 B와 SUBMIT 증거를 영구 거부한다", () => {
    const dispatchGuard = functionSql("guard_dispatch_after_non_dispatch");

    expect(dispatchGuard).toContain(
      'FROM public."order_submission_authorization" AS submission_auth',
    );
    expect(dispatchGuard).toContain("FOR UPDATE;");
    expect(dispatchGuard).toContain(
      "a non-dispatch recovery proof permanently forbids later broker dispatch",
    );
    expect(functionSql("guard_submit_evidence_after_non_dispatch")).toContain(
      "a non-dispatch recovery proof permanently forbids later broker submission evidence",
    );
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER order_dispatch_claim_00_non_dispatch_guard",
    );
    expect(migrationSql).toContain(
      "ENABLE ALWAYS TRIGGER broker_order_response_00_non_dispatch_guard",
    );
  });

  it("UPDATE DELETE TRUNCATE 우회를 막고 current view에 증명을 노출한다", () => {
    expect(functionSql("guard_order_non_dispatch_evidence")).toContain("IF TG_OP <> 'INSERT' THEN");
    expect(migrationSql).toContain('BEFORE TRUNCATE ON public."order_non_dispatch_evidence"');
    expect(migrationSql).toContain("ENABLE ALWAYS TRIGGER order_non_dispatch_evidence_guard");
    expect(migrationSql).toContain('history."non_dispatch_evidence_id"');
    expect(migrationSql).toContain('non_dispatch."proof_sha256" AS "non_dispatch_proof_sha256"');
  });
});
