import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Button, Surface } from "@portfolio-rebalancer/ui";

import { refreshPortfolioAction } from "@/app/(console)/actions";
import { formatObservedAt } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function TroubleshootingScreen({
  snapshot,
}: {
  readonly snapshot: DashboardSnapshotContract;
}) {
  return (
    <>
      <ConsolePageHeader
        eyebrow="문제 해결"
        title="현재 차단 원인과 안전한 다음 행동"
        description="저장된 증거를 먼저 보여주며, 사용자가 재점검을 요청할 때만 기존 read-only 토스 수집을 실행합니다. 주문 복구나 lease 강제 삭제 기능은 제공하지 않습니다."
      >
        <form action={refreshPortfolioAction}>
          <Button type="submit" variant="secondary">
            토스 데이터 재점검
          </Button>
        </form>
      </ConsolePageHeader>
      {snapshot.blockReason ? (
        <Surface className={styles.surface} aria-labelledby="block-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="block-title">차단 원인</h2>
              <p>문제, 보호 조치와 다음 행동을 분리해 표시합니다.</p>
            </div>
            <Badge tone="blocked">{snapshot.blockReason.code}</Badge>
          </div>
          <dl className={styles.diagnosticList}>
            <div>
              <dt>문제</dt>
              <dd>{snapshot.blockReason.problem}</dd>
            </div>
            <div>
              <dt>보호 조치</dt>
              <dd>{snapshot.blockReason.protectiveAction}</dd>
            </div>
            <div>
              <dt>다음 행동</dt>
              <dd>{snapshot.blockReason.nextAction}</dd>
            </div>
          </dl>
        </Surface>
      ) : (
        <div className={styles.callout}>
          <strong>대시보드 차단 사유가 없습니다.</strong>
          <p>실주문은 별도 안전 장치가 완성될 때까지 계속 비활성입니다.</p>
        </div>
      )}

      <section className={styles.grid2} aria-label="시스템 진단">
        <Surface className={styles.surface}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>엔진과 데이터</h2>
              <p>대시보드 계약으로 확인된 범위만 표시합니다.</p>
            </div>
            <Badge tone={snapshot.brokerConnection === "CONNECTED" ? "normal" : "blocked"}>
              {snapshot.brokerConnection}
            </Badge>
          </div>
          <dl className={styles.diagnosticList}>
            <div>
              <dt>엔진 응답</dt>
              <dd>
                {snapshot.blockReason?.code === "ENGINE_UNAVAILABLE" ? "연결 실패" : "응답 확인"}
              </dd>
            </div>
            <div>
              <dt>브로커 연결</dt>
              <dd>{snapshot.brokerConnection}</dd>
            </div>
            <div>
              <dt>마지막 스냅샷</dt>
              <dd>{formatObservedAt(snapshot.observedAt)}</dd>
            </div>
            <div>
              <dt>계좌</dt>
              <dd>{snapshot.accountLabel ?? "확인 필요"}</dd>
            </div>
          </dl>
        </Surface>
        <Surface className={styles.surface}>
          <div className={styles.sectionHeader}>
            <div>
              <h2>금융 안전 경계</h2>
              <p>확인되지 않은 항목은 정상으로 표시하지 않습니다.</p>
            </div>
            <Badge tone="blocked">fail closed</Badge>
          </div>
          <dl className={styles.diagnosticList}>
            <div>
              <dt>실주문 API</dt>
              <dd>하드 차단</dd>
            </div>
            <div>
              <dt>주문 원장</dt>
              <dd>미구현</dd>
            </div>
            <div>
              <dt>관리 현금</dt>
              <dd>{snapshot.verifiedCashMinor === null ? "미검증" : "검증됨"}</dd>
            </div>
            <div>
              <dt>복구 동작</dt>
              <dd>제공 안 함</dd>
            </div>
          </dl>
        </Surface>
      </section>
    </>
  );
}
