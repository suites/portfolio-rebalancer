import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LiveTradingToggle } from "./live-trading-toggle";

vi.mock("@/app/(console)/actions", () => ({
  setLiveTradingFromShellAction: vi.fn(),
}));

describe("LiveTradingToggle", () => {
  it("OFF 상태에서는 다음 요청을 ON으로 보내고 접근 가능한 스위치로 표시한다", () => {
    const html = renderToStaticMarkup(<LiveTradingToggle enabled={false} />);

    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('name="desired" value="ON"');
    expect(html).toContain("실거래");
    expect(html).toContain("OFF");
  });

  it("실제 ON 상태만 활성 스타일과 OFF 요청을 사용한다", () => {
    const html = renderToStaticMarkup(<LiveTradingToggle enabled />);

    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('name="desired" value="OFF"');
    expect(html).toContain("ON");
  });
});
