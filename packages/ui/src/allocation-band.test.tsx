import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AllocationBand } from "./allocation-band";

describe("AllocationBand", () => {
  it("공통 0~100% 축과 접근 가능한 범위 설명을 렌더링한다", () => {
    const markup = renderToStaticMarkup(
      <AllocationBand
        label="AI 반도체"
        description="테마 ETF"
        currentBasisPointHundredths={220_000}
        targetBasisPoints={1_500}
        lowerBasisPoints={1_125}
        upperBasisPoints={1_875}
        bandStatus="OUTSIDE_BAND"
      />,
    );

    expect(markup).toContain('data-status="attention"');
    expect(markup).toContain("--current:22%");
    expect(markup).toContain("현재 22.000%, 목표 15.0%, 허용 범위 11.3%에서 18.8%");
    expect(markup).toContain("리밸런싱 검토 필요");
  });

  it("목표 미설정 보유자산을 가짜 목표 없이 표시한다", () => {
    const markup = renderToStaticMarkup(
      <AllocationBand
        label="삼성전자"
        description="KR · KRW"
        currentBasisPointHundredths={1_000_000}
        targetBasisPoints={null}
        lowerBasisPoints={null}
        upperBasisPoints={null}
        bandStatus="TARGET_NOT_CONFIGURED"
      />,
    );

    expect(markup).toContain("목표 미설정");
    expect(markup).toContain("주문 계획 차단");
    expect(markup).toContain("현재 100.000%, 목표 비중 미설정");
  });
});
