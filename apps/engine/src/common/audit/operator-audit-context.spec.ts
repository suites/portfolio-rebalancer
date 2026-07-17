import { describe, expect, it } from "vitest";

import { localConsoleAuditContext, operatorAuditActor } from "./operator-audit-context";

describe("operatorAuditContext", () => {
  it("사설 콘솔 변경의 감사 actor를 명시한다", () => {
    expect(operatorAuditActor(localConsoleAuditContext())).toBe("local-console");
  });
});
