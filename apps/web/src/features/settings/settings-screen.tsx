import Link from "next/link";

import type { TargetSettingsSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import { activateTargetDraftAction, saveTargetDraftAction } from "@/app/(console)/actions";
import {
  formatBasisPoints,
  formatCurrentWeight,
  formatObservedAt,
  formatWon,
} from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function SettingsScreen({
  settings,
  status,
}: {
  readonly settings: TargetSettingsSnapshotContract;
  readonly status: string | undefined;
}) {
  const editable = settings.draftVersion ?? settings.activeVersion;
  const feedback = feedbackFor(settings.state === "UNAVAILABLE" ? "unavailable" : status);
  return (
    <>
      <ConsolePageHeader
        eyebrow="설정"
        title="목표 비중 설정"
        description="관리 현금의 기준과 자산별 목표 비중을 정하면 허용 범위는 서버가 자동 계산합니다."
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

        <div className={styles.grid2}>
          <Surface className={styles.surface} aria-labelledby="target-form-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="target-form-title">목표 초안</h2>
                <p>목표 합계를 100%로 맞춰 주세요. 허용 범위는 목표의 25%, 최대 ±5%p입니다.</p>
              </div>
              {settings.draftVersion ? (
                <Badge tone="attention">초안 v{settings.draftVersion.version}</Badge>
              ) : null}
            </div>
            {settings.assets.length > 0 ? (
              <form className={styles.settingsForm} action={saveTargetDraftAction}>
                <fieldset className={styles.allocationFieldset}>
                  <legend>관리 현금 기준</legend>
                  <p className={styles.fieldDescription}>
                    토스의 매수 가능 금액은 평가용 현금으로 자동 사용하지 않습니다. 실제로 관리할
                    원화 금액을 고정하거나 포트폴리오 평가에서 제외하세요.
                  </p>
                  <div className={styles.fieldGrid}>
                    <label>
                      처리 방식
                      <select
                        name="cashMode"
                        defaultValue={
                          editable?.cashPolicy.mode === "UNSET"
                            ? ""
                            : (editable?.cashPolicy.mode ?? "")
                        }
                        required
                      >
                        <option value="" disabled>
                          선택하세요
                        </option>
                        <option value="FIXED_KRW">고정 관리금액 포함</option>
                        <option value="EXCLUDED">포트폴리오 평가에서 제외</option>
                      </select>
                    </label>
                    <label>
                      고정 관리금액 (원)
                      <input
                        name="managedCashWon"
                        type="number"
                        inputMode="numeric"
                        min="0"
                        step="1"
                        defaultValue={
                          editable?.cashPolicy.mode === "FIXED_KRW"
                            ? editable.cashPolicy.amountMinor
                            : ""
                        }
                      />
                    </label>
                  </div>
                  <p className={styles.fieldDescription}>
                    제외를 선택하면 관리 현금 목표는 0%여야 합니다. 고정 금액은 다음 계좌 수집부터
                    총 관리 자산과 현금 비중에 포함됩니다.
                  </p>
                </fieldset>
                {settings.assets.map((asset) => {
                  const configured = editable?.allocations.find(
                    ({ assetKey }) => assetKey === asset.assetKey,
                  );
                  return (
                    <fieldset className={styles.allocationFieldset} key={asset.assetKey}>
                      <legend>{asset.label}</legend>
                      <p className={styles.fieldDescription}>
                        {asset.description} · 현재{" "}
                        {asset.currentBasisPointHundredths === null
                          ? "계산 전"
                          : formatCurrentWeight(asset.currentBasisPointHundredths)}
                      </p>
                      <input type="hidden" name="assetKey" value={asset.assetKey} />
                      <div className={styles.fieldGrid}>
                        <PercentField
                          label="목표"
                          name="targetPercent"
                          value={configured?.targetBasisPoints}
                        />
                      </div>
                      <p className={styles.fieldDescription}>
                        {configured
                          ? `저장된 허용 범위 ${formatBasisPoints(
                              configured.lowerBasisPoints,
                            )}–${formatBasisPoints(configured.upperBasisPoints)}`
                          : "초안 저장 시 MIXED_V1 정책으로 하한·상한을 계산합니다."}
                      </p>
                    </fieldset>
                  );
                })}
                <div className={styles.formFooter}>
                  <Button type="submit">목표 초안 저장</Button>
                </div>
              </form>
            ) : (
              <div className={styles.emptyState}>
                <strong>
                  {settings.state === "UNAVAILABLE"
                    ? "설정 정보를 불러올 수 없습니다."
                    : "설정할 보유자산이 없습니다."}
                </strong>
                <p>문제 해결에서 계좌 정보를 먼저 확인해 주세요.</p>
              </div>
            )}
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

function PercentField({
  label,
  name,
  value,
}: {
  readonly label: string;
  readonly name: string;
  readonly value: number | undefined;
}) {
  return (
    <label>
      {label} (%)
      <input
        name={name}
        type="number"
        inputMode="decimal"
        min="0"
        max="100"
        step="0.01"
        defaultValue={value === undefined ? "" : basisPointsInput(value)}
        required
      />
    </label>
  );
}

function basisPointsInput(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return fraction === 0 ? `${whole}` : `${whole}.${fraction.toString().padStart(2, "0")}`;
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
  return null;
}
