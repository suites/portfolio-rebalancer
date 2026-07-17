import type {
  ConsoleRecordsSnapshotContract,
  OrdersSnapshotContract,
  StoredOrderReceiptContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import {
  cancelOrderAction,
  reconcileOrderAction,
  recoverUnknownOrderAction,
} from "@/app/(console)/actions";
import { formatObservedAt, formatWon } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function OrdersScreen({
  records,
  orders,
  actionStatus,
}: {
  readonly records: ConsoleRecordsSnapshotContract;
  readonly orders: OrdersSnapshotContract;
  readonly actionStatus: string | undefined;
}) {
  const feedback = orderFeedback(actionStatus);
  return (
    <>
      <ConsolePageHeader
        eyebrow="주문·기록"
        title="주문 원장과 복구"
        description="Paper와 Live 주문의 불변 상태 이력, 브로커 조정과 안전한 취소·복구를 확인하세요."
      />
      <div className={styles.pageStack}>
        {feedback ? (
          <div className={styles.callout} data-tone={feedback.tone} role="status">
            <strong>{feedback.title}</strong>
            <p>{feedback.description}</p>
          </div>
        ) : null}

        <Surface className={styles.surface} aria-labelledby="ledger-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="ledger-title">주문 원장</h2>
              <p>상태 변경은 덮어쓰지 않고 시간순으로 추가됩니다.</p>
            </div>
            <div className={styles.inlineBadges}>
              <Badge tone={orders.state === "UNAVAILABLE" ? "blocked" : "info"}>
                {orders.state === "UNAVAILABLE" ? "조회 불가" : `${orders.orders.length}건`}
              </Badge>
              <Badge tone={orders.liveOrdersEnabled ? "attention" : "blocked"}>
                {orders.liveOrdersEnabled ? "Live 조건 충족" : "Live 차단"}
              </Badge>
              <Badge tone={orders.killSwitch === "ENGAGED" ? "blocked" : "info"}>
                {killSwitchLabel(orders.killSwitch)}
              </Badge>
            </div>
          </div>

          {orders.state === "UNAVAILABLE" ? (
            <div className={styles.blockedState}>
              <strong>주문 원장을 안전하게 확인하지 못했습니다.</strong>
              <p>원장 상태를 추정하지 않았으며 새 주문과 복구 동작을 모두 차단합니다.</p>
            </div>
          ) : orders.orders.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>아직 저장된 주문이 없습니다.</strong>
              <p>리밸런싱에서 Paper 또는 안전 조건을 충족한 Live 계획을 별도로 실행하세요.</p>
            </div>
          ) : (
            <div className={styles.orderList}>
              {orders.orders.map((order) => (
                <OrderCard key={order.orderId} order={order} />
              ))}
            </div>
          )}
        </Surface>

        <Surface className={styles.surface} aria-labelledby="timeline-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="timeline-title">최근 계좌 점검</h2>
              <p>주문 판단에 사용한 계좌 정보가 언제 업데이트됐는지 확인하세요.</p>
            </div>
            <Badge tone={records.state === "READY" ? "info" : "blocked"}>
              {records.state === "READY" ? `${records.records.length}건` : "조회 불가"}
            </Badge>
          </div>
          {records.records.length > 0 ? (
            <ol className={styles.timeline}>
              {records.records.map((record) => (
                <li key={record.id}>
                  <time dateTime={record.startedAt}>{formatObservedAt(record.startedAt)}</time>
                  <div className={styles.timelineContent}>
                    <strong>
                      계좌 정보 업데이트 ·{" "}
                      {record.status === "SUCCEEDED"
                        ? "완료"
                        : record.status === "RUNNING"
                          ? "진행 중"
                          : "실패"}
                    </strong>
                    <div className={styles.inlineBadges}>
                      <Badge
                        tone={
                          record.status === "SUCCEEDED"
                            ? "normal"
                            : record.status === "FAILED"
                              ? "blocked"
                              : "attention"
                        }
                      >
                        {record.status === "SUCCEEDED"
                          ? "완료"
                          : record.status === "RUNNING"
                            ? "진행 중"
                            : "실패"}
                      </Badge>
                      {record.validationStatus ? (
                        <Badge tone={record.validationStatus === "VERIFIED" ? "normal" : "blocked"}>
                          {record.validationStatus === "VERIFIED" ? "확인 완료" : "확인 필요"}
                        </Badge>
                      ) : null}
                    </div>
                    <p>
                      {record.observedAt
                        ? `기준 시각 ${formatObservedAt(record.observedAt)}`
                        : record.errorCode
                          ? "업데이트하지 못했습니다."
                          : "정보 확인 중"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.emptyState}>
              <strong>
                {records.state === "READY"
                  ? "최근 계좌 점검 기록이 없습니다."
                  : "계좌 점검 기록을 불러올 수 없습니다."}
              </strong>
              <p>문제 해결에서 연결 상태를 확인하세요.</p>
            </div>
          )}
        </Surface>
      </div>
    </>
  );
}

function OrderCard({ order }: { readonly order: StoredOrderReceiptContract }) {
  const current = order.timeline.at(-1);
  const canCancel =
    order.mode === "LIVE" &&
    (order.currentState === "PENDING" || order.currentState === "PARTIAL_FILLED");
  const canReconcile =
    order.mode === "LIVE" && !["FILLED", "CANCELED", "REJECTED"].includes(order.currentState);
  return (
    <article className={styles.orderCard}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>
            {order.symbol} · {order.side === "BUY" ? "매수" : "매도"}
          </h3>
          <p>
            {order.mode} · {formatObservedAt(order.createdAt)}
          </p>
        </div>
        <Badge tone={orderStateTone(order.currentState)}>
          {orderStateLabel(order.currentState)}
        </Badge>
      </div>

      <dl className={styles.orderSummary}>
        <div>
          <dt>수량</dt>
          <dd>{BigInt(order.quantity).toLocaleString("ko-KR")}주</dd>
        </div>
        <div>
          <dt>지정가</dt>
          <dd>{formatWon(order.limitPriceMinor)}</dd>
        </div>
        <div>
          <dt>계획 금액</dt>
          <dd>{formatWon(order.plannedGrossMinor)}</dd>
        </div>
        <div>
          <dt>예약 금액</dt>
          <dd>{formatWon(order.reservedGrossMinor)}</dd>
        </div>
      </dl>

      <details className={styles.orderDetails}>
        <summary>상태 이력 {order.timeline.length}건 보기</summary>
        <ol className={styles.timeline}>
          {order.timeline.map((entry) => (
            <li key={`${order.orderId}-${entry.sequence}`}>
              <time dateTime={entry.occurredAt}>{formatObservedAt(entry.occurredAt)}</time>
              <div className={styles.timelineContent}>
                <strong>
                  #{entry.sequence} {orderStateLabel(entry.state)}
                </strong>
                <p>{entry.message}</p>
                <span>
                  누적 체결 {BigInt(entry.filledQuantity).toLocaleString("ko-KR")}주 ·{" "}
                  {formatWon(entry.filledGrossMinor)} · 수수료 {formatWon(entry.feeMinor)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </details>

      {order.mode === "LIVE" ? (
        <div className={styles.orderActions}>
          {canReconcile ? (
            <form action={reconcileOrderAction}>
              <input type="hidden" name="orderId" value={order.orderId} />
              <Button type="submit" variant="secondary">
                브로커 상태 다시 확인
              </Button>
            </form>
          ) : null}
          {canCancel ? (
            <form className={styles.inlineSafetyForm} action={cancelOrderAction}>
              <input type="hidden" name="orderId" value={order.orderId} />
              <label>
                취소 사유
                <input
                  name="reason"
                  minLength={8}
                  maxLength={500}
                  placeholder="예: 현재 미체결 주문을 중단합니다."
                  required
                />
              </label>
              <label className={styles.checkboxField}>
                <input
                  name="confirmation"
                  type="checkbox"
                  value="미체결 주문 취소를 요청합니다"
                  required
                />
                미체결 주문 취소를 요청합니다
              </label>
              <p className={styles.fieldDescription}>
                Tailscale 내부 콘솔과 취소 안전 조건이 필요합니다.
              </p>
              <Button type="submit">취소 요청 1회 전송</Button>
            </form>
          ) : null}
          {order.currentState === "UNKNOWN_BLOCKED" ? <UnknownRecoveryForm order={order} /> : null}
        </div>
      ) : (
        <p className={styles.fieldDescription}>
          Paper 주문은 브로커로 전송되지 않았습니다. 현재 상태:{" "}
          {current ? current.message : "이력 확인 불가"}
        </p>
      )}
    </article>
  );
}

function UnknownRecoveryForm({ order }: { readonly order: StoredOrderReceiptContract }) {
  const latest = order.timeline.at(-1);
  return (
    <details className={styles.recoveryPanel}>
      <summary>UNKNOWN_BLOCKED 수동 복구</summary>
      <form className={styles.settingsForm} action={recoverUnknownOrderAction}>
        <input type="hidden" name="orderId" value={order.orderId} />
        <p className={styles.fieldDescription}>
          토스 주문 조회 결과와 아래 값이 정확히 일치할 때만 상태를 추가합니다. 일치하지 않으면
          복구하지 않으며 주문을 재제출하지 않습니다.
        </p>
        <p className={styles.fieldDescription}>
          Tailscale 내부 콘솔과 복구 안전 조건이 필요합니다.
        </p>
        <div className={styles.fieldGrid}>
          <label>
            확인된 상태
            <select name="resolvedState" required>
              <option value="PENDING">PENDING</option>
              <option value="PARTIAL_FILLED">PARTIAL_FILLED</option>
              <option value="FILLED">FILLED</option>
              <option value="CANCELED">CANCELED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </label>
          <label>
            브로커 주문 ID
            <input name="brokerOrderId" maxLength={500} required />
          </label>
          <label>
            증거 참조
            <input
              name="brokerEvidenceReference"
              maxLength={500}
              placeholder="예: 토스 주문내역 확인 시각과 메모"
              required
            />
          </label>
          <label>
            원 주문 지정가 (원)
            <input
              name="limitPriceWon"
              type="number"
              min="1"
              step="1"
              defaultValue={order.limitPriceMinor}
              required
            />
          </label>
          <label>
            체결 수량
            <input
              name="filledQuantity"
              type="number"
              min="0"
              step="1"
              defaultValue={latest?.filledQuantity ?? "0"}
              required
            />
          </label>
          <label>
            체결 금액 (원)
            <input
              name="filledGrossWon"
              type="number"
              min="0"
              step="1"
              defaultValue={latest?.filledGrossMinor ?? "0"}
              required
            />
          </label>
          <label>
            수수료 (원)
            <input
              name="feeWon"
              type="number"
              min="0"
              step="1"
              defaultValue={latest?.feeMinor ?? "0"}
              required
            />
          </label>
        </div>
        <Button type="submit">최신 브로커 조회와 대조해 복구</Button>
      </form>
    </details>
  );
}

function orderStateLabel(state: StoredOrderReceiptContract["currentState"]): string {
  const labels: Record<StoredOrderReceiptContract["currentState"], string> = {
    PLANNED: "계획됨",
    SUBMITTING: "전송 준비",
    PENDING: "미체결",
    PARTIAL_FILLED: "부분 체결",
    FILLED: "체결 완료",
    CANCELED: "취소 완료",
    REJECTED: "거부·미전송",
    UNKNOWN: "결과 불명",
    UNKNOWN_BLOCKED: "수동 확인 필요",
  };
  return labels[state];
}

function orderStateTone(
  state: StoredOrderReceiptContract["currentState"],
): "normal" | "attention" | "blocked" | "info" {
  if (state === "FILLED" || state === "CANCELED") return "normal";
  if (state === "REJECTED" || state === "UNKNOWN_BLOCKED") return "blocked";
  if (state === "PENDING" || state === "PARTIAL_FILLED" || state === "UNKNOWN") return "attention";
  return "info";
}

function killSwitchLabel(state: OrdersSnapshotContract["killSwitch"]): string {
  if (state === "ENGAGED") return "킬 스위치 작동";
  if (state === "DISENGAGED") return "킬 스위치 해제";
  return "킬 스위치 확인 불가";
}

function orderFeedback(status: string | undefined): {
  readonly title: string;
  readonly description: string;
  readonly tone?: "attention" | "blocked";
} | null {
  const feedback: Record<
    string,
    {
      readonly title: string;
      readonly description: string;
      readonly tone?: "attention" | "blocked";
    }
  > = {
    "cancel-requested": {
      title: "취소 요청을 1회 전송했습니다.",
      description: "최종 CANCELED 여부는 원 주문의 최신 브로커 조회로만 확정합니다.",
      tone: "attention",
    },
    "order-reconciled": {
      title: "브로커 상태를 다시 확인했습니다.",
      description: "확인된 상태가 바뀐 경우 주문 원장에 새 이력으로 추가했습니다.",
    },
    "order-recovered": {
      title: "UNKNOWN_BLOCKED 주문을 복구했습니다.",
      description: "사용자 입력과 최신 토스 조회 결과가 정확히 일치한 상태만 기록했습니다.",
    },
    "order-input-invalid": {
      title: "주문 작업 입력을 확인하지 못했습니다.",
      description: "주문 ID, 취소 확인, 사유와 복구 값을 다시 확인하세요.",
      tone: "blocked",
    },
    "cancel-blocked": {
      title: "취소 요청을 전송하지 않았습니다.",
      description:
        "현재 상태, 브로커 주문 ID 또는 일회성 취소 권한을 안전하게 확인하지 못했습니다.",
      tone: "blocked",
    },
    "cancel-rejected": {
      title: "브로커가 취소 요청을 거부했습니다.",
      description: "취소 성공으로 표시하지 않습니다. 원 주문 상태를 다시 대사하세요.",
      tone: "blocked",
    },
    "cancel-unknown": {
      title: "취소 요청 결과를 확정하지 못했습니다.",
      description:
        "취소 성공으로 표시하거나 재전송하지 않습니다. 토스 주문 내역을 확인하고 원 주문을 대사하세요.",
      tone: "attention",
    },
    "recovery-blocked": {
      title: "주문을 복구하지 않았습니다.",
      description: "최신 브로커 조회와 입력값이 정확히 일치하지 않거나 복구 대상 상태가 아닙니다.",
      tone: "blocked",
    },
    "order-not-found": {
      title: "주문 원장에서 대상을 찾지 못했습니다.",
      description: "화면을 새로고침한 뒤 현재 주문 ID를 다시 확인하세요.",
      tone: "blocked",
    },
    "cancel-unavailable": {
      title: "취소 결과를 안전하게 기록하지 못했습니다.",
      description: "자동 재전송하지 않습니다. 브로커 주문 내역을 확인한 뒤 상태 조정을 실행하세요.",
      tone: "blocked",
    },
    "reconcile-unavailable": {
      title: "브로커 상태를 확인하지 못했습니다.",
      description: "현재 원장 상태를 유지했으며 주문을 재제출하지 않았습니다.",
      tone: "blocked",
    },
    "recover-unavailable": {
      title: "복구 검증을 완료하지 못했습니다.",
      description: "원장 상태는 변경하지 않았습니다.",
      tone: "blocked",
    },
  };
  return status ? (feedback[status] ?? null) : null;
}
