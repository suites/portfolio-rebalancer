import type { ConsoleRecordsSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Surface } from "@portfolio-rebalancer/ui";

import { formatObservedAt } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function OrdersScreen({ records }: { readonly records: ConsoleRecordsSnapshotContract }) {
  return (
    <>
      <ConsolePageHeader
        eyebrow="주문·기록"
        title="실행 기록과 주문 안전 상태"
        description="실제로 저장된 계좌 수집과 검증 기록만 표시합니다. 주문 원장이 아직 없으므로 주문이 없었다고 단정하거나 가짜 체결 내역을 만들지 않습니다."
      />
      <div className={styles.grid2}>
        <Surface className={styles.surface} aria-labelledby="ledger-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="ledger-title">주문 원장</h2>
              <p>계획·논리 주문·체결 상태 모델이 구현되기 전까지 실행 기능을 제공하지 않습니다.</p>
            </div>
            <Badge tone="blocked">미구현</Badge>
          </div>
          <div className={styles.blockedState}>
            <strong>주문 기록 여부를 아직 판단할 수 없습니다.</strong>
            <p>
              원장이 없는 상태를 “주문 없음”으로 표시하지 않습니다. 실주문은 계속 하드 차단됩니다.
            </p>
          </div>
        </Surface>
        <Surface className={styles.surface} aria-labelledby="record-summary-title">
          <h2 id="record-summary-title">기록 상태</h2>
          <dl className={styles.diagnosticList}>
            <div>
              <dt>수집 기록</dt>
              <dd>{records.state === "READY" ? `${records.records.length}건` : "조회 불가"}</dd>
            </div>
            <div>
              <dt>주문 원장</dt>
              <dd>미구현</dd>
            </div>
            <div>
              <dt>실주문</dt>
              <dd>차단</dd>
            </div>
          </dl>
        </Surface>
      </div>

      <Surface className={styles.surface} aria-labelledby="timeline-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="timeline-title">최근 계좌 수집 기록</h2>
            <p>원본 API payload와 전체 계좌번호는 브라우저에 노출하지 않습니다.</p>
          </div>
          <Badge tone={records.state === "READY" ? "info" : "blocked"}>
            {records.state === "READY" ? "실제 DB 기록" : "조회 차단"}
          </Badge>
        </div>
        {records.records.length > 0 ? (
          <ol className={styles.timeline}>
            {records.records.map((record) => (
              <li key={record.id}>
                <time dateTime={record.startedAt}>{formatObservedAt(record.startedAt)}</time>
                <div className={styles.timelineContent}>
                  <strong>
                    토스증권 계좌 수집 ·{" "}
                    {record.status === "SUCCEEDED"
                      ? "성공"
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
                      {record.status}
                    </Badge>
                    {record.validationStatus ? (
                      <Badge tone={record.validationStatus === "VERIFIED" ? "normal" : "blocked"}>
                        {record.validationStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <p>
                    {record.observedAt
                      ? `스냅샷 ${formatObservedAt(record.observedAt)}`
                      : record.errorCode
                        ? `안전 오류 코드 ${record.errorCode}`
                        : "스냅샷 저장 전"}
                  </p>
                  {record.checks.length > 0 ? (
                    <p>
                      검사:{" "}
                      {record.checks
                        .map(({ ruleCode, outcome }) => `${ruleCode} ${outcome}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.emptyState}>
            <strong>
              {records.state === "READY"
                ? "저장된 수집 기록이 없습니다."
                : "수집 기록 저장소를 확인할 수 없습니다."}
            </strong>
            <p>문제 해결 화면에서 엔진과 데이터베이스 상태를 확인하세요.</p>
          </div>
        )}
      </Surface>
    </>
  );
}
