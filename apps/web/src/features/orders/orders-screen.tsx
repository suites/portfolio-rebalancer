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
        title="주문 내역과 계좌 기록"
        description="주문 상태와 최근 계좌 점검 기록을 확인하세요."
      />
      <div className={styles.pageStack}>
        <Surface className={styles.surface} aria-labelledby="ledger-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="ledger-title">주문 내역</h2>
              <p>현재 주문 내역을 확인할 수 없습니다.</p>
            </div>
            <Badge tone="blocked">확인 불가</Badge>
          </div>
          <div className={styles.blockedState}>
            <strong>주문 기능을 사용할 수 없습니다.</strong>
            <p>사용 가능 상태가 되면 주문과 체결 내역이 이곳에 표시됩니다.</p>
          </div>
        </Surface>

        <Surface className={styles.surface} aria-labelledby="timeline-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="timeline-title">최근 계좌 점검</h2>
              <p>계좌 정보가 언제 업데이트됐는지 확인하세요.</p>
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
