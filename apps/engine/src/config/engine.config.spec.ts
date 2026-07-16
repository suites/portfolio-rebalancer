import { describe, expect, it } from "vitest";

import { assertVercelEgressConfigured, loadEngineConfig } from "./engine.config";

describe("engine configuration", () => {
  it("로컬에서는 PostgreSQL 기본 URL을 제공한다", () => {
    expect(loadEngineConfig({}).DATABASE_RUNTIME_URL).toContain(
      "portfolio_runtime:portfolio_runtime_local@127.0.0.1:15432",
    );
  });

  it("Vercel에서는 DATABASE_RUNTIME_URL 누락을 허용하지 않는다", () => {
    expect(() => loadEngineConfig({ VERCEL: "1" })).toThrow("DATABASE_RUNTIME_URL");
  });

  it("Vercel의 제한 역할 pooled URL을 런타임 데이터베이스 URL로 사용한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      DATABASE_RUNTIME_URL: "postgres://portfolio_runtime@supabase.invalid/portfolio",
    });

    expect(config.DATABASE_RUNTIME_URL).toBe(
      "postgres://portfolio_runtime@supabase.invalid/portfolio",
    );
  });

  it("migration owner URL이나 자동 주입 pooled URL을 runtime fallback으로 사용하지 않는다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      DATABASE_RUNTIME_URL: "postgres://portfolio_runtime@supabase.invalid/portfolio",
      POSTGRES_PRISMA_URL: "postgres://postgres@supabase.invalid/portfolio",
      DATABASE_URL: "postgresql://migration-owner.invalid/portfolio",
    });

    expect(config.DATABASE_RUNTIME_URL).toBe(
      "postgres://portfolio_runtime@supabase.invalid/portfolio",
    );
  });

  it("platform PORT를 engine 포트보다 우선한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      PORT: "4321",
      ENGINE_PORT: "4100",
      DATABASE_RUNTIME_URL: "postgresql://runtime.invalid/portfolio",
    });

    expect(config.ENGINE_PORT).toBe(4321);
  });

  it("로컬 기본 host와 engine 포트를 사용한다", () => {
    const config = loadEngineConfig({ PORT: "4321", ENGINE_PORT: "4100" });

    expect(config.ENGINE_HOST).toBe("127.0.0.1");
    expect(config.ENGINE_PORT).toBe(4321);
  });

  it("Vercel 기본 host는 모든 인터페이스에서 수신한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      DATABASE_RUNTIME_URL: "postgresql://runtime.invalid/portfolio",
    });

    expect(config.ENGINE_HOST).toBe("0.0.0.0");
  });

  it("고정 출구 IP 확인 전 Vercel 수집을 차단한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      DATABASE_RUNTIME_URL: "postgresql://runtime.invalid/portfolio",
    });
    expect(() => assertVercelEgressConfigured(config)).toThrow("VERCEL_TOSS_EGRESS_NOT_CONFIRMED");
  });
});
