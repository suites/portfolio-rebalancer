import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/orders" }));

import { SideNavigation } from "./side-navigation";

describe("console navigation", () => {
  it("초보자용 세 링크만 표시하고 현재 경로가 아니면 선택하지 않는다", () => {
    const html = renderToStaticMarkup(<SideNavigation />);

    expect((html.match(/href=/g) ?? []).length).toBe(3);
    expect((html.match(/aria-current="page"/g) ?? []).length).toBe(0);
    expect(html).toContain('href="/settings"');
    expect(html).toContain("포트폴리오 만들기");
    expect(html).not.toContain("주문·기록");
    expect(html).not.toContain("문제 해결");
  });
});
