import type {
  OperationalConfigContract,
  OperationalConfigSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import {
  activateOperationalConfigDraftAction,
  saveOperationalConfigDraftAction,
  setKillSwitchAction,
  setLivePromotionAction,
} from "@/app/(console)/actions";
import { formatObservedAt, formatWon } from "@/features/console/format";
import styles from "@/features/console/console.module.css";

const DEFAULT_CONFIG: OperationalConfigContract = {
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
};

export function OperationalSettingsPanel({
  operational,
  csrfToken,
}: {
  readonly operational: OperationalConfigSnapshotContract;
  readonly csrfToken: string;
}) {
  const editable =
    operational.draftVersion?.config ?? operational.activeVersion?.config ?? DEFAULT_CONFIG;
  return (
    <section className={styles.pageStack} aria-labelledby="operational-settings-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="operational-settings-title">실행 안전 설정</h2>
          <p>
            Paper가 기본이며, Live는 현재 계좌 고정·킬 스위치 해제·별도 승격·주문별 최종 확인을 모두
            통과해야 합니다.
          </p>
        </div>
        <Badge tone={operational.liveOrdersEnabled ? "attention" : "normal"}>
          {operational.liveOrdersEnabled ? "Live 주문 허용" : "Live 주문 차단"}
        </Badge>
      </div>

      <section className={styles.grid3} aria-label="실행 안전 상태">
        <Surface className={styles.surface}>
          <h3>활성 실행 모드</h3>
          <p>{operational.activeVersion?.config.mode ?? "미설정"}</p>
        </Surface>
        <Surface className={styles.surface}>
          <h3>킬 스위치</h3>
          <p>{killSwitchLabel(operational.killSwitch)}</p>
        </Surface>
        <Surface className={styles.surface}>
          <h3>Live 승격</h3>
          <p>{promotionLabel(operational.livePromotion)}</p>
        </Surface>
      </section>

      <div className={styles.grid2}>
        <Surface className={styles.surface}>
          <div className={styles.sectionHeader}>
            <div>
              <h3>운영 설정 초안</h3>
              <p>계좌번호나 HMAC은 입력하지 않습니다. 서버가 현재 수집된 계좌만 봉인합니다.</p>
            </div>
            {operational.draftVersion ? (
              <Badge tone="attention">초안 v{operational.draftVersion.version}</Badge>
            ) : null}
          </div>
          <form className={styles.settingsForm} action={saveOperationalConfigDraftAction}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div className={styles.fieldGrid}>
              <label>
                실행 모드
                <select name="mode" defaultValue={editable.mode}>
                  <option value="PAPER">Paper · 브로커 전송 없음</option>
                  <option value="LIVE">Live · 안전 조건 충족 시 한 건 전송</option>
                </select>
              </label>
              <label className={styles.checkboxField}>
                <input name="liveEnabled" type="checkbox" defaultChecked={editable.live.enabled} />
                Live 주문 기능 포함
              </label>
              <label>
                승인 유효시간 (초)
                <input
                  name="approvalTtlSeconds"
                  type="number"
                  min="1"
                  max="600"
                  step="1"
                  defaultValue={editable.live.approvalTtlSeconds}
                  required
                />
              </label>
              <MoneyInput
                name="minimumOrderWon"
                label="최소 주문금액"
                value={editable.limits.minimumOrderGrossMinor}
              />
              <MoneyInput
                name="feeBufferWon"
                label="수수료 여유금"
                value={editable.limits.feeBufferMinor}
                allowZero
              />
              <MoneyInput
                name="maxSingleOrderWon"
                label="일반 단일 주문 상한"
                value={editable.limits.maxSingleOrderGrossMinor}
              />
              <MoneyInput
                name="maxDailyGrossWon"
                label="일반 일일 총거래 상한"
                value={editable.limits.maxDailyGrossMinor}
              />
              <MoneyInput
                name="liveMaxSingleOrderWon"
                label="Live 단일 주문 상한"
                value={editable.live.maxSingleOrderGrossMinor}
                maximum="100000"
              />
              <MoneyInput
                name="liveMaxDailyGrossWon"
                label="Live 일일 총거래 상한"
                value={editable.live.maxDailyGrossMinor}
                maximum="300000"
              />
              <MoneyInput
                name="tinyLiveMaxWon"
                label="첫 극소액 Live 상한"
                value={editable.live.tinyLiveMaxGrossMinor}
                maximum="50000"
              />
            </div>
            <p className={styles.fieldDescription}>
              Live는 한국 정규장 지정가·당일 주문만 지원합니다. 단일 100,000원, 일일 300,000원, 첫
              극소액 50,000원 상한은 화면 입력으로 완화할 수 없습니다.
            </p>
            <Button type="submit">운영 설정 초안 저장</Button>
          </form>
        </Surface>

        <Surface className={styles.surface}>
          <div className={styles.sectionHeader}>
            <div>
              <h3>적용과 안전 권한</h3>
              <p>설정 저장, 적용, 킬 스위치와 Live 승격은 서로 독립된 동작입니다.</p>
            </div>
          </div>
          {operational.draftVersion ? (
            <div className={styles.pageStack}>
              <dl className={styles.diagnosticList}>
                <div>
                  <dt>초안 버전</dt>
                  <dd>{operational.draftVersion.version}</dd>
                </div>
                <div>
                  <dt>모드</dt>
                  <dd>{operational.draftVersion.config.mode}</dd>
                </div>
                <div>
                  <dt>생성 시각</dt>
                  <dd>{formatObservedAt(operational.draftVersion.createdAt)}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd>
                    <code className={styles.hashValue}>{operational.draftVersion.contentHash}</code>
                  </dd>
                </div>
                <div>
                  <dt>Live 첫 주문 상한</dt>
                  <dd>{formatWon(operational.draftVersion.config.live.tinyLiveMaxGrossMinor)}</dd>
                </div>
              </dl>
              <form className={styles.settingsForm} action={activateOperationalConfigDraftAction}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <input type="hidden" name="version" value={operational.draftVersion.version} />
                <input
                  type="hidden"
                  name="contentHash"
                  value={operational.draftVersion.contentHash}
                />
                <label>
                  적용 확인 문구
                  <input
                    name="confirmation"
                    required
                    pattern="운영 설정을 적용합니다"
                    autoComplete="off"
                    placeholder="운영 설정을 적용합니다"
                  />
                </label>
                <Button type="submit">검토한 운영 설정 적용</Button>
              </form>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <strong>적용 대기 중인 운영 설정이 없습니다.</strong>
              <p>왼쪽에서 초안을 저장하면 해시와 버전을 확인한 뒤 별도로 적용할 수 있습니다.</p>
            </div>
          )}

          <div className={styles.safetyActionGroup}>
            <h3>킬 스위치</h3>
            <SafetyCommandForm
              action={setKillSwitchAction}
              state="ENGAGED"
              label="즉시 킬 스위치 작동"
              placeholder="예: 주문 기능을 즉시 중단합니다."
              csrfToken={csrfToken}
            />
            <SafetyCommandForm
              action={setKillSwitchAction}
              state="DISENGAGED"
              label="킬 스위치 해제"
              placeholder="예: Paper 검증과 현재 설정을 다시 확인했습니다."
              secondary
              csrfToken={csrfToken}
            />
          </div>

          <div className={styles.safetyActionGroup}>
            <h3>Live 승격</h3>
            <SafetyCommandForm
              action={setLivePromotionAction}
              state="GRANTED"
              label="현재 설정을 극소액 Live로 승격"
              placeholder="예: 활성 Live 설정과 한도를 최종 확인했습니다."
              csrfToken={csrfToken}
            />
            <SafetyCommandForm
              action={setLivePromotionAction}
              state="REVOKED"
              label="Live 권한 회수"
              placeholder="예: Live 주문 권한을 안전하게 회수합니다."
              secondary
              csrfToken={csrfToken}
            />
          </div>
        </Surface>
      </div>
    </section>
  );
}

function MoneyInput({
  name,
  label,
  value,
  maximum,
  allowZero = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly maximum?: string;
  readonly allowZero?: boolean;
}) {
  return (
    <label>
      {label} (원)
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={allowZero ? "0" : "1"}
        max={maximum}
        step="1"
        defaultValue={value}
        required
      />
    </label>
  );
}

function SafetyCommandForm({
  action,
  state,
  label,
  placeholder,
  secondary = false,
  csrfToken,
}: {
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly state: "ENGAGED" | "DISENGAGED" | "GRANTED" | "REVOKED";
  readonly label: string;
  readonly placeholder: string;
  readonly secondary?: boolean;
  readonly csrfToken: string;
}) {
  return (
    <form className={styles.inlineSafetyForm} action={action}>
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="state" value={state} />
      <label>
        {label} 사유
        <input name="reason" minLength={8} maxLength={500} placeholder={placeholder} required />
      </label>
      {state === "DISENGAGED" || state === "GRANTED" ? (
        <p className={styles.fieldDescription}>이 완화 동작은 최근 운영자 재인증이 필요합니다.</p>
      ) : null}
      <Button type="submit" variant={secondary ? "secondary" : "primary"}>
        {label}
      </Button>
    </form>
  );
}

function killSwitchLabel(state: OperationalConfigSnapshotContract["killSwitch"]): string {
  if (state === "ENGAGED") return "작동 중 · 모든 실행 차단";
  if (state === "DISENGAGED") return "해제됨";
  return "확인 불가 · 안전 차단";
}

function promotionLabel(state: OperationalConfigSnapshotContract["livePromotion"]): string {
  if (state === "GRANTED") return "승격됨";
  if (state === "REVOKED") return "회수됨";
  return "확인 불가 · 안전 차단";
}
