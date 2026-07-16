import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("Vercel Nest deployment configuration", () => {
  it("수동 serverless handler 설정 없이 Nest zero-config만 사용한다", async () => {
    const contents = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
    const config = JSON.parse(contents) as Record<string, unknown>;

    expect(config.framework).toBe("nestjs");
    expect(config).not.toHaveProperty("builds");
    expect(config).not.toHaveProperty("functions");
    expect(config).not.toHaveProperty("routes");
    expect(config).not.toHaveProperty("rewrites");
  });

  it("Vercel detector가 읽는 main 진입점에서 Nest를 직접 시작한다", async () => {
    const entrypoint = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(entrypoint).toContain('from "@nestjs/core"');
    expect(entrypoint).toContain("NestFactory.create");
    expect(entrypoint).toContain("app.listen");
  });

  it("프로덕션 런타임에서 모노레포 패키지를 컴파일된 CommonJS로 로드한다", () => {
    const script = [
      "@portfolio-rebalancer/domain",
      "@portfolio-rebalancer/broker-toss",
      "@portfolio-rebalancer/contracts",
      "@portfolio-rebalancer/database",
    ]
      .map((packageName) => `require(${JSON.stringify(packageName)})`)
      .join(";");

    expect(() =>
      execFileSync(process.execPath, ["-e", script], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
