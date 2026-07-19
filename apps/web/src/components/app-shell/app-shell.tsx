import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DashboardSnapshotContract,
  OperationalConfigSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Badge, Button } from "@portfolio-rebalancer/ui";

import { refreshPortfolioFromShellAction } from "@/app/(console)/actions";
import { formatObservedAt } from "@/features/console/format";

import styles from "./app-shell.module.css";
import { LiveTradingToggle } from "./live-trading-toggle";
import { SideNavigation } from "./side-navigation";

export function AppShell({
  snapshot,
  operational,
  children,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly operational: OperationalConfigSnapshotContract;
  readonly children: ReactNode;
}) {
  const observedAt = formatObservedAt(snapshot.observedAt);
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar}>
        <Link className={styles.brand} href="/" aria-label="Portfolio Rebalancer 홈">
          <span className={styles.brandMark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            Portfolio
            <br />
            Rebalancer
          </span>
        </Link>
        <SideNavigation />
        <div className={styles.accountCard}>
          <span className={styles.avatar} aria-hidden="true">
            나
          </span>
          <div>
            <strong>개인 운영 콘솔</strong>
            <span>{snapshot.accountLabel ?? "계좌 확인 필요"}</span>
          </div>
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.safetyBar} aria-label="실행 안전 상태">
          <div>
            <Badge
              tone={operational.activeVersion?.config.mode === "LIVE" ? "attention" : "info"}
              showDot
            >
              {operational.activeVersion?.config.mode ?? snapshot.mode}
            </Badge>
            <Badge tone="info">토스증권 실제 데이터</Badge>
            <span className={styles.accountMeta}>
              {snapshot.accountLabel ? `계좌 ${snapshot.accountLabel}` : "계좌 확인 필요"}
            </span>
            <span className={styles.observedMeta}>데이터 {observedAt}</span>
          </div>
          <div>
            <LiveTradingToggle enabled={operational.liveOrdersEnabled} />
            <form action={refreshPortfolioFromShellAction} className={styles.refreshForm}>
              <Button type="submit" variant="secondary" className={styles.refreshButton}>
                정보 새로고침
              </Button>
            </form>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
