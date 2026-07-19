import Link from "next/link";

import type {
  OperationalConfigSnapshotContract,
  TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import { activateTargetDraftAction } from "@/app/(console)/actions";
import { formatBasisPoints, formatObservedAt, formatWon } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

import { TargetSettingsEditor } from "./target-settings-editor";
import { GuidedPortfolioBuilder } from "./guided-portfolio-builder";
import { OperationalSettingsPanel } from "./operational-settings-panel";

export function SettingsScreen({
  settings,
  operational,
  status,
}: {
  readonly settings: TargetSettingsSnapshotContract;
  readonly operational: OperationalConfigSnapshotContract;
  readonly status: string | undefined;
}) {
  const feedback = feedbackFor(
    settings.state === "UNAVAILABLE" || operational.state === "UNAVAILABLE"
      ? "unavailable"
      : status,
  );
  return (
    <>
      <ConsolePageHeader
        eyebrow="설정"
        title="포트폴리오 만들기"
        description="투자성향을 고르면 승인된 종목과 목표 비중을 자동으로 구성합니다. 추천안을 확인하고 승인만 하세요."
      />
      <div className={styles.pageStack}>
        {feedback ? (
          <div className={styles.callout} data-tone={feedback.tone} role="status">
            <strong>{feedback.title}</strong>
            <p>{feedback.description}</p>
          </div>
        ) : null}
        {settings.requiresCollection ? (
          <div className={styles.callout} data-tone="attention">
            <strong>새 목표를 적용하려면 계좌 정보를 다시 확인해야 합니다.</strong>
            <p>
              <Link className={styles.safeLink} href="/troubleshooting">
                문제 해결
              </Link>
              에서 최신 정보로 다시 점검해 주세요.
            </p>
          </div>
        ) : null}

        <section className={styles.grid3} aria-label="설정 상태">
          <Surface className={styles.surface}>
            <h2>현재 계좌</h2>
            <p>{settings.accountLabel ?? "확인 필요"}</p>
          </Surface>
          <Surface className={styles.surface}>
            <h2>활성 목표</h2>
            <p>{settings.activeVersion ? `버전 ${settings.activeVersion.version}` : "미설정"}</p>
          </Surface>
          <Surface className={styles.surface}>
            <h2>현재 적용 목표</h2>
            <p>
              {settings.snapshotTargetVersion
                ? `버전 ${settings.snapshotTargetVersion}`
                : "적용 전"}
            </p>
          </Surface>
        </section>

        <Surface className={styles.surface} aria-labelledby="target-form-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="target-form-title">추천 포트폴리오</h2>
              <p>추천안 저장, 적용, 주문 실행은 서로 분리되어 있습니다.</p>
            </div>
            {settings.draftVersion ? (
              <Badge tone="attention">초안 v{settings.draftVersion.version}</Badge>
            ) : null}
          </div>
          {settings.assets.length > 0 ? (
            <GuidedPortfolioBuilder settings={settings} />
          ) : (
            <div className={styles.emptyState}>
              <strong>
                {settings.state === "UNAVAILABLE"
                  ? "설정 정보를 불러올 수 없습니다."
                  : "추천에 사용할 보유자산이 없습니다."}
              </strong>
              <p>문제 해결에서 계좌 정보를 먼저 확인해 주세요.</p>
            </div>
          )}
        </Surface>

        <div className={styles.grid2}>
          <Surface className={styles.surface}>
            <details className={styles.advancedSettings}>
              <summary>직접 종목과 비중 조정하기</summary>
              <p>종목 검색, 관리 현금, 자산군과 세부 비중을 직접 바꾸려는 경우에만 여세요.</p>
              {settings.assets.length > 0 ? <TargetSettingsEditor settings={settings} /> : null}
            </details>
          </Surface>

          <Surface className={styles.surface} aria-labelledby="version-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="version-title">버전 검토</h2>
                <p>저장한 목표를 확인한 뒤 적용하세요.</p>
              </div>
            </div>
            {settings.draftVersion ? (
              <>
                <dl className={styles.diagnosticList}>
                  <div>
                    <dt>초안 버전</dt>
                    <dd>{settings.draftVersion.version}</dd>
                  </div>
                  <div>
                    <dt>생성 시각</dt>
                    <dd>{formatObservedAt(settings.draftVersion.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>목표 합계</dt>
                    <dd>100%</dd>
                  </div>
                  <div>
                    <dt>관리 현금</dt>
                    <dd>{cashPolicyLabel(settings.draftVersion.cashPolicy)}</dd>
                  </div>
                </dl>
                <ul className={styles.statusList}>
                  {settings.draftVersion.allocations.map((allocation) => (
                    <li key={allocation.assetKey}>
                      <div>
                        <strong>{allocation.label}</strong>
                        <span>
                          {formatBasisPoints(allocation.lowerBasisPoints)}–
                          {formatBasisPoints(allocation.upperBasisPoints)}
                          {allocation.instruments.length > 0
                            ? ` · ${allocation.instruments
                                .map(
                                  (instrument) =>
                                    `${instrument.symbol} ${formatBasisPoints(
                                      instrument.withinAssetPoints,
                                    )}`,
                                )
                                .join(", ")}`
                            : ""}
                        </span>
                      </div>
                      <Badge tone="info">
                        목표 {formatBasisPoints(allocation.targetBasisPoints)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <form action={activateTargetDraftAction}>
                  <input type="hidden" name="version" value={settings.draftVersion.version} />
                  <Button type="submit">검토한 초안 적용</Button>
                </form>
              </>
            ) : (
              <div className={styles.emptyState}>
                <strong>적용 대기 중인 초안이 없습니다.</strong>
                <p>목표 비중을 입력해 초안을 저장하세요.</p>
              </div>
            )}
          </Surface>
        </div>

        <Surface className={styles.surface}>
          <details className={styles.advancedSettings}>
            <summary>실행 안전 고급 설정</summary>
            <p>Paper 기본값, 거래 한도, 킬 스위치와 Live 승격을 관리할 때만 여세요.</p>
            <OperationalSettingsPanel operational={operational} />
          </details>
        </Surface>
      </div>
    </>
  );
}

function cashPolicyLabel(
  policy: NonNullable<TargetSettingsSnapshotContract["draftVersion"]>["cashPolicy"],
): string {
  if (policy.mode === "UNSET") return "미설정";
  if (policy.mode === "EXCLUDED") return "평가에서 제외";
  return `${formatWon(policy.amountMinor)} 고정`;
}

function feedbackFor(
  status?: string,
): { title: string; description: string; tone?: "attention" | "blocked" } | null {
  if (status === "invalid")
    return {
      title: "목표 초안을 저장하지 못했습니다.",
      description: "모든 보유자산의 목표 합계가 정확히 100%인지 확인하세요.",
      tone: "blocked",
    };
  if (status === "activate-invalid")
    return {
      title: "초안을 적용하지 못했습니다.",
      description: "적용할 초안 버전을 다시 확인하세요.",
      tone: "blocked",
    };
  if (status === "draft-stale")
    return {
      title: "계좌 정보가 바뀌어 초안을 적용하지 않았습니다.",
      description: "현재 보유자산을 기준으로 목표 초안을 다시 저장하세요.",
      tone: "blocked",
    };
  if (status === "unavailable")
    return {
      title: "설정 정보를 불러올 수 없습니다.",
      description: "잠시 후 다시 시도하거나 문제 해결에서 연결 상태를 확인하세요.",
      tone: "blocked",
    };
  if (status === "operational-draft-saved")
    return {
      title: "운영 설정 초안을 저장했습니다.",
      description: "해시와 버전을 검토한 뒤 별도로 적용하세요. 아직 실행 상태는 바뀌지 않았습니다.",
    };
  if (status === "operational-activated")
    return {
      title: "운영 설정을 적용했습니다.",
      description: "Live 주문은 킬 스위치 해제와 별도 승격이 모두 끝나기 전까지 차단됩니다.",
    };
  if (status === "live-promotion-updated")
    return {
      title: "Live 승격 상태를 갱신했습니다.",
      description: "상단 상태에서 실제 주문 허용 여부를 다시 확인하세요.",
    };
  if (status === "kill-switch-engaged")
    return {
      title: "킬 스위치를 작동했습니다.",
      description: "새 주문 실행을 즉시 차단했습니다.",
      tone: "attention",
    };
  if (status === "kill-switch-disengaged")
    return {
      title: "킬 스위치를 해제했습니다.",
      description: "해제만으로 Live 주문이 켜지지는 않습니다. 활성 설정과 별도 승격도 필요합니다.",
    };
  if (status === "operational-input-invalid")
    return {
      title: "운영 설정을 저장하지 못했습니다.",
      description: "금액 한도, Live 체크와 사유 입력을 다시 확인하세요.",
      tone: "blocked",
    };
  if (status === "operational-account-missing")
    return {
      title: "현재 계좌를 운영 설정에 연결하지 못했습니다.",
      description: "문제 해결에서 계좌 정보를 새로 수집한 뒤 다시 저장하세요.",
      tone: "blocked",
    };
  if (status === "operational-content-reused")
    return {
      title: "같은 운영 설정이 이미 봉인되어 있습니다.",
      description: "기존 활성 설정 또는 최신 초안을 확인하세요.",
      tone: "attention",
    };
  if (status === "operational-draft-stale")
    return {
      title: "확인한 운영 설정 초안이 최신 버전이 아닙니다.",
      description: "현재 표시된 버전과 해시를 다시 검토하세요.",
      tone: "blocked",
    };
  if (status === "live-kill-switch-blocked")
    return {
      title: "킬 스위치 때문에 Live 승격을 차단했습니다.",
      description: "활성 Live 설정을 확인한 뒤 킬 스위치를 명시적으로 해제하세요.",
      tone: "blocked",
    };
  if (status === "live-policy-blocked" || status === "live-revoke-required")
    return {
      title: "현재 안전 정책으로 Live 승격할 수 없습니다.",
      description:
        status === "live-revoke-required"
          ? "이전 설정의 Live 권한을 먼저 회수한 뒤 새 설정을 승격하세요."
          : "활성 LIVE 설정, 현재 계좌 고정, 수동 승인과 극소액 한도를 확인하세요.",
      tone: "blocked",
    };
  if (status === "operational-unavailable")
    return {
      title: "실행 안전 원장을 갱신하지 못했습니다.",
      description: "아무 권한도 완화하지 않았습니다. 연결 상태를 확인한 뒤 다시 시도하세요.",
      tone: "blocked",
    };
  return null;
}
