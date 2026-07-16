import { describe, expect, it } from "vitest";

import { resolveMigrationDatabaseUrl } from "./database-url";

describe("migration database URL", () => {
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
});
