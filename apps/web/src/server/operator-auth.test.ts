import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));
const requestHeaders = vi.hoisted(() => new Map<string, string>());

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => cookieStore),
  headers: vi.fn(() => ({ get: (name: string) => requestHeaders.get(name) ?? null })),
}));

import { requireOperatorMutation, startOperatorSession } from "./operator-auth";
import type { OperatorAuthError } from "./operator-auth";

describe("operator auth server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestHeaders.clear();
    requestHeaders.set("origin", "http://127.0.0.1:13000");
    requestHeaders.set("host", "127.0.0.1:13000");
    vi.stubEnv("WEB_OPERATOR_ID", "fred");
    vi.stubEnv("WEB_OPERATOR_PASSWORD", "correct horse battery staple");
    vi.stubEnv("WEB_OPERATOR_SESSION_SECRET", "s".repeat(48));
    vi.stubEnv("WEB_OPERATOR_SESSION_TTL_SECONDS", "3600");
    vi.stubEnv("WEB_OPERATOR_REAUTH_TTL_SECONDS", "300");
    vi.stubEnv("WEB_OPERATOR_SECURE_COOKIE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("로그인은 HttpOnly SameSite 세션 쿠키를 발급한다", async () => {
    await startOperatorSession({
      operatorId: "fred",
      password: "correct horse battery staple",
    });

    expect(cookieStore.set).toHaveBeenCalledOnce();
    const call = cookieStore.set.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("portfolio_operator_session");
    expect(call[2]).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      priority: "high",
    });
  });

  it("production 세션은 __Host 이름과 Secure 속성을 강제한다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WEB_OPERATOR_ALLOWED_ORIGINS", "http://127.0.0.1:13000");

    await startOperatorSession({
      operatorId: "fred",
      password: "correct horse battery staple",
    });

    const call = cookieStore.set.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("__Host-portfolio_operator_session");
    expect(call[2]).toMatchObject({ secure: true, path: "/" });
  });

  it("세션 쿠키가 있어도 CSRF 토큰이 없으면 mutation을 차단한다", async () => {
    await startOperatorSession({
      operatorId: "fred",
      password: "correct horse battery staple",
    });
    const call = cookieStore.set.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    const cookieValue = call[1];
    cookieStore.get.mockReturnValue({ value: cookieValue });

    await expect(requireOperatorMutation(new FormData())).rejects.toMatchObject({
      code: "AUTH_CSRF_INVALID",
    } satisfies Partial<OperatorAuthError>);
  });

  it("Origin이 없으면 자격 증명과 세션을 확인하기 전에 fail closed 한다", async () => {
    requestHeaders.delete("origin");

    await expect(
      startOperatorSession({
        operatorId: "fred",
        password: "correct horse battery staple",
      }),
    ).rejects.toMatchObject({ code: "AUTH_ORIGIN_INVALID" });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
