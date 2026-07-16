import { describe, expect, it } from "vitest";

import { assertVercelEgressConfigured, loadEngineConfig } from "./engine.config";

describe("engine configuration", () => {
  it("로컬에서는 PostgreSQL 기본 URL을 제공한다", () => {
    expect(loadEngineConfig({}).DATABASE_URL).toContain("127.0.0.1:15432");
  });

  it("Vercel에서는 DATABASE_URL 누락을 허용하지 않는다", () => {
    expect(() => loadEngineConfig({ VERCEL: "1" })).toThrow("DATABASE_URL");
  });

  it("platform PORT를 engine 포트보다 우선한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      PORT: "4321",
      ENGINE_PORT: "4100",
      DATABASE_URL: "postgresql://example.invalid/portfolio",
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
      DATABASE_URL: "postgresql://example.invalid/portfolio",
    });

    expect(config.ENGINE_HOST).toBe("0.0.0.0");
  });

  it("고정 출구 IP 확인 전 Vercel 수집을 차단한다", () => {
    const config = loadEngineConfig({
      VERCEL: "1",
      DATABASE_URL: "postgresql://example.invalid/portfolio",
    });
    expect(() => assertVercelEgressConfigured(config)).toThrow("VERCEL_TOSS_EGRESS_NOT_CONFIRMED");
  });
});
