"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import type {
  InstrumentCandidateContract,
  TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Button } from "@portfolio-rebalancer/ui";

import {
  saveTargetDraftAction,
  searchTargetInstrumentAction,
  type SaveTargetDraftActionState,
  type SearchTargetInstrumentActionState,
} from "@/app/(console)/actions";
import { formatBasisPoints, formatCurrentWeight } from "@/features/console/format";
import styles from "@/features/console/console.module.css";

import {
  buildEditableInstruments,
  buildInitialCompositionModes,
  candidateToEditableInstrument,
  isEditableAssetClass,
  targetPercentInputsForProfile,
  type AllocationProfile,
  type CompositionMode,
  type EditableAssetClass,
  type EditableInstrument,
} from "./target-settings-editor-state";

const initialSearchState: SearchTargetInstrumentActionState = {
  status: "idle",
  query: "",
  mode: null,
  catalogScope: null,
  candidates: [],
  message: null,
};

const initialSaveState: SaveTargetDraftActionState = {
  status: "idle",
  message: null,
};

export function TargetSettingsEditor({
  settings,
  csrfToken,
}: {
  readonly settings: TargetSettingsSnapshotContract;
  readonly csrfToken: string;
}) {
  const editable = settings.draftVersion ?? settings.activeVersion;
  const [instruments, setInstruments] = useState<EditableInstrument[]>(() =>
    buildEditableInstruments(settings),
  );
  const [compositionModes, setCompositionModes] = useState(() =>
    buildInitialCompositionModes(settings, buildEditableInstruments(settings)),
  );
  const [candidateClasses, setCandidateClasses] = useState<Record<string, EditableAssetClass>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [cashMode, setCashMode] = useState<"" | "FIXED_KRW" | "EXCLUDED">(
    editable?.cashPolicy.mode === "FIXED_KRW" || editable?.cashPolicy.mode === "EXCLUDED"
      ? editable.cashPolicy.mode
      : "",
  );
  const [managedCashWon, setManagedCashWon] = useState(
    editable?.cashPolicy.mode === "FIXED_KRW" ? editable.cashPolicy.amountMinor : "",
  );
  const [targetPercents, setTargetPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      settings.assets.map((asset) => {
        const configured = editable?.allocations.find(
          ({ assetKey }) => assetKey === asset.assetKey,
        );
        return [asset.assetKey, configured ? basisPointsInput(configured.targetBasisPoints) : ""];
      }),
    ),
  );
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [searchState, searchAction] = useActionState(
    searchTargetInstrumentAction,
    initialSearchState,
  );
  const [saveState, saveAction] = useActionState(saveTargetDraftAction, initialSaveState);

  const addCandidate = (candidate: InstrumentCandidateContract) => {
    const assetClass = candidateClasses[candidate.instrumentKey] ?? "CORE";
    if (instruments.some(({ instrumentKey }) => instrumentKey === candidate.instrumentKey)) {
      setPolicyNotice(`${candidate.name}은(는) 이미 목표 편집 목록에 포함되어 있습니다.`);
      return;
    }
    setInstruments((current) => [...current, candidateToEditableInstrument(candidate, assetClass)]);
    setCompositionModes((current) => ({ ...current, [assetClass]: "EQUAL" }));
    setPolicyNotice(
      `${candidate.name}은(는) 현재 미보유 종목이므로 ${assetClassLabel(assetClass)} 내부 비중을 균등 배분으로 전환했습니다.`,
    );
  };

  const updateInstrumentClass = (instrumentKey: string, assetClass: EditableAssetClass | "") => {
    const instrument = instruments.find((item) => item.instrumentKey === instrumentKey);
    setInstruments((current) =>
      current.map((item) =>
        item.instrumentKey === instrumentKey ? { ...item, assetClass } : item,
      ),
    );
    if (instrument && !instrument.isHolding && assetClass !== "") {
      setCompositionModes((current) => ({ ...current, [assetClass]: "EQUAL" }));
      setPolicyNotice(
        `${instrument.label}은(는) 현재 미보유 종목이므로 ${assetClassLabel(assetClass)} 내부 비중을 균등 배분으로 전환했습니다.`,
      );
    }
  };

  const removeInstrument = (instrumentKey: string) => {
    const instrument = instruments.find((item) => item.instrumentKey === instrumentKey);
    if (!instrument || instrument.isHolding) return;
    setInstruments((current) => current.filter((item) => item.instrumentKey !== instrumentKey));
    setPolicyNotice(`${instrument.label}을(를) 목표 편집 목록에서 제거했습니다.`);
  };

  const hasUnheldInClass = (assetClass: EditableAssetClass) =>
    instruments.some((instrument) => !instrument.isHolding && instrument.assetClass === assetClass);

  const applyAllocationProfile = (profile: AllocationProfile) => {
    setTargetPercents(targetPercentInputsForProfile(profile, cashMode));
    setPolicyNotice(
      `${allocationProfileLabel(profile)} 예시를 입력했습니다. 개인 맞춤 추천이 아니므로 투자기간, 손실 감내도와 실제 자산 성격을 확인한 뒤 저장하세요.`,
    );
  };

  return (
    <div className={styles.settingsForm}>
      <section className={styles.lookupPanel} aria-labelledby="instrument-lookup-title">
        <div>
          <h3 id="instrument-lookup-title">목표 종목 추가</h3>
          <p className={styles.fieldDescription}>
            종목명 검색은 서버에 저장된 LOCAL_VALIDATED 카탈로그만 조회합니다. 국내 6자리 종목코드나
            미국 티커는 ‘코드·티커 정확 검증’을 눌러야 서버가 토스증권 API로 별도 검증합니다.
            Apple처럼 영문 회사명과 티커가 모호한 입력은 원하는 방식을 직접 선택하세요.
          </p>
        </div>
        <form action={searchAction} className={styles.lookupForm}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <label htmlFor="instrument-query">종목명, 국내 종목코드 또는 미국 티커</label>
          <div className={styles.lookupControls}>
            <input
              id="instrument-query"
              name="instrumentQuery"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="예: 삼성전자, 005930, AAPL"
              maxLength={100}
              required
            />
            <SearchSubmitButtons />
          </div>
        </form>
        {searchState.message ? (
          <p
            className={styles.lookupFeedback}
            role={searchState.status === "error" ? "alert" : "status"}
            aria-live={searchState.status === "error" ? "assertive" : "polite"}
          >
            {searchState.message}
          </p>
        ) : null}
        {searchState.candidates.length > 0 ? (
          <ul className={styles.lookupResults} aria-label="종목 검색 결과">
            {searchState.candidates.map((candidate) => {
              const alreadyIncluded = instruments.some(
                ({ instrumentKey }) => instrumentKey === candidate.instrumentKey,
              );
              const descriptionId = `candidate-${candidate.validationId}-description`;
              return (
                <li className={styles.lookupResult} key={candidate.validationId}>
                  <div className={styles.instrumentMeta}>
                    <strong>
                      {candidate.name} ({candidate.symbol})
                    </strong>
                    <span id={descriptionId}>
                      {candidate.marketCountry} · {candidate.listingMarket} · {candidate.currency} ·{" "}
                      {candidate.source === "TOSS_EXACT"
                        ? "토스증권 즉시 검증"
                        : "서버 검증 카탈로그"}
                    </span>
                    {candidate.blockedReason ? (
                      <span className={styles.blockedText} role="alert">
                        목표 추가 차단: {candidate.blockedReason}
                      </span>
                    ) : null}
                    {candidate.tradeBlockedNow && candidate.tradeBlockedReason ? (
                      <span className={styles.attentionText}>
                        현재 주문 주의: {candidate.tradeBlockedReason}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.lookupResultActions}>
                    <label>
                      {candidate.name} 자산군
                      <select
                        aria-describedby={descriptionId}
                        value={candidateClasses[candidate.instrumentKey] ?? "CORE"}
                        onChange={(event) =>
                          setCandidateClasses((current) => ({
                            ...current,
                            [candidate.instrumentKey]: event.target.value as EditableAssetClass,
                          }))
                        }
                        disabled={!candidate.addEligible || alreadyIncluded}
                      >
                        <option value="SAFE">안전자산</option>
                        <option value="CORE">핵심 공격자산</option>
                        <option value="SATELLITE">위성 공격자산</option>
                      </select>
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-describedby={descriptionId}
                      disabled={!candidate.addEligible || alreadyIncluded}
                      onClick={() => addCandidate(candidate)}
                    >
                      {alreadyIncluded ? "이미 포함됨" : `${candidate.name} 목표에 추가`}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {policyNotice ? (
        <p className={styles.policyNotice} role="status" aria-live="polite">
          {policyNotice}
        </p>
      ) : null}

      <form className={styles.settingsForm} action={saveAction}>
        <input type="hidden" name="_csrf" value={csrfToken} />
        <fieldset className={styles.allocationFieldset}>
          <legend>목표 비중 예시</legend>
          <p className={styles.fieldDescription}>
            자산배분은 투자기간과 손실 감내도에 따라 달라지므로 하나의 정답이 없습니다. 아래 값은
            입력을 시작하기 위한 예시일 뿐 개인 맞춤 추천이 아니며 자동 저장되지 않습니다.
            안전자산·핵심 공격자산·위성 공격자산에 어떤 종목을 넣었는지도 함께 확인하세요.
          </p>
          <div className={styles.buttonRow}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => applyAllocationProfile("CONSERVATIVE")}
            >
              안정형 예시
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => applyAllocationProfile("BALANCED")}
            >
              균형형 예시
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => applyAllocationProfile("GROWTH")}
            >
              성장형 예시
            </Button>
          </div>
          <p className={styles.fieldDescription}>
            관리 현금을 평가에서 제외하면 CASH는 0%로 두고 나머지 자산군 합계를 100%로 자동
            조정합니다.
          </p>
        </fieldset>

        <fieldset className={styles.allocationFieldset}>
          <legend>관리 현금 기준</legend>
          <p className={styles.fieldDescription}>
            토스의 매수 가능 금액은 평가용 현금으로 자동 사용하지 않습니다. 실제로 관리할 원화
            금액을 고정하거나 포트폴리오 평가에서 제외하세요.
          </p>
          <div className={styles.fieldGrid}>
            <label>
              처리 방식
              <select
                name="cashMode"
                value={cashMode}
                onChange={(event) =>
                  setCashMode(event.target.value as "" | "FIXED_KRW" | "EXCLUDED")
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
                value={managedCashWon}
                onChange={(event) => setManagedCashWon(event.target.value)}
                disabled={cashMode === "EXCLUDED"}
                required={cashMode === "FIXED_KRW"}
              />
            </label>
          </div>
          <p className={styles.fieldDescription}>
            제외를 선택하면 관리 현금 목표는 0%여야 합니다. 고정 금액은 다음 계좌 수집부터 총 관리
            자산과 현금 비중에 포함됩니다.
          </p>
        </fieldset>

        <fieldset className={styles.allocationFieldset}>
          <legend>관리 종목 분류</legend>
          <p className={styles.fieldDescription}>
            현재 보유종목은 모두 한 자산군에 배치해야 합니다. 검색해 추가한 미보유 종목만 제거할 수
            있습니다.
          </p>
          <div className={styles.instrumentEditor}>
            {instruments.map((instrument) => (
              <div className={styles.instrumentRow} key={instrument.instrumentKey}>
                <input type="hidden" name="instrumentKey" value={instrument.instrumentKey} />
                <div className={styles.instrumentMeta}>
                  <strong>{instrument.label}</strong>
                  <span>
                    {instrument.description} · {instrument.isHolding ? "현재 보유" : "목표 전용"}
                  </span>
                </div>
                <label>
                  {instrument.label} 자산군
                  <select
                    name="instrumentClass"
                    value={instrument.assetClass}
                    onChange={(event) =>
                      updateInstrumentClass(
                        instrument.instrumentKey,
                        event.target.value as EditableAssetClass | "",
                      )
                    }
                    required
                  >
                    <option value="" disabled>
                      선택하세요
                    </option>
                    <option value="SAFE">안전자산</option>
                    <option value="CORE">핵심 공격자산</option>
                    <option value="SATELLITE">위성 공격자산</option>
                  </select>
                </label>
                {instrument.isHolding ? (
                  <span className={styles.lockedInstrument}>보유종목 · 제거 불가</span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`${instrument.label} 목표 종목 제거`}
                    onClick={() => removeInstrument(instrument.instrumentKey)}
                  >
                    제거
                  </Button>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        {settings.assets.map((asset) => {
          const configured = editable?.allocations.find(
            ({ assetKey }) => assetKey === asset.assetKey,
          );
          const editableClass = isEditableAssetClass(asset.assetKey) ? asset.assetKey : null;
          const hasUnheld = editableClass ? hasUnheldInClass(editableClass) : false;
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
                <label>
                  목표 (%)
                  <input
                    name="targetPercent"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    value={targetPercents[asset.assetKey] ?? ""}
                    onChange={(event) =>
                      setTargetPercents((current) => ({
                        ...current,
                        [asset.assetKey]: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                {editableClass ? (
                  <label>
                    자산군 내부 비중
                    <select
                      name="compositionMode"
                      value={compositionModes[editableClass]}
                      onChange={(event) =>
                        setCompositionModes((current) => ({
                          ...current,
                          [editableClass]: event.target.value as CompositionMode,
                        }))
                      }
                    >
                      <option value="PRESERVE_CURRENT" disabled={hasUnheld}>
                        현재 평가액 비율 보존
                      </option>
                      <option value="EQUAL">종목별 균등 배분</option>
                    </select>
                  </label>
                ) : (
                  <input type="hidden" name="compositionMode" value="PRESERVE_CURRENT" />
                )}
              </div>
              {hasUnheld ? (
                <p className={styles.attentionText}>
                  현재 미보유 종목이 있어 EQUAL_V1 균등 배분만 사용할 수 있습니다.
                </p>
              ) : null}
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

        {saveState.status === "error" && saveState.message ? (
          <p className={styles.formError} role="alert" aria-live="assertive">
            {saveState.message}
          </p>
        ) : null}
        <div className={styles.formFooter}>
          <p>저장하면 초안만 생성되며 주문이나 적용은 실행하지 않습니다.</p>
          <SaveSubmitButton />
        </div>
      </form>
    </div>
  );
}

function SearchSubmitButtons() {
  const { pending } = useFormStatus();
  return (
    <div className={styles.lookupButtonGroup}>
      <Button
        type="submit"
        name="lookupMode"
        value="CATALOG"
        variant="secondary"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? "조회 중…" : "로컬 이름 검색"}
      </Button>
      <Button type="submit" name="lookupMode" value="EXACT" disabled={pending} aria-busy={pending}>
        {pending ? "검증 중…" : "코드·티커 정확 검증"}
      </Button>
    </div>
  );
}

function SaveSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "저장 중…" : "목표 초안 저장"}
    </Button>
  );
}

function assetClassLabel(assetClass: EditableAssetClass): string {
  if (assetClass === "SAFE") return "안전자산";
  if (assetClass === "CORE") return "핵심 공격자산";
  return "위성 공격자산";
}

function allocationProfileLabel(profile: AllocationProfile): string {
  if (profile === "CONSERVATIVE") return "안정형";
  if (profile === "BALANCED") return "균형형";
  return "성장형";
}

function basisPointsInput(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return fraction === 0 ? `${whole}` : `${whole}.${fraction.toString().padStart(2, "0")}`;
}
