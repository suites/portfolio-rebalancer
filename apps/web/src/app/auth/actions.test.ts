import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  clearOperatorSession: vi.fn(),
  reauthenticateOperator: vi.fn(),
  requireOperatorMutation: vi.fn(),
  startOperatorSession: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/server/operator-auth", () => ({
  ...authMocks,
  OperatorAuthError: class OperatorAuthError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

import {
  loginOperatorAction,
  logoutOperatorAction,
  reauthenticateOperatorAction,
  type OperatorAuthActionState,
} from "./actions";

const initialState: OperatorAuthActionState = { status: "idle", message: null };

describe("operator auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("로그인 성공은 같은 origin의 안전한 returnTo로만 이동한다", async () => {
    authMocks.startOperatorSession.mockResolvedValue({});
    const formData = new FormData();
    formData.set("operatorId", "fred");
    formData.set("password", "correct horse battery staple");
    formData.set("returnTo", "/orders");

    await expect(loginOperatorAction(initialState, formData)).rejects.toThrow("REDIRECT");

    expect(authMocks.startOperatorSession).toHaveBeenCalledWith({
      operatorId: "fred",
      password: "correct horse battery staple",
    });
    expect(navigationMocks.redirect).toHaveBeenLastCalledWith("/orders");
  });

  it("외부 returnTo는 로그인 후 루트로 축소한다", async () => {
    authMocks.startOperatorSession.mockResolvedValue({});
    const formData = new FormData();
    formData.set("operatorId", "fred");
    formData.set("password", "correct horse battery staple");
    formData.set("returnTo", "https://evil.example");

    await expect(loginOperatorAction(initialState, formData)).rejects.toThrow("REDIRECT");

    expect(navigationMocks.redirect).toHaveBeenLastCalledWith("/");
  });

  it("재인증은 CSRF를 포함한 원본 FormData를 서버 경계에 전달한다", async () => {
    authMocks.reauthenticateOperator.mockResolvedValue({});
    const formData = new FormData();
    formData.set("_csrf", "c".repeat(64));
    formData.set("password", "correct horse battery staple");
    formData.set("returnTo", "/rebalancing");

    await expect(reauthenticateOperatorAction(initialState, formData)).rejects.toThrow("REDIRECT");

    expect(authMocks.reauthenticateOperator).toHaveBeenCalledWith({
      formData,
      password: "correct horse battery staple",
    });
    expect(navigationMocks.redirect).toHaveBeenLastCalledWith("/rebalancing");
  });

  it("로그아웃은 인증된 CSRF mutation 뒤에만 쿠키를 지운다", async () => {
    authMocks.requireOperatorMutation.mockResolvedValue({});
    const formData = new FormData();
    formData.set("_csrf", "c".repeat(64));

    await expect(logoutOperatorAction(formData)).rejects.toThrow("REDIRECT");

    expect(authMocks.requireOperatorMutation).toHaveBeenCalledWith(formData);
    expect(authMocks.clearOperatorSession).toHaveBeenCalledOnce();
    expect(navigationMocks.redirect).toHaveBeenLastCalledWith("/auth/login?status=signed-out");
  });
});
