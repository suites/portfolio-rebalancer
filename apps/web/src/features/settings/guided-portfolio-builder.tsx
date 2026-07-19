"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type {
  GuidedPortfolioRecommendationContract,
  TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button } from "@portfolio-rebalancer/ui";

import { saveTargetDraftAction, type SaveTargetDraftActionState } from "@/app/(console)/actions";
import { formatWon } from "@/features/console/format";
import styles from "@/features/console/console.module.css";

const initialSaveState: SaveTargetDraftActionState = { status: "idle", message: null };
type RiskProfile = GuidedPortfolioRecommendationContract["profile"];

export function GuidedPortfolioBuilder({
  settings,
}: {
  readonly settings: TargetSettingsSnapshotContract;
}) {
  const [profile, setProfile] = useState<RiskProfile>("BALANCED");
  const [saveState, saveAction] = useActionState(saveTargetDraftAction, initialSaveState);
  const recommendation =
    settings.guidedRecommendations.find((item) => item.profile === profile) ??
    settings.guidedRecommendations[0];

  if (!recommendation) return null;

  return (
    <div className={styles.guidedBuilder}>
      <div className={styles.guidedIntro}>
        <div>
          <Badge tone="info">추천 엔진 · Paper 우선</Badge>
          <h3>투자성향만 고르면 포트폴리오를 만들어 드려요</h3>
          <p>
            승인된 ETF 중 4개를 선택하고 비중까지 계산했습니다. 저장은 검토용 초안만 만들며, 주문은
            발생하지 않습니다.
          </p>
        </div>
        <dl className={styles.guidedAssetSummary}>
          <div>
            <dt>관리 대상</dt>
            <dd>
              {settings.totalManagedAssetsMinor
                ? formatWon(settings.totalManagedAssetsMinor)
                : "현재 보유주식 전체"}
            </dd>
          </div>
          <div>
            <dt>추천 종목</dt>
            <dd>{recommendation.instruments.length}개</dd>
          </div>
        </dl>
      </div>

      <fieldset className={styles.profilePicker}>
        <legend>내 투자성향</legend>
        <div className={styles.profileOptions}>
          {settings.guidedRecommendations.map((option) => {
            const value = option.profile;
            return (
              <label className={styles.profileOption} data-selected={profile === value} key={value}>
                <input
                  type="radio"
                  name="riskProfilePreview"
                  value={value}
                  checked={profile === value}
                  onChange={() => setProfile(value)}
                />
                <strong>{option.title}</strong>
                <span>{option.description}</span>
                <small>
                  안전자산 {option.safePercent}% · 성장자산 {option.corePercent}%
                </small>
              </label>
            );
          })}
        </div>
      </fieldset>

      <section className={styles.recommendationPreview} aria-live="polite">
        <div className={styles.sectionHeader}>
          <div>
            <h3>{recommendation.title} 추천안</h3>
            <p>{recommendation.description}</p>
          </div>
          <Badge tone="info">합계 100%</Badge>
        </div>
        <div className={styles.allocationSummary} aria-label="추천 자산 비중">
          <span style={{ flexBasis: `${recommendation.safePercent}%` }} data-kind="safe">
            국고채 {recommendation.safePercent}%
          </span>
          <span style={{ flexBasis: `${recommendation.corePercent}%` }} data-kind="core">
            주식 ETF {recommendation.corePercent}%
          </span>
        </div>
        <ul className={styles.recommendationList}>
          {recommendation.instruments.map((instrument) => (
            <li key={instrument.instrumentKey}>
              <div>
                <strong>{instrument.name}</strong>
                <span>{instrument.role}</span>
              </div>
              <Badge tone={instrument.assetClass === "SAFE" ? "neutral" : "info"}>
                {instrument.assetClass === "SAFE"
                  ? `${recommendation.safePercent}%`
                  : `각 ${(recommendation.corePercent / 3).toFixed(2)}% 내외`}
              </Badge>
            </li>
          ))}
        </ul>
        {recommendation.retiringHoldings.length > 0 ? (
          <div className={styles.exitNotice}>
            <strong>
              기존 보유종목 {recommendation.retiringHoldings.length}개는 목표 0%로 정리
            </strong>
            <p>
              추천안에 없는 기존 종목은 즉시 매도하지 않습니다. 초안 적용 후 별도 리밸런싱 계획에서
              예상 주문을 다시 확인하고 승인해야 합니다.
            </p>
          </div>
        ) : null}
      </section>

      <form action={saveAction} className={styles.guidedApproval}>
        <input type="hidden" name="cashMode" value="EXCLUDED" />
        <input type="hidden" name="managedCashWon" value="0" />
        {[
          ["SAFE", recommendation.safePercent],
          ["CORE", recommendation.corePercent],
          ["SATELLITE", 0],
          ["CASH", 0],
        ].map(([assetKey, targetPercent]) => (
          <span key={assetKey}>
            <input type="hidden" name="assetKey" value={assetKey} />
            <input type="hidden" name="targetPercent" value={targetPercent} />
            <input type="hidden" name="compositionMode" value="EQUAL" />
          </span>
        ))}
        {recommendation.memberships.map(({ instrumentKey, assetClass }) => (
          <span key={instrumentKey}>
            <input type="hidden" name="instrumentKey" value={instrumentKey} />
            <input type="hidden" name="instrumentClass" value={assetClass} />
          </span>
        ))}
        <div>
          <strong>확인 후 초안만 저장합니다</strong>
          <p>
            추천 종목은 저장 시 토스증권에서 다시 검증하며, 실패하면 아무 설정도 바뀌지 않습니다.
          </p>
        </div>
        <GuidedSubmitButton />
      </form>
      {saveState.status === "error" && saveState.message ? (
        <p className={styles.formError} role="alert" aria-live="assertive">
          {saveState.message}
        </p>
      ) : null}
    </div>
  );
}

function GuidedSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "추천안 검증 중" : "이 추천안으로 초안 만들기"}
    </Button>
  );
}
