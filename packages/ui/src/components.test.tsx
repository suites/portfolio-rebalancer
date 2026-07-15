import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { StatusBanner } from "./status-banner";

describe("design-system component contracts", () => {
  it("Button의 비활성 상태를 네이티브 속성으로 전달한다", () => {
    const markup = renderToStaticMarkup(<Button disabled>실행 차단</Button>);

    expect(markup).toContain("disabled");
    expect(markup).toContain('data-variant="primary"');
  });

  it("StatusBanner 제목과 영역을 고유한 접근성 ID로 연결한다", () => {
    const markup = renderToStaticMarkup(
      <StatusBanner
        tone="blocked"
        icon="!"
        eyebrow="거래 차단"
        title="상태 확인이 필요해요"
        description="새 주문을 제출하지 않습니다."
      />,
    );
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];

    expect(labelledBy).toBeTruthy();
    expect(markup).toContain(`id="${labelledBy}"`);
    expect(markup).not.toContain("<button");
  });
});
