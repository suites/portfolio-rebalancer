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
});
