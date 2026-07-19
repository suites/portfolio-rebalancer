import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import {
  AllocationBand,
  Badge,
  StatusBanner,
  SummaryCard,
  Surface,
} from "@portfolio-rebalancer/ui";

import {
  formatBasisPoints,
  formatCurrentWeight,
  formatObservedAt,
  formatWon,
} from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function PortfolioScreen({ snapshot }: { readonly snapshot: DashboardSnapshotContract }) {
  const observedAt = formatObservedAt(snapshot.observedAt);
  const holdingCount =
    snapshot.allocations.reduce((sum, allocation) => sum + allocation.instruments.length, 0) +
    snapshot.unmanagedHoldings.length;
  return (
    <>
      <ConsolePageHeader
        eyebrow="포트폴리오"
        title="실제 보유자산과 목표 비중"
        description="최근 계좌 정보를 기준으로 현재 보유자산과 목표 비중을 보여드립니다."
      />
      <div className={styles.pageStack}>
        {snapshot.blockReason ? (
          <StatusBanner
            tone="blocked"
            icon="!"
            eyebrow="확인이 필요해요"
            title={snapshot.blockReason.problem}
            description={`${snapshot.blockReason.protectiveAction} ${snapshot.blockReason.nextAction}`}
          />
        ) : null}

        <section className={styles.grid3} aria-label="포트폴리오 요약">
          <SummaryCard
            label="총 평가액"
            value={snapshot.totalValueMinor ? formatWon(snapshot.totalValueMinor) : "확인 불가"}
            description={observedAt}
            emphasis="strong"
          />
          <SummaryCard
            label="보유자산"
            value={`${holdingCount}개`}
            description="최근 계좌의 보유 종목"
          />
          <SummaryCard
            label="관리 현금"
            value={
              snapshot.managedCashMinor === null ? "미확인" : formatWon(snapshot.managedCashMinor)
            }
            description={
              snapshot.managedCashSource === "UNSET"
                ? "관리 현금 기준을 선택해 주세요"
                : snapshot.managedCashSource === "EXCLUDED"
                  ? "포트폴리오 평가에서 제외"
                  : "사용자 고정 금액 반영"
            }
          />
        </section>

        <div className={styles.stack}>
          <Surface className={styles.surface} aria-labelledby="portfolio-band-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="portfolio-band-title">비중 밴드</h2>
                <p>현재 비중, 목표와 허용 범위를 함께 확인합니다.</p>
              </div>
              <Badge
                tone={
                  snapshot.conclusion === "BLOCKED"
                    ? "blocked"
                    : snapshot.conclusion === "REBALANCE_REQUIRED"
                      ? "attention"
                      : "normal"
                }
              >
                {snapshot.conclusion === "BLOCKED"
                  ? "거래 차단"
                  : snapshot.conclusion === "REBALANCE_REQUIRED"
                    ? "범위 이탈"
                    : "범위 안"}
              </Badge>
            </div>
            <div className={styles.allocationList}>
              {snapshot.allocations.length > 0 ? (
                snapshot.allocations.map((allocation) => (
                  <AllocationBand key={allocation.id} {...allocation} />
                ))
              ) : (
                <div className={styles.emptyState}>
                  <strong>표시할 보유자산이 없습니다.</strong>
                  <p>상단의 정보 새로고침으로 계좌와 최신 정보 상태를 확인하세요.</p>
                </div>
              )}
            </div>
          </Surface>

          <Surface className={styles.surface} aria-labelledby="portfolio-table-title">
            <h2 id="portfolio-table-title">보유자산 표</h2>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption>최근 계좌의 평가액, 현재 비중, 목표와 상태</caption>
                <thead>
                  <tr>
                    <th scope="col">자산</th>
                    <th scope="col">평가액</th>
                    <th scope="col">현재</th>
                    <th scope="col">목표 / 허용 범위</th>
                    <th scope="col">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.allocations.map((allocation) => (
                    <tr key={allocation.id}>
                      <td>
                        <span className={styles.assetName}>
                          <strong>{allocation.label}</strong>
                          <span>{allocation.description}</span>
                          {allocation.instruments.length > 0 ? (
                            <span>
                              {allocation.instruments
                                .map(
                                  (instrument) =>
                                    `${instrument.label} ${formatBasisPoints(
                                      instrument.targetWithinAssetPoints,
                                    )}`,
                                )
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td data-numeric="true">{formatWon(allocation.valueMinor)}</td>
                      <td data-numeric="true">
                        {formatCurrentWeight(allocation.currentBasisPointHundredths)}
                      </td>
                      <td data-numeric="true">
                        {allocation.targetBasisPoints === null ||
                        allocation.lowerBasisPoints === null ||
                        allocation.upperBasisPoints === null
                          ? "미설정"
                          : `${formatBasisPoints(allocation.targetBasisPoints)} / ${formatBasisPoints(allocation.lowerBasisPoints)}–${formatBasisPoints(allocation.upperBasisPoints)}`}
                      </td>
                      <td>
                        <Badge tone={allocation.bandStatus === "IN_RANGE" ? "normal" : "attention"}>
                          {allocation.bandStatus === "IN_RANGE"
                            ? "범위 안"
                            : allocation.bandStatus === "OUTSIDE_BAND"
                              ? "검토 필요"
                              : "목표 미설정"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          {snapshot.unmanagedHoldings.length > 0 ? (
            <Surface className={styles.surface} aria-labelledby="unmanaged-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="unmanaged-title">관리되지 않는 보유종목</h2>
                  <p>자동 매도하지 않으며 새 목표 설정 전까지 거래를 차단합니다.</p>
                </div>
                <Badge tone="blocked">{snapshot.unmanagedHoldings.length}개</Badge>
              </div>
              <ul className={styles.statusList}>
                {snapshot.unmanagedHoldings.map((holding) => (
                  <li key={holding.id}>
                    <div>
                      <strong>{holding.label}</strong>
                      <span>{holding.description}</span>
                    </div>
                    <span>{formatWon(holding.valueMinor)}</span>
                  </li>
                ))}
              </ul>
            </Surface>
          ) : null}
        </div>
      </div>
    </>
  );
}
