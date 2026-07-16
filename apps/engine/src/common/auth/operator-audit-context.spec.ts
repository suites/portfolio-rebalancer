import { describe, expect, it } from "vitest";

import { operatorAuditActor, requireOperatorAuditContext } from "./operator-audit-context";

const NOW = new Date("2026-07-16T10:00:00.000Z");

describe("operator audit context", () => {
  it("정확한 운영자 세션과 최근 재인증을 감사 actor로 봉인한다", () => {
    const context = requireOperatorAuditContext(
      headers("2026-07-16T09:59:00.000Z"),
      {
        recentReauthentication: true,
      },
      NOW,
    );

    expect(operatorAuditActor(context)).toContain("operator=fred");
    expect(operatorAuditActor(context)).toContain("session=10000000-0000-4000-8000-000000000001");
  });

  it("누락·미래·5분 초과 재인증은 fail closed 한다", () => {
    expect(() => requireOperatorAuditContext({}, { recentReauthentication: true }, NOW)).toThrow();
    expect(() =>
      requireOperatorAuditContext(
        headers("2026-07-16T10:01:00.000Z"),
        {
          recentReauthentication: true,
        },
        NOW,
      ),
    ).toThrow();
    expect(() =>
      requireOperatorAuditContext(
        headers("2026-07-16T09:54:59.999Z"),
        {
          recentReauthentication: true,
        },
        NOW,
      ),
    ).toThrow();
  });
});

function headers(reauthenticatedAt: string) {
  return {
    "x-portfolio-operator-id": "fred",
    "x-portfolio-operator-session-id": "10000000-0000-4000-8000-000000000001",
    "x-portfolio-operator-authenticated-at": "2026-07-16T09:00:00.000Z",
    "x-portfolio-operator-reauthenticated-at": reauthenticatedAt,
  };
}
