import Link from "next/link";

import type {
  DashboardSnapshotContract,
  OperationalConfigSnapshotContract,
  RebalancePlanSnapshotContract,
  StoredRebalancePlanContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button, StatusBanner, Surface } from "@portfolio-rebalancer/ui";

import {
  createRebalancePlanAction,
  executeLivePlanAction,
  executePaperPlanAction,
} from "@/app/(console)/actions";
import {
  formatBasisPoints,
  formatCurrentWeight,
  formatObservedAt,
  formatWon,
} from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function RebalancingScreen({
  snapshot,
  plan,
  operational,
  actionStatus,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly plan: RebalancePlanSnapshotContract;
  readonly operational: OperationalConfigSnapshotContract;
  readonly actionStatus: string | undefined;
}) {
  const targetFixed =
    snapshot.allocations.length > 0 &&
    snapshot.allocations.every(({ targetBasisPoints }) => targetBasisPoints !== null) &&
    !["TARGET_CONFIG_STALE", "UNMANAGED_ASSET"].includes(snapshot.blockReason?.code ?? "");
  const tone =
    snapshot.conclusion === "BLOCKED"
      ? "blocked"
      : snapshot.conclusion === "REBALANCE_REQUIRED"
        ? "attention"
        : "normal";
  const title =
    snapshot.blockReason?.problem ??
    (snapshot.conclusion === "REBALANCE_REQUIRED"
      ? "허용 범위를 벗어난 자산이 있습니다."
      : "현재 목표 범위 안에 있습니다.");
  const description = snapshot.blockReason
    ? `${snapshot.blockReason.protectiveAction} ${snapshot.blockReason.nextAction}`
    : "현재 비중과 목표 범위를 확인했습니다.";
  return (
    <>
      <ConsolePageHeader
        eyebrow="리밸런싱"
        title="리밸런싱 점검"
        description="현재 비중과 목표 범위를 비교하고 필요한 조치를 확인하세요."
      />
      <div className={styles.pageStack}>
        {actionStatus ? (
          <div
            className={styles.callout}
            data-tone={actionFeedback(actionStatus).tone}
            role="status"
          >
            <strong>{actionFeedback(actionStatus).title}</strong>
            <p>{actionFeedback(actionStatus).description}</p>
          </div>
        ) : null}
        <StatusBanner
          tone={tone}
          icon={tone === "normal" ? "✓" : tone === "attention" ? "↗" : "!"}
          eyebrow="현재 판단"
          title={title}
          description={description}
        />

        <div className={styles.grid2}>
          <Surface className={styles.surface} aria-labelledby="comparison-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="comparison-title">현재와 목표 비교</h2>
                <p>목표가 없는 자산은 미설정으로 표시합니다.</p>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption>자산별 현재 비중, 목표와 허용 범위 판정</caption>
                <thead>
                  <tr>
                    <th scope="col">자산</th>
                    <th scope="col">현재</th>
                    <th scope="col">목표</th>
                    <th scope="col">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.allocations.map((allocation) => (
                    <tr key={allocation.id}>
                      <td>
                        <strong>{allocation.label}</strong>
                      </td>
                      <td data-numeric="true">
                        {formatCurrentWeight(allocation.currentBasisPointHundredths)}
                      </td>
                      <td data-numeric="true">
                        {allocation.targetBasisPoints === null
                          ? "미설정"
                          : formatBasisPoints(allocation.targetBasisPoints)}
                      </td>
                      <td>
                        <Badge tone={allocation.bandStatus === "IN_RANGE" ? "normal" : "attention"}>
                          {allocation.bandStatus === "IN_RANGE"
                            ? "범위 안"
                            : allocation.bandStatus === "OUTSIDE_BAND"
                              ? "이탈"
                              : "미설정"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface className={styles.surface} aria-labelledby="risk-title">
            <h2 id="risk-title">점검 항목</h2>
            <ul className={styles.statusList}>
              <CheckRow
                label="계좌 정보"
                description="최근 보유자산 확인"
                passed={snapshot.brokerConnection === "CONNECTED" && snapshot.observedAt !== null}
              />
              <CheckRow label="목표 설정" description="현재 계좌에 적용됨" passed={targetFixed} />
              <CheckRow
                label="관리 현금"
                description="평가에 사용할 관리 기준 반영"
                passed={snapshot.managedCashMinor !== null}
              />
              <li>
                <div>
                  <strong>거래 가능 여부</strong>
                  <span>가격, 수수료와 시장 상태 확인 필요</span>
                </div>
                <Badge tone="blocked">확인 필요</Badge>
              </li>
            </ul>
          </Surface>
        </div>

        <PlanSurface snapshot={snapshot} plan={plan} operational={operational} />
      </div>
    </>
  );
}

function PlanSurface({
  snapshot,
  plan,
  operational,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly plan: RebalancePlanSnapshotContract;
  readonly operational: OperationalConfigSnapshotContract;
}) {
  const latest = plan.latest;
  const canCreate =
    snapshot.state === "READY" && snapshot.blockReason === null && plan.state !== "UNAVAILABLE";
  return (
    <Surface className={styles.surface} aria-labelledby="plan-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="plan-title">저장된 주문 제안</h2>
          <p>
            {latest
              ? `저장된 계획 · ${formatObservedAt(latest.completedAt)}`
              : plan.state === "UNAVAILABLE"
                ? "계획 저장소에 연결할 수 없습니다."
                : "아직 저장된 리밸런싱 계획이 없습니다."}
          </p>
        </div>
        <Badge tone={planTone(latest)}>
          {latest
            ? planStatusLabel(latest.status)
            : plan.state === "UNAVAILABLE"
              ? "알 수 없음"
              : "대기"}
        </Badge>
      </div>

      {latest ? (
        <StoredPlanDetails
          plan={latest}
          accountLabel={snapshot.accountLabel}
          observedAt={snapshot.observedAt}
        />
      ) : null}

      <div className={styles.buttonRow}>
        <form action={createRebalancePlanAction}>
          <input type="hidden" name="mode" value="SHADOW" />
          <Button type="submit" disabled={!canCreate}>
            Shadow 계획 만들기
          </Button>
        </form>
        <form action={createRebalancePlanAction}>
          <input type="hidden" name="mode" value="PAPER" />
          <Button type="submit" disabled={!canCreate}>
            Paper 계획 만들기
          </Button>
        </form>
        <form action={createRebalancePlanAction}>
          <input type="hidden" name="mode" value="LIVE" />
          <Button type="submit" disabled={!canCreate}>
            Live 계획만 만들기
          </Button>
        </form>
        <Link
          className={styles.safeLink}
          href={
            snapshot.blockReason?.code === "TARGET_CONFIG_MISSING" ||
            snapshot.blockReason?.code === "MANAGED_CASH_MISSING"
              ? "/settings"
              : "/troubleshooting"
          }
        >
          {canCreate ? "점검 상태 확인" : "먼저 해결할 항목 보기"}
        </Link>
      </div>
      <p className={styles.fieldDescription}>
        이 단계는 어떤 모드에서도 실제 주문을 제출하지 않습니다. Paper와 Live도 먼저 저장된 계획만
        만들며, 실행은 별도의 위험 점검·주문 원장·최종 확인을 통과해야 합니다. 같은
        snapshot·설정·모드의 중복 클릭은 기존 계획을 반환합니다.
      </p>

      {latest?.mode === "PAPER" &&
      latest.status === "PLANNED" &&
      latest.executableOrders.length > 0 ? (
        <div className={styles.executionPanel}>
          <div>
            <h3>Paper 실행</h3>
            <p>
              현재 호가·호가잔량·수수료 증거로 주문 원장과 체결을 재생합니다. 토스 주문 API는
              호출하지 않습니다.
            </p>
          </div>
          <form action={executePaperPlanAction}>
            <input type="hidden" name="planId" value={latest.planId} />
            <Button type="submit">Paper 주문 원장 실행</Button>
          </form>
        </div>
      ) : null}

      {latest?.mode === "LIVE" &&
      latest.status === "PLANNED" &&
      latest.executableOrders.length > 0 ? (
        <div className={styles.liveExecutionPanel}>
          <div>
            <h3>Live 최종 확인</h3>
            <p>
              한 번의 실행에서 매도 우선 첫 주문 한 건만 전송합니다. 체결을 확인하고 새 계좌
              snapshot과 계획을 만든 뒤 다음 주문을 검토해야 합니다.
            </p>
          </div>
          <LiveFinalReview
            plan={latest}
            accountLabel={snapshot.accountLabel}
            observedAt={snapshot.observedAt}
          />
          {operational.liveOrdersEnabled ? (
            <form className={styles.settingsForm} action={executeLivePlanAction}>
              <input type="hidden" name="planId" value={latest.planId} />
              <input type="hidden" name="planHash" value={latest.planHash} />
              <label>
                아래 문구를 정확히 입력하세요
                <input
                  name="confirmation"
                  required
                  pattern="LIVE 주문 계획과 금액을 확인했습니다"
                  autoComplete="off"
                  placeholder="LIVE 주문 계획과 금액을 확인했습니다"
                />
              </label>
              <p className={styles.fieldDescription}>
                이 동작은 Tailscale 내부 콘솔과 Live 안전 조건을 통과할 때만 진행됩니다.
              </p>
              <Button type="submit">승인 생성 후 Live 첫 주문 1회 전송</Button>
            </form>
          ) : (
            <div className={styles.blockedState}>
              <strong>Live 주문은 현재 차단되어 있습니다.</strong>
              <p>
                설정에서 ACTIVE LIVE 구성, 현재 계좌 고정, 킬 스위치 해제와 별도 Live 승격을 모두
                완료하세요.
              </p>
              <Link className={styles.safeLink} href="/settings">
                실행 안전 설정 열기
              </Link>
            </div>
          )}
        </div>
      ) : null}
    </Surface>
  );
}

function StoredPlanDetails({
  plan,
  accountLabel,
  observedAt,
}: {
  readonly plan: StoredRebalancePlanContract;
  readonly accountLabel: string | null;
  readonly observedAt: string | null;
}) {
  const totalNotionalMinor = totalPlanNotionalMinor(plan);
  return (
    <div className={styles.pageStack}>
      <div
        className={styles.callout}
        data-tone={
          plan.status === "BLOCKED"
            ? "blocked"
            : plan.status === "PLANNED"
              ? "attention"
              : undefined
        }
      >
        <strong>{planReasonTitle(plan)}</strong>
        <p>{plan.reasonCodes.map(reasonLabel).join(" · ")}</p>
      </div>

      <dl className={styles.diagnosticList}>
        <div>
          <dt>대상 계좌</dt>
          <dd>{accountLabel ?? "확인 불가"}</dd>
        </div>
        <div>
          <dt>주문 후보</dt>
          <dd>{plan.executableOrders.length.toLocaleString("ko-KR")}건</dd>
        </div>
        <div>
          <dt>총 예상 거래금액</dt>
          <dd>{formatWon(totalNotionalMinor.toString())}</dd>
        </div>
        <div>
          <dt>예상 비용</dt>
          <dd>주문 직전 수수료 일정으로 재검증</dd>
        </div>
        <div>
          <dt>데이터 기준 시각</dt>
          <dd>{formatObservedAt(observedAt)}</dd>
        </div>
      </dl>

      {plan.executableOrders.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption>저장된 {modeLabel(plan.mode)} 주문 후보</caption>
            <thead>
              <tr>
                <th scope="col">단계</th>
                <th scope="col">종목</th>
                <th scope="col">방향</th>
                <th scope="col">수량</th>
                <th scope="col">지정가</th>
                <th scope="col">예상 금액</th>
              </tr>
            </thead>
            <tbody>
              {plan.executableOrders.map((order) => (
                <tr key={order.candidateId}>
                  <td>{order.phase === "SELL" ? "A 매도" : "B 매수"}</td>
                  <td>
                    <strong>{order.instrumentKey}</strong>
                  </td>
                  <td>{order.side === "SELL" ? "매도" : "매수"}</td>
                  <td data-numeric="true">{BigInt(order.quantity).toLocaleString("ko-KR")}주</td>
                  <td data-numeric="true">{formatWon(order.limitPriceMinor)}</td>
                  <td data-numeric="true">{formatWon(order.notionalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.fieldDescription}>즉시 검토할 주문 후보는 없습니다.</p>
      )}

      {plan.deferredBuyNeeds.length > 0 ? (
        <div>
          <h3>다음 snapshot에서 다시 계산할 매수 필요</h3>
          <ul className={styles.statusList}>
            {plan.deferredBuyNeeds.map((need) => (
              <li key={need.instrumentKey}>
                <div>
                  <strong>{need.instrumentKey}</strong>
                  <span>{need.reasonCodes.map(reasonLabel).join(" · ")}</span>
                </div>
                <span>{formatWon(need.remainingNeedMinor)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.projectedAllocations.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption>주문 후보 반영 후 예상 자산군 비중</caption>
            <thead>
              <tr>
                <th scope="col">자산군</th>
                <th scope="col">예상</th>
                <th scope="col">목표</th>
                <th scope="col">허용 범위</th>
              </tr>
            </thead>
            <tbody>
              {plan.projectedAllocations.map((allocation) => (
                <tr key={allocation.id}>
                  <td>
                    <strong>{assetLabel(allocation.id)}</strong>
                  </td>
                  <td data-numeric="true">
                    {formatBasisPoints(Number(allocation.currentBasisPoints))}
                  </td>
                  <td data-numeric="true">
                    {formatBasisPoints(Number(allocation.targetBasisPoints))}
                  </td>
                  <td data-numeric="true">
                    {formatBasisPoints(Number(allocation.lowerBasisPoints))}–
                    {formatBasisPoints(Number(allocation.upperBasisPoints))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function LiveFinalReview({
  plan,
  accountLabel,
  observedAt,
}: {
  readonly plan: StoredRebalancePlanContract;
  readonly accountLabel: string | null;
  readonly observedAt: string | null;
}) {
  const orderedOrders = [...plan.executableOrders].sort(
    (left, right) =>
      phaseRank(left.phase) - phaseRank(right.phase) ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const firstOrder = orderedOrders[0]!;
  const remainingOrderCount = Math.max(0, orderedOrders.length - 1);
  return (
    <div className={styles.pageStack}>
      <dl className={styles.diagnosticList}>
        <div>
          <dt>실거래 대상 계좌</dt>
          <dd>{accountLabel ?? "확인 불가"}</dd>
        </div>
        <div>
          <dt>이번에 전송할 첫 주문</dt>
          <dd>
            {firstOrder.side === "SELL" ? "매도" : "매수"} {firstOrder.instrumentKey}{" "}
            {BigInt(firstOrder.quantity).toLocaleString("ko-KR")}주 · 지정가{" "}
            {formatWon(firstOrder.limitPriceMinor)}
          </dd>
        </div>
        <div>
          <dt>이번 전송 뒤 남는 계획 주문</dt>
          <dd>{remainingOrderCount.toLocaleString("ko-KR")}건</dd>
        </div>
        <div>
          <dt>전체 계획 예상 거래금액</dt>
          <dd>{formatWon(totalPlanNotionalMinor(plan).toString())}</dd>
        </div>
        <div>
          <dt>비용 확인</dt>
          <dd>전송 직전 최신 수수료·매수 가능 금액·매도 가능 수량으로 다시 검증</dd>
        </div>
        <div>
          <dt>데이터 기준 시각</dt>
          <dd>{formatObservedAt(observedAt)}</dd>
        </div>
      </dl>
      <p className={styles.fieldDescription}>
        지정가와 수량은 봉인된 계획 값이며 실제 체결가격·수수료·체결 여부는 달라질 수 있습니다. 첫
        주문 결과를 확인하기 전에는 남은 주문을 자동으로 전송하지 않습니다.
      </p>
    </div>
  );
}

function totalPlanNotionalMinor(plan: StoredRebalancePlanContract): bigint {
  return plan.executableOrders.reduce((total, order) => total + BigInt(order.notionalMinor), 0n);
}

function phaseRank(phase: "SELL" | "BUY"): number {
  return phase === "SELL" ? 0 : 1;
}

function CheckRow({
  label,
  description,
  passed,
}: {
  readonly label: string;
  readonly description: string;
  readonly passed: boolean;
}) {
  return (
    <li>
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <Badge tone={passed ? "normal" : "blocked"}>{passed ? "확인됨" : "차단"}</Badge>
    </li>
  );
}

function planTone(plan: StoredRebalancePlanContract | null): "normal" | "attention" | "blocked" {
  if (!plan || plan.status === "BLOCKED") return "blocked";
  return plan.status === "PLANNED" ? "attention" : "normal";
}

function planStatusLabel(status: StoredRebalancePlanContract["status"]): string {
  if (status === "PLANNED") return "계획 있음";
  if (status === "NO_ACTION") return "조치 없음";
  return "차단";
}

function planReasonTitle(plan: StoredRebalancePlanContract): string {
  if (plan.status === "PLANNED")
    return `${plan.executableOrders.length}개 주문 후보를 저장했습니다.`;
  if (plan.status === "NO_ACTION") return "현재 snapshot에서는 실행할 주문 후보가 없습니다.";
  return "안전 조건을 확인하지 못해 주문 후보를 만들지 않았습니다.";
}

function modeLabel(mode: StoredRebalancePlanContract["mode"]): string {
  if (mode === "SHADOW") return "Shadow";
  if (mode === "PAPER") return "Paper";
  return "Live";
}

function reasonLabel(code: string): string {
  const labels: Record<string, string> = {
    NO_REBALANCE_NEEDED: "모든 자산이 목표 범위 안",
    REBALANCE_NEEDS_NO_ORDER_CANDIDATE: "비중 조정은 필요하지만 대응 종목 없음",
    NO_EXECUTABLE_ORDER_AFTER_ROUNDING: "수량·최소금액 반올림 후 주문 없음",
    SELL_PHASE_READY: "매도 단계 준비",
    BUY_PHASE_READY: "매수 단계 준비",
    BUY_PHASE_DEFERRED: "매도 체결 확인 뒤 매수 재계산",
    BUY_NEEDS_REMAIN: "현금·반올림으로 남은 매수 필요",
    IDENTITY_MISSING: "snapshot 또는 설정 식별자 누락",
    IDENTITY_MISMATCH: "계획 중 snapshot 또는 설정 변경",
    MANAGED_CASH_UNSET: "관리 현금 기준 미설정",
    PRICE_MISSING_OR_INVALID: "가격 증거 확인 불가",
    UNSUPPORTED_MARKET: "현재 계획은 한국 시장만 지원",
    SELLABLE_QUANTITY_MISSING: "매도 가능 수량 확인 불가",
    SELLABLE_QUANTITY_INSUFFICIENT: "매도 가능 수량 부족",
    QUOTE_STALE: "시세 freshness 기준 미충족",
    MARKET_CALENDAR_STALE: "시장 캘린더 freshness 기준 미충족",
    MARKET_SESSION_UNVERIFIED: "한국 정규 연속매매 세션 확인 불가",
    TRADE_RESTRICTION_UNVERIFIED: "종목 거래 제한 재검증 실패",
    COMMISSION_UNVERIFIED: "수수료 일정 검증 실패",
  };
  return labels[code] ?? code;
}

function assetLabel(id: string): string {
  if (id === "SAFE") return "안전자산";
  if (id === "CORE") return "핵심 공격자산";
  if (id === "SATELLITE") return "위성 공격자산";
  if (id === "CASH") return "관리 현금";
  return id;
}

function actionFeedback(status: string): {
  readonly title: string;
  readonly description: string;
  readonly tone?: "attention" | "blocked";
} {
  if (status === "paper-executed")
    return {
      title: "Paper 주문 원장을 실행했습니다.",
      description: "토스 주문 API는 호출하지 않았습니다. 주문·기록에서 재생 상태를 확인하세요.",
    };
  if (status === "paper-execution-pending")
    return {
      title: "Paper 주문 원장을 만들었고 재생 상태는 진행 중입니다.",
      description: "토스 주문 API는 호출하지 않았습니다. 주문·기록에서 각 주문 상태를 확인하세요.",
      tone: "attention",
    };
  if (status === "live-order-completed")
    return {
      title: "Live 첫 주문 결과를 확인했습니다.",
      description:
        "엔진 receipt가 완료 상태를 반환했습니다. 주문·기록에서 저장된 브로커 증거를 확인하세요.",
    };
  if (status === "live-order-pending")
    return {
      title: "Live 첫 주문은 접수·대사 진행 상태입니다.",
      description:
        "성공 완료로 간주하지 않습니다. 자동으로 다음 주문을 보내지 않으며 주문·기록에서 브로커 상태를 확인해야 합니다.",
      tone: "attention",
    };
  const messages: Record<string, string> = {
    "plan-mode-invalid":
      "계획 모드를 확인하지 못했습니다. Shadow, Paper 또는 Live 중 하나를 선택하세요.",
    "plan-no-snapshot": "먼저 토스 계좌 snapshot을 수집하세요.",
    "plan-target-required": "목표 비중을 적용하고 새 snapshot에 고정하세요.",
    "plan-cash-required": "설정에서 관리 현금을 고정 금액으로 포함하거나 평가에서 제외하세요.",
    "plan-in-progress": "같은 snapshot의 계획 생성이 진행 중입니다. 잠시 뒤 다시 확인하세요.",
    "execute-input-invalid": "실행할 계획 ID를 확인하지 못했습니다.",
    "live-confirmation-required": "Live 주문 계획과 금액 확인 문구를 정확히 입력하세요.",
    "live-approval-stale": "계획이 바뀌었거나 주문별 승인이 만료되어 주문을 전송하지 않았습니다.",
    "order-execution-blocked":
      "위험 게이트, 최신 시세, 계좌 한도 또는 실행 안전 상태를 모두 확인하지 못했습니다.",
    "paper-execution-blocked": "Paper 주문 원장 실행이 receipt의 BLOCKED 결과로 종료됐습니다.",
    "paper-refresh-required": "새 snapshot 또는 시세로 Paper 계획을 다시 만들어야 합니다.",
    "live-refresh-required":
      "Live 실행 receipt가 새 snapshot과 계획을 요구했습니다. 주문을 추가 전송하지 않았습니다.",
    "paper-execute-unavailable": "Paper 주문 원장을 안전하게 기록하지 못했습니다.",
    "live-execute-unavailable":
      "Live dispatch claim 또는 브로커 결과를 안전하게 기록하지 못해 추가 전송을 차단했습니다.",
    "order-input-invalid": "주문 실행 입력을 확인하지 못했습니다.",
  };
  return {
    title: "리밸런싱 작업을 완료하지 못했습니다.",
    description: messages[status] ?? "엔진과 토스 사전조회 상태를 확인한 뒤 다시 시도하세요.",
    tone: "blocked",
  };
}
