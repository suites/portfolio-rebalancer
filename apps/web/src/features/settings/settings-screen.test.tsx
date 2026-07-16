import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TargetSettingsSnapshotSchema } from "@portfolio-rebalancer/contracts";

import { SettingsScreen } from "./settings-screen";

vi.mock("@/app/(console)/actions", () => ({
  activateTargetDraftAction: vi.fn(),
  saveTargetDraftAction: vi.fn(),
}));

describe("SettingsScreen", () => {
  it("URL status만으로 성공 메시지를 표시하지 않는다", () => {
    const settings = TargetSettingsSnapshotSchema.parse({
      state: "NO_SNAPSHOT",
      accountLabel: null,
      snapshotObservedAt: null,
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [],
      liveOrdersEnabled: false,
    });

    const html = renderToStaticMarkup(<SettingsScreen settings={settings} status="activated" />);

    expect(html).not.toContain("목표 설정을 적용했습니다.");
  });

  it("engine이 unavailable이면 URL의 입력 오류보다 실제 연결 실패를 우선한다", () => {
    const settings = TargetSettingsSnapshotSchema.parse({
      state: "UNAVAILABLE",
      accountLabel: null,
      snapshotObservedAt: null,
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [],
      liveOrdersEnabled: false,
    });

    const html = renderToStaticMarkup(<SettingsScreen settings={settings} status="invalid" />);

    expect(html).toContain("설정 정보를 불러올 수 없습니다.");
    expect(html).not.toContain("목표 초안을 저장하지 못했습니다.");
  });

  it("기본 설정에서는 목표만 입력하고 하한·상한은 자동 정책으로 안내한다", () => {
    const settings = TargetSettingsSnapshotSchema.parse({
      state: "NOT_CONFIGURED",
      accountLabel: "****1234",
      snapshotObservedAt: "2026-07-16T03:00:00.000Z",
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [
        {
          assetKey: "KR:005930",
          label: "삼성전자",
          description: "KR · KRW · 1주",
          currentBasisPointHundredths: 1_000_000,
        },
      ],
      liveOrdersEnabled: false,
    });

    const html = renderToStaticMarkup(<SettingsScreen settings={settings} status={undefined} />);

    expect(html).toContain('name="targetPercent"');
    expect(html).not.toContain('name="lowerPercent"');
    expect(html).not.toContain('name="upperPercent"');
    expect(html).toContain("목표의 25%, 최대 ±5%p");
  });
});
