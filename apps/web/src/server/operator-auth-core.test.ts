import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  allowedMutationOrigins,
  createOperatorSession,
  isRecentOperatorReauthentication,
  parseOperatorSession,
  readOperatorAuthConfiguration,
  safeOperatorReturnTo,
  serializeOperatorSession,
  verifyOperatorCredentials,
  verifyOperatorCsrfToken,
} from "./operator-auth-core";

const environment = {
  WEB_OPERATOR_ID: "fred",
  WEB_OPERATOR_PASSWORD: "correct horse battery staple",
  WEB_OPERATOR_SESSION_SECRET: "s".repeat(48),
  WEB_OPERATOR_SESSION_TTL_SECONDS: "3600",
  WEB_OPERATOR_REAUTH_TTL_SECONDS: "300",
};

describe("operator auth core", () => {
  it("필수 server-only secret가 없거나 짧으면 인증을 구성하지 않는다", () => {
    expect(readOperatorAuthConfiguration({}).configured).toBe(false);
    expect(
      readOperatorAuthConfiguration({
        ...environment,
        WEB_OPERATOR_SESSION_SECRET: "short",
      }).configured,
    ).toBe(false);
  });

  it("Web 최근 재인증 TTL은 engine의 5분 검증 한도를 넘길 수 없다", () => {
    expect(
      readOperatorAuthConfiguration({
        ...environment,
        WEB_OPERATOR_REAUTH_TTL_SECONDS: "301",
      }).configured,
    ).toBe(false);
  });

  it("production은 명시적인 same-origin allowlist가 없으면 인증을 구성하지 않는다", () => {
    expect(
      readOperatorAuthConfiguration({
        ...environment,
        NODE_ENV: "production",
      }).configured,
    ).toBe(false);
    expect(
      readOperatorAuthConfiguration({
        ...environment,
        NODE_ENV: "production",
        WEB_OPERATOR_ALLOWED_ORIGINS: "https://stock.fredly.dev",
      }).configured,
    ).toBe(true);
  });

  it("운영자 ID와 비밀번호를 고정 길이 digest로 검증한다", () => {
    const config = configured();
    expect(verifyOperatorCredentials("fred", "correct horse battery staple", config)).toBe(true);
    expect(verifyOperatorCredentials("other", "correct horse battery staple", config)).toBe(false);
    expect(verifyOperatorCredentials("fred", "wrong password", config)).toBe(false);
  });

  it("서명된 세션만 읽고 변조·만료·다른 운영자 세션을 거부한다", () => {
    const config = configured();
    const session = createOperatorSession(config, 1_000_000);
    const cookie = serializeOperatorSession(session, config);

    expect(parseOperatorSession(cookie, config, 1_001_000)).toEqual(session);
    expect(parseOperatorSession(`${cookie}x`, config, 1_001_000)).toBeNull();
    expect(parseOperatorSession(cookie, config, session.expiresAt)).toBeNull();
    expect(parseOperatorSession(cookie, { ...config, operatorId: "other" }, 1_001_000)).toBeNull();
    expect(
      parseOperatorSession(cookie, { ...config, password: "rotated secure password" }, 1_001_000),
    ).toBeNull();
  });

  it("세션에 묶인 CSRF 토큰과 최근 재인증 TTL을 함께 검증한다", () => {
    const config = configured();
    const session = createOperatorSession(config, 1_000_000);

    expect(verifyOperatorCsrfToken(session, session.csrfToken)).toBe(true);
    expect(verifyOperatorCsrfToken(session, "a".repeat(64))).toBe(false);
    expect(isRecentOperatorReauthentication(session, config, 1_299_999)).toBe(true);
    expect(isRecentOperatorReauthentication(session, config, 1_300_001)).toBe(false);
  });

  it("Origin이 forwarded host 또는 명시 allowlist와 정확히 일치할 때만 허용한다", () => {
    expect(
      allowedMutationOrigins({
        origin: "http://127.0.0.1:13000",
        host: "127.0.0.1:13000",
        forwardedHost: null,
        forwardedProto: null,
        configuredOrigins: [],
      }),
    ).toBe(true);
    expect(
      allowedMutationOrigins({
        origin: "https://stock.fredly.dev",
        host: "127.0.0.1:13000",
        forwardedHost: "stock.fredly.dev",
        forwardedProto: "https",
        configuredOrigins: [],
      }),
    ).toBe(true);
    expect(
      allowedMutationOrigins({
        origin: "https://evil.example",
        host: "stock.fredly.dev",
        forwardedHost: null,
        forwardedProto: "https",
        configuredOrigins: [],
      }),
    ).toBe(false);
    expect(
      allowedMutationOrigins({
        origin: "https://evil.example",
        host: "evil.example",
        forwardedHost: "evil.example",
        forwardedProto: "https",
        configuredOrigins: ["https://stock.fredly.dev"],
      }),
    ).toBe(false);
    expect(
      allowedMutationOrigins({
        origin: null,
        host: "127.0.0.1:13000",
        forwardedHost: null,
        forwardedProto: null,
        configuredOrigins: [],
      }),
    ).toBe(false);
  });

  it("인증 후 이동 경로는 같은 origin의 절대 경로만 허용한다", () => {
    expect(safeOperatorReturnTo("/orders?status=pending")).toBe("/orders?status=pending");
    expect(safeOperatorReturnTo("https://evil.example")).toBe("/");
    expect(safeOperatorReturnTo("//evil.example")).toBe("/");
    expect(safeOperatorReturnTo("/\\evil")).toBe("/");
  });
});

function configured() {
  const result = readOperatorAuthConfiguration(environment);
  if (!result.configured) throw new Error(result.reason);
  return result.config;
}
