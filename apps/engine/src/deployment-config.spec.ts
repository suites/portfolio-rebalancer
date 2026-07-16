import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Vercel Nest deployment configuration", () => {
  it("수동 serverless handler 설정 없이 Nest zero-config만 사용한다", async () => {
    const contents = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
    const config = JSON.parse(contents) as Record<string, unknown>;

    expect(config).not.toHaveProperty("builds");
    expect(config).not.toHaveProperty("framework");
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
});
