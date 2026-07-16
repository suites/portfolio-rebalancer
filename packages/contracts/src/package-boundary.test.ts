import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("contracts package module boundaries", () => {
  it("개발 원본은 ESM으로, production 산출물은 CommonJS로 노출한다", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      type?: string;
      exports?: { "."?: { development?: string; default?: string } };
    };
    const productionPackageJson = JSON.parse(
      await readFile(new URL("../cjs-package.json", import.meta.url), "utf8"),
    ) as { type?: string };

    expect(packageJson.type).toBe("module");
    expect(packageJson.exports?.["."]?.development).toBe("./src/index.ts");
    expect(packageJson.exports?.["."]?.default).toBe("./dist/index.js");
    expect(productionPackageJson.type).toBe("commonjs");
  });
});
