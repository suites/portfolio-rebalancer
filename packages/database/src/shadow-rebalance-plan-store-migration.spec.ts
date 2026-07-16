import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  resolve(
    __dirname,
    "../prisma/migrations/20260716166000_shadow_rebalance_plan_store/migration.sql",
  ),
  "utf8",
);

describe("shadow rebalance plan store migration", () => {
  it("run, immutable plan과 결정적 order candidate 저장소를 만든다", () => {
    expect(migrationSql).toContain('CREATE TABLE public."rebalance_run"');
    expect(migrationSql).toContain('CREATE TABLE public."rebalance_plan"');
    expect(migrationSql).toContain('CREATE TABLE public."rebalance_plan_order"');
    expect(migrationSql).toContain('"rebalance_run_dedupe_key_key"');
    expect(migrationSql).toContain('"rebalance_plan_identity_key"');
    expect(migrationSql).toContain('"rebalance_plan_order_plan_candidate_key"');
  });

  it("검증된 snapshot과 정확히 고정된 target config만 run에 연결한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION public.guard_rebalance_run()");
    expect(migrationSql).toContain("snapshot_validation_status IS DISTINCT FROM 'VERIFIED'");
    expect(migrationSql).toContain(
      'snapshot_target_config_version_id IS DISTINCT FROM NEW."target_config_version_id"',
    );
    expect(migrationSql).toContain(
      'target_content_hash IS DISTINCT FROM NEW."target_config_content_hash"',
    );
    expect(migrationSql).toContain("target_status IS DISTINCT FROM 'ACTIVE'");
    expect(migrationSql).toContain('latest_snapshot_id IS DISTINCT FROM NEW."snapshot_id"');
  });

  it("RUNNING에서 한 번만 terminal로 전환하고 plan과 order 수를 함께 봉인한다", () => {
    expect(migrationSql).toContain("terminal rebalance run is immutable");
    expect(migrationSql).toContain("terminal rebalance run status must match its sealed plan");
    expect(migrationSql).toContain("rebalance plan order count does not match the terminal status");
    expect(migrationSql).toContain("plan orders can only be inserted");
  });

  it("row 변경과 TRUNCATE를 replica role에서도 차단한다", () => {
    expect(migrationSql).toContain("CREATE FUNCTION public.reject_rebalance_truncate()");
    expect(migrationSql).toContain('ENABLE ALWAYS TRIGGER "rebalance_run_guard"');
    expect(migrationSql).toContain('ENABLE ALWAYS TRIGGER "rebalance_plan_guard"');
    expect(migrationSql).toContain('ENABLE ALWAYS TRIGGER "rebalance_plan_order_guard"');
    expect(migrationSql.match(/SET search_path TO pg_catalog/g)).toHaveLength(4);
  });

  it("canonical content에서 plan hash를 DB가 직접 다시 계산한다", () => {
    expect(migrationSql).toContain("pg_catalog.sha256");
    expect(migrationSql).toContain("pg_catalog.convert_to(\"canonical_content\", 'UTF8')");
    expect(migrationSql).toContain('"plan_hash" = pg_catalog.encode');
  });
});
