import Link from "next/link";

import type { TargetSettingsSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import { activateTargetDraftAction, saveTargetDraftAction } from "@/app/(console)/actions";
import {
  formatBasisPoints,
  formatCurrentWeight,
  formatObservedAt,
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
        description="현재 보유자산의 목표와 허용 범위를 버전형 초안으로 저장한 뒤 별도로 적용합니다. 비밀정보, 주문 한도와 live 전환은 이 화면에서 다루지 않습니다."
      />
      {feedback ? (
        <div className={styles.callout} data-tone={feedback.tone} role="status">
          <strong>{feedback.title}</strong>
          <p>{feedback.description}</p>
        </div>
      ) : null}
      {settings.requiresCollection ? (
        <div className={styles.callout} data-tone="attention">
          <strong>새 목표가 활성화됐지만 최신 스냅샷에는 아직 고정되지 않았습니다.</strong>
          <p>
            <Link className={styles.safeLink} href="/troubleshooting">
              문제 해결
            </Link>
            에서 read-only 재점검을 실행하기 전까지 리밸런싱과 주문 계획이 차단됩니다.
          </p>
        </div>
      ) : null}

      <section className={styles.grid3} aria-label="설정 상태">
        <Surface className={styles.surface}>
          <h3>현재 계좌</h3>
          <p>{settings.accountLabel ?? "확인 필요"}</p>
        </Surface>
        <Surface className={styles.surface}>
          <h3>활성 목표</h3>
          <p>{settings.activeVersion ? `버전 ${settings.activeVersion.version}` : "미설정"}</p>
        </Surface>
        <Surface className={styles.surface}>
          <h3>스냅샷 목표</h3>
          <p>
            {settings.snapshotTargetVersion
              ? `버전 ${settings.snapshotTargetVersion}`
              : "고정되지 않음"}
          </p>
        </Surface>
      </section>

      <div className={styles.grid2}>
        <Surface className={styles.surface} aria-labelledby="target-form-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="target-form-title">목표 초안</h2>
              <p>목표 합계는 정확히 100%여야 하며 하한 ≤ 목표 ≤ 상한을 서버에서 검증합니다.</p>
            </div>
            {settings.draftVersion ? (
              <Badge tone="attention">초안 v{settings.draftVersion.version}</Badge>
            ) : (
              <Badge tone="info">주문과 분리</Badge>
            )}
          </div>
          {settings.assets.length > 0 ? (
            <form className={styles.settingsForm} action={saveTargetDraftAction}>
              {settings.assets.map((asset) => {
                const configured = editable?.allocations.find(
                  ({ assetKey }) => assetKey === asset.assetKey,
                );
                return (
                  <fieldset className={styles.allocationFieldset} key={asset.assetKey}>
                    <legend>{asset.label}</legend>
                    <p className={styles.fieldDescription}>
                      {asset.description} · 현재{" "}
                      {formatCurrentWeight(asset.currentBasisPointHundredths)}
                    </p>
                    <input type="hidden" name="assetKey" value={asset.assetKey} />
                    <div className={styles.fieldGrid}>
                      <PercentField
                        label="하한"
                        name="lowerPercent"
                        value={configured?.lowerBasisPoints}
                      />
                      <PercentField
                        label="목표"
                        name="targetPercent"
                        value={configured?.targetBasisPoints}
                      />
                      <PercentField
                        label="상한"
                        name="upperPercent"
                        value={configured?.upperBasisPoints}
                      />
                    </div>
                  </fieldset>
                );
              })}
              <div className={styles.formFooter}>
                <p>저장은 초안만 만들며 계획이나 주문을 생성하지 않습니다.</p>
                <Button type="submit">목표 초안 저장</Button>
              </div>
            </form>
          ) : (
            <div className={styles.emptyState}>
              <strong>
                {settings.state === "UNAVAILABLE"
                  ? "설정 저장소에 연결할 수 없습니다."
                  : "설정할 보유자산이 없습니다."}
              </strong>
              <p>먼저 문제 해결에서 실제 계좌 스냅샷을 수집하세요.</p>
            </div>
          )}
        </Surface>

        <div className={styles.stack}>
          <Surface className={styles.surface} aria-labelledby="version-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="version-title">버전 검토</h2>
                <p>초안 적용도 주문 실행과 연결되지 않습니다.</p>
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
                <p>왼쪽에서 목표 비중을 입력해 초안을 저장하세요.</p>
              </div>
            )}
          </Surface>
          <Surface className={styles.surface} aria-labelledby="boundary-title">
            <h2 id="boundary-title">이 화면의 안전 경계</h2>
            <ul className={styles.statusList}>
              <li>
                <div>
                  <strong>토스 API 비밀정보</strong>
                  <span>브라우저에 전달하거나 편집하지 않음</span>
                </div>
                <Badge tone="normal">보호</Badge>
              </li>
              <li>
                <div>
                  <strong>계획·주문 생성</strong>
                  <span>설정 저장과 별도 동작</span>
                </div>
                <Badge tone="blocked">차단</Badge>
              </li>
              <li>
                <div>
                  <strong>live 모드</strong>
                  <span>활성화 경로 없음</span>
                </div>
                <Badge tone="blocked">차단</Badge>
              </li>
            </ul>
          </Surface>
        </div>
      </div>
    </>
  );
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
      description: "합계 100%, 모든 보유자산과 하한·목표·상한 순서를 확인하세요.",
      tone: "blocked",
    };
  if (status === "activate-invalid")
    return {
      title: "초안을 적용하지 못했습니다.",
      description: "적용할 초안 버전을 다시 확인하세요. 설정과 주문은 변경되지 않았습니다.",
      tone: "blocked",
    };
  if (status === "draft-stale")
    return {
      title: "스냅샷이 바뀌어 초안을 적용하지 않았습니다.",
      description:
        "현재 보유자산으로 목표 초안을 다시 저장하세요. 기존 설정과 주문은 변경되지 않았습니다.",
      tone: "blocked",
    };
  if (status === "unavailable")
    return {
      title: "설정 엔진에 연결할 수 없습니다.",
      description:
        "목표 설정과 주문은 변경되지 않았습니다. engine과 PostgreSQL 상태를 확인한 뒤 다시 시도하세요.",
      tone: "blocked",
    };
  return null;
}
