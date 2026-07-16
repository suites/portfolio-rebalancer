import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TOSS_OPERATIONS } from "../src/generated/operations.ts";
import { buildOperations } from "./sync-openapi.mjs";

const snapshotPath = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));
const fixedSpec = JSON.parse(await readFile(snapshotPath, "utf8"));

describe("sync-openapi rate group generation", () => {
  it("고정 OpenAPI 스냅샷을 동일한 operation manifest로 재생한다", () => {
    expect(buildOperations(fixedSpec)).toEqual(TOSS_OPERATIONS);
  });

  it("업무 operation의 Rate Limits Group이 없으면 생성을 중단한다", () => {
    const spec = structuredClone(fixedSpec);
    spec.paths["/api/v1/accounts"].get.description = "Rate group intentionally removed";

    expect(() => buildOperations(spec)).toThrow("Rate Limits Group이 없습니다");
  });

  it("알 수 없는 Rate Limits Group이면 생성을 중단한다", () => {
    const spec = structuredClone(fixedSpec);
    spec.paths["/api/v1/accounts"].get.description = "**Rate Limits Group**: `UNREVIEWED_GROUP`";

    expect(() => buildOperations(spec)).toThrow("알 수 없는 Rate Limits Group");
  });

  it("OAuth는 AUTH 또는 null을 생성물에 명시한다", () => {
    const withAuth = buildOperations(fixedSpec).find(
      ({ operationId }) => operationId === "issueOAuth2Token",
    );
    expect(withAuth?.rateLimitGroup).toBe("AUTH");

    const spec = structuredClone(fixedSpec);
    spec.paths["/oauth2/token"].post.description = "OAuth token issuance";
    const withoutAuth = buildOperations(spec).find(
      ({ operationId }) => operationId === "issueOAuth2Token",
    );
    expect(withoutAuth?.rateLimitGroup).toBeNull();
  });
});
