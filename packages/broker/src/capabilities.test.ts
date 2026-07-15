import { describe, expect, it } from "vitest";

import { BrokerCapabilityUnavailableError, requireCapability } from "./capabilities";

describe("requireCapability", () => {
  it("지원하지 않는 기능은 fail closed 한다", () => {
    expect(() =>
      requireCapability(
        { id: "demo", displayName: "Demo", capabilities: new Set(["market.quotes"]) },
        "orders.write",
      ),
    ).toThrow(BrokerCapabilityUnavailableError);
  });
});
