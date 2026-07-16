import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import { refreshPortfolioAction } from "@/app/(console)/actions";
import { formatObservedAt } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function TroubleshootingScreen({
  snapshot,
  csrfToken,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly csrfToken: string;
}) {
  return (
    <>
      <ConsolePageHeader
        eyebrow="문제 해결"
        title="현재 상태와 해결 방법"
        description="연결 상태를 확인하고 필요한 경우 최신 정보로 다시 점검하세요."
      >
        <form action={refreshPortfolioAction}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <Button type="submit" variant="secondary">
            토스 데이터 재점검
          </Button>
        </form>
      </ConsolePageHeader>
      <div className={styles.pageStack}>
        {snapshot.blockReason ? (
          <Surface className={styles.surface} aria-labelledby="block-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="block-title">확인이 필요한 항목</h2>
              </div>
            </div>
            <dl className={styles.diagnosticList}>
              <div>
                <dt>현재 상태</dt>
                <dd>{snapshot.blockReason.problem}</dd>
              </div>
              <div>
                <dt>처리 상태</dt>
                <dd>{snapshot.blockReason.protectiveAction}</dd>
              </div>
              <div>
                <dt>해결 방법</dt>
                <dd>{snapshot.blockReason.nextAction}</dd>
              </div>
            </dl>
          </Surface>
        ) : (
          <div className={styles.callout}>
            <strong>현재 확인된 문제가 없습니다.</strong>
          </div>
        )}

        <Surface className={styles.surface}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>연결 상태</h2>
              <p>계좌 정보와 마지막 업데이트 시각을 확인하세요.</p>
            </div>
            <Badge tone={snapshot.brokerConnection === "CONNECTED" ? "normal" : "blocked"}>
              {snapshot.brokerConnection === "CONNECTED" ? "연결됨" : "확인 필요"}
            </Badge>
          </div>
          <dl className={styles.diagnosticList}>
            <div>
              <dt>서비스</dt>
              <dd>{snapshot.blockReason?.code === "ENGINE_UNAVAILABLE" ? "연결 실패" : "정상"}</dd>
            </div>
            <div>
              <dt>토스증권</dt>
              <dd>{snapshot.brokerConnection === "CONNECTED" ? "연결됨" : "확인 필요"}</dd>
            </div>
            <div>
              <dt>마지막 업데이트</dt>
              <dd>{formatObservedAt(snapshot.observedAt)}</dd>
            </div>
            <div>
              <dt>계좌</dt>
              <dd>{snapshot.accountLabel ?? "확인 필요"}</dd>
            </div>
          </dl>
        </Surface>
      </div>
    </>
  );
}
