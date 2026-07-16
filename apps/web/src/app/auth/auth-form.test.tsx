import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OperatorLoginForm, OperatorReauthenticationForm } from "./auth-form";

describe("operator auth forms", () => {
  it("로그인 폼은 브라우저 자동완성과 server-only credential 입력만 제공한다", () => {
    const html = renderToStaticMarkup(
      <OperatorLoginForm action={vi.fn()} returnTo="/orders" defaultOperatorId="fred" />,
    );

    expect(html).toContain('name="operatorId"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('name="returnTo"');
    expect(html).not.toContain("WEB_OPERATOR_PASSWORD");
  });

  it("재인증 폼은 현재 세션에 묶인 CSRF 토큰을 제출한다", () => {
    const csrfToken = "c".repeat(64);
    const html = renderToStaticMarkup(
      <OperatorReauthenticationForm
        action={vi.fn()}
        returnTo="/rebalancing"
        csrfToken={csrfToken}
      />,
    );

    expect(html).toContain('name="_csrf"');
    expect(html).toContain(`value="${csrfToken}"`);
    expect(html).toContain('autoComplete="current-password"');
  });
});
