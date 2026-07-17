import { describe, expect, it } from "vitest";

import { operatorAuditActor, tailscaleOperatorAuditContext } from "./operator-audit-context";

describe("tailscale operator audit context", () => {
  it("uses a fixed audit actor without browser session evidence", () => {
    expect(operatorAuditActor(tailscaleOperatorAuditContext())).toBe("tailscale-operator");
  });
});
