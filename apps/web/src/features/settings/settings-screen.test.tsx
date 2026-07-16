import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  OperationalConfigSnapshotSchema,
  TargetSettingsSnapshotSchema,
} from "@portfolio-rebalancer/contracts";

import { SettingsScreen } from "./settings-screen";

vi.mock("@/app/(console)/actions", () => ({
  activateTargetDraftAction: vi.fn(),
  activateOperationalConfigDraftAction: vi.fn(),
  saveTargetDraftAction: vi.fn(),
  saveOperationalConfigDraftAction: vi.fn(),
  searchTargetInstrumentAction: vi.fn(),
  setKillSwitchAction: vi.fn(),
  setLivePromotionAction: vi.fn(),
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
      holdings: [],
    });

    const html = renderToStaticMarkup(
      <SettingsScreen
        settings={settings}
        operational={operational()}
        status="activated"
        csrfToken={"c".repeat(64)}
      />,
    );

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
      holdings: [],
    });

    const html = renderToStaticMarkup(
      <SettingsScreen
        settings={settings}
        operational={operational()}
        status="invalid"
        csrfToken={"c".repeat(64)}
      />,
    );

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
          assetKey: "SAFE",
          label: "안전자산",
          description: "채권·현금성 등 변동성 완충 자산",
          currentBasisPointHundredths: null,
        },
        {
          assetKey: "CORE",
          label: "핵심 공격자산",
          description: "장기 성장을 담당하는 광범위 핵심 자산",
          currentBasisPointHundredths: null,
        },
        {
          assetKey: "SATELLITE",
          label: "위성 공격자산",
          description: "개별주·테마 등 변동성이 큰 보조 자산",
          currentBasisPointHundredths: null,
        },
        {
          assetKey: "CASH",
          label: "관리 현금",
          description: "평가에 포함할 관리 현금을 아직 선택하지 않았습니다.",
          currentBasisPointHundredths: null,
        },
      ],
      holdings: [
        {
          instrumentKey: "KR:005930",
          label: "삼성전자",
          description: "KR · KRW · 1주",
          currentBasisPointHundredths: 1_000_000,
        },
      ],
    });

    const html = renderToStaticMarkup(
      <SettingsScreen
        settings={settings}
        operational={operational()}
        status={undefined}
        csrfToken={"c".repeat(64)}
      />,
    );

    expect(html).toContain('name="targetPercent"');
    expect(html).not.toContain('name="lowerPercent"');
    expect(html).not.toContain('name="upperPercent"');
    expect(html).toContain("목표의 25%, 최대 ±5%p");
    expect(html).toContain('name="cashMode"');
    expect(html).toContain('name="managedCashWon"');
    expect(html).toContain('name="instrumentClass"');
    expect(html).toContain('name="compositionMode"');
    expect(html).toContain("LOCAL_VALIDATED");
    expect(html).toContain("국내 6자리");
    expect(html).toContain('name="lookupMode"');
    expect(html).toContain('value="CATALOG"');
    expect(html).toContain('value="EXACT"');
    expect(html).toContain("로컬 이름 검색");
    expect(html).toContain("코드·티커 정확 검증");
    expect(html).toContain("안전자산");
    expect(html).toContain("핵심 공격자산");
    expect(html).toContain("위성 공격자산");
    expect(html).toContain("계산 전");
    expect(html).toContain("안정형 예시");
    expect(html).toContain("균형형 예시");
    expect(html).toContain("성장형 예시");
    expect(html).toContain("개인 맞춤 추천");
    expect(html).toContain("실행 안전 설정");
    expect(html).toContain("현재 수집된 계좌만 봉인");
    expect(html).toContain('name="liveEnabled"');
    expect(html).toContain("킬 스위치");
    expect(html).toContain("Live 승격");
    expect(html).toContain('name="_csrf"');

    const firstFormStart = html.indexOf("<form");
    const firstFormEnd = html.indexOf("</form>", firstFormStart);
    const secondFormStart = html.indexOf("<form", firstFormStart + 1);
    expect(firstFormEnd).toBeLessThan(secondFormStart);
  });

  it("운영 설정 초안의 SHA-256과 적용 확인 문구를 화면에 표시한다", () => {
    const settings = TargetSettingsSnapshotSchema.parse({
      state: "NO_SNAPSHOT",
      accountLabel: null,
      snapshotObservedAt: null,
      snapshotTargetVersion: null,
      activeVersion: null,
      draftVersion: null,
      requiresCollection: false,
      assets: [],
      holdings: [],
    });
    const hash = "a".repeat(64);

    const html = renderToStaticMarkup(
      <SettingsScreen
        settings={settings}
        operational={operationalWithDraft(hash)}
        status={undefined}
        csrfToken={"c".repeat(64)}
      />,
    );

    expect(html).toContain(hash);
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('pattern="운영 설정을 적용합니다"');
  });
});

function operational() {
  return OperationalConfigSnapshotSchema.parse({
    state: "EMPTY",
    activeVersion: null,
    draftVersion: null,
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    liveOrdersEnabled: false,
  });
}

function operationalWithDraft(contentHash: string) {
  return OperationalConfigSnapshotSchema.parse({
    state: "EMPTY",
    activeVersion: null,
    draftVersion: {
      id: "10000000-0000-4000-8000-000000000001",
      version: 2,
      status: "DRAFT",
      contentHash,
      createdAt: "2026-07-16T03:00:00+09:00",
      config: {
        schemaVersion: "OPERATIONAL_CONFIG_V1",
        mode: "PAPER",
        killSwitch: false,
        freshness: {
          quote: {
            planMaxAgeSeconds: 300,
            preSubmitMaxAgeSeconds: 30,
            futureToleranceSeconds: 10,
          },
          calendar: { maxAgeSeconds: 86_400, futureToleranceSeconds: 10 },
        },
        limits: {
          minimumOrderGrossMinor: "10000",
          feeBufferMinor: "1000",
          maxSingleOrderGrossMinor: "100000",
          maxDailyGrossMinor: "300000",
          maxDailyTurnoverBasisPoints: 1_000,
          maxAbsolutePriceChangeBasisPoints: 500,
          maxInstrumentWeightBasisPoints: 4_000,
          maxAssetClassWeightBasisPoints: 7_000,
          maxRiskyWeightBasisPoints: 8_000,
        },
        live: {
          enabled: false,
          marketCountry: "KR",
          allowedSession: "REGULAR_MARKET",
          orderType: "LIMIT",
          timeInForce: "DAY",
          accountAllowlistHmacs: [],
          manualApprovalRequired: true,
          approvalTtlSeconds: 300,
          maxSingleOrderGrossMinor: "50000",
          maxDailyGrossMinor: "150000",
          tinyLiveMaxGrossMinor: "50000",
        },
      },
    },
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    liveOrdersEnabled: false,
  });
}
