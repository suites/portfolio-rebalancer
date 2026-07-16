import Link from "next/link";

import type {
  DashboardSnapshotContract,
  RebalancePlanSnapshotContract,
  StoredRebalancePlanContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button, StatusBanner, Surface } from "@portfolio-rebalancer/ui";

import { createShadowPlanAction } from "@/app/(console)/actions";
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
  actionStatus,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly plan: RebalancePlanSnapshotContract;
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
          <div className={styles.callout} data-tone="blocked" role="status">
            <strong>Shadow 계획을 만들지 못했습니다.</strong>
            <p>{actionStatusMessage(actionStatus)}</p>
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

        <PlanSurface snapshot={snapshot} plan={plan} />
      </div>
    </>
  );
}

function PlanSurface({
  snapshot,
  plan,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly plan: RebalancePlanSnapshotContract;
}) {
  const latest = plan.latest;
  const canCreate =
    snapshot.state === "READY" && snapshot.blockReason === null && plan.state !== "UNAVAILABLE";
  return (
    <Surface className={styles.surface} aria-labelledby="plan-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="plan-title">Shadow 주문 제안</h2>
          <p>
            {latest
              ? `저장된 계획 · ${formatObservedAt(latest.completedAt)}`
              : plan.state === "UNAVAILABLE"
                ? "계획 저장소에 연결할 수 없습니다."
                : "아직 저장된 Shadow 계획이 없습니다."}
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

      {latest ? <StoredPlanDetails plan={latest} /> : null}

      <div className={styles.buttonRow}>
        <form action={createShadowPlanAction}>
          <Button type="submit" disabled={!canCreate}>
            Shadow 계획 만들기
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
        Shadow 계획은 실제 주문을 제출하지 않습니다. 같은 snapshot과 설정의 중복 클릭은 기존 계획을
        반환하며, 새 데이터나 목표 설정이 생기면 이전 계획을 실행 입력으로 사용할 수 없습니다.
      </p>
    </Surface>
  );
}

function StoredPlanDetails({ plan }: { readonly plan: StoredRebalancePlanContract }) {
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

      {plan.executableOrders.length > 0 ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption>저장된 Shadow 주문 후보</caption>
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

function actionStatusMessage(status: string): string {
  switch (status) {
    case "plan-no-snapshot":
      return "먼저 토스 계좌 snapshot을 수집하세요.";
    case "plan-target-required":
      return "목표 비중을 적용하고 새 snapshot에 고정하세요.";
    case "plan-cash-required":
      return "설정에서 관리 현금을 고정 금액으로 포함하거나 평가에서 제외하세요.";
    case "plan-in-progress":
      return "같은 snapshot의 계획 생성이 진행 중입니다. 잠시 뒤 다시 확인하세요.";
    default:
      return "엔진과 토스 사전조회 상태를 확인한 뒤 다시 시도하세요.";
  }
}
