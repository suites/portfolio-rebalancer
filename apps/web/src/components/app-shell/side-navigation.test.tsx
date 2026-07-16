import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/orders" }));

import { SideNavigation } from "./side-navigation";

describe("console navigation", () => {
  it("6개 실제 링크와 정확히 하나의 현재 경로를 렌더링한다", () => {
    const html = renderToStaticMarkup(<SideNavigation />);

    expect((html.match(/href=/g) ?? []).length).toBe(6);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/portfolio"');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain("준비 중");
    expect(html).not.toContain("aria-disabled");
  });
});
