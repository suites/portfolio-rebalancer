import { describe, expect, it } from "vitest";

import {
  assertSeparatedDatabaseRoles,
  databaseRoleName,
  resolveMigrationDatabaseUrl,
  resolveRuntimeDatabaseUrl,
} from "./database-url";

describe("migration database URL", () => {
  it("명시적인 DATABASE_URL을 migration 소유자 연결로 가장 먼저 사용한다", () => {
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_URL: "postgresql://migration-owner.invalid/portfolio",
        POSTGRES_URL_NON_POOLING: "postgres://supabase-direct.invalid/portfolio",
      }),
    ).toBe("postgresql://migration-owner.invalid/portfolio");
  });

  it("Supabase non-pooling URL을 migration에 사용한다", () => {
    expect(
      resolveMigrationDatabaseUrl({
        POSTGRES_URL_NON_POOLING: "postgres://supabase-direct.invalid/portfolio",
      }),
    ).toBe("postgres://supabase-direct.invalid/portfolio");
  });

  it("Supabase non-pooling URL을 기존 direct URL보다 우선한다", () => {
    expect(
      resolveMigrationDatabaseUrl({
        POSTGRES_URL_NON_POOLING: "postgres://supabase-direct.invalid/portfolio",
        DATABASE_DIRECT_URL: "postgresql://legacy-direct.invalid/portfolio",
      }),
    ).toBe("postgres://supabase-direct.invalid/portfolio");
  });

  it("기존 direct URL을 로컬 호환 경로로 유지한다", () => {
    expect(
      resolveMigrationDatabaseUrl({
        DATABASE_DIRECT_URL: "postgresql://local.invalid/portfolio",
      }),
    ).toBe("postgresql://local.invalid/portfolio");
  });

  it("pooled runtime URL을 migration fallback으로 사용하지 않는다", () => {
    expect(
      resolveMigrationDatabaseUrl({
        POSTGRES_PRISMA_URL: "postgres://owner-like-pool.invalid/portfolio",
      }),
    ).toContain("portfolio:portfolio_local@127.0.0.1:15432");
  });
});

describe("runtime database URL", () => {
  it("명시적인 제한 역할 URL만 runtime 연결에 사용한다", () => {
    expect(
      resolveRuntimeDatabaseUrl({
        DATABASE_RUNTIME_URL: "postgresql://portfolio_runtime@runtime.invalid/portfolio",
        DATABASE_URL: "postgresql://migration_owner@direct.invalid/portfolio",
        POSTGRES_PRISMA_URL: "postgresql://postgres@pool.invalid/portfolio",
      }),
    ).toBe("postgresql://portfolio_runtime@runtime.invalid/portfolio");
  });

  it("Vercel에서는 제한 runtime URL 누락을 fallback하지 않는다", () => {
    expect(
      resolveRuntimeDatabaseUrl({
        VERCEL: "1",
        DATABASE_URL: "postgresql://migration_owner@direct.invalid/portfolio",
        POSTGRES_PRISMA_URL: "postgresql://postgres@pool.invalid/portfolio",
      }),
    ).toBeUndefined();
  });

  it("로컬 기본 migration과 runtime 역할을 분리한다", () => {
    const migration = resolveMigrationDatabaseUrl({});
    const runtime = resolveRuntimeDatabaseUrl({});
    expect(runtime).toBeDefined();
    expect(databaseRoleName(migration)).toBe("portfolio");
    expect(databaseRoleName(runtime!)).toBe("portfolio_runtime");
    expect(() => assertSeparatedDatabaseRoles(migration, runtime!)).not.toThrow();
  });

  it("Supabase pooler username suffix를 실제 PostgreSQL 역할과 분리한다", () => {
    expect(
      databaseRoleName(
        "postgresql://portfolio_runtime.project-ref:password@pool.invalid:6543/postgres",
      ),
    ).toBe("portfolio_runtime");
  });

  it("migration과 runtime 역할이 같으면 차단한다", () => {
    expect(() =>
      assertSeparatedDatabaseRoles(
        "postgresql://portfolio@direct.invalid/portfolio",
        "postgresql://portfolio@pool.invalid/portfolio",
      ),
    ).toThrow("다른 제한 역할");
  });
});
