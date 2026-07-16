import Link from "next/link";
import type { ReactNode } from "react";

import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge } from "@portfolio-rebalancer/ui";

import { formatObservedAt } from "@/features/console/format";

import styles from "./app-shell.module.css";
import { SideNavigation } from "./side-navigation";

export function AppShell({
  snapshot,
  children,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly children: ReactNode;
}) {
  const observedAt = formatObservedAt(snapshot.observedAt);
  const system = getSystemStatus(snapshot.conclusion);
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
            <strong>내 포트폴리오</strong>
            <span>{snapshot.accountLabel ?? "계좌 확인 필요"}</span>
          </div>
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.safetyBar} aria-label="실행 안전 상태">
          <div>
            <Badge tone="info" showDot>
              {snapshot.mode}
            </Badge>
            <Badge tone="info">토스증권 실제 데이터</Badge>
            <span className={styles.accountMeta}>
              {snapshot.accountLabel ? `계좌 ${snapshot.accountLabel}` : "계좌 확인 필요"}
            </span>
            <span className={styles.observedMeta}>데이터 {observedAt}</span>
          </div>
          <div>
            <Badge tone={system.tone} showDot>
              {system.label}
            </Badge>
            <Badge tone="blocked" showDot>
              실주문 차단
            </Badge>
          </div>
        </header>
        <main id="main-content" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

function getSystemStatus(conclusion: DashboardSnapshotContract["conclusion"]): {
  tone: "normal" | "attention" | "blocked";
  label: string;
} {
  if (conclusion === "NO_ACTION") return { tone: "normal", label: "시스템 정상" };
  if (conclusion === "REBALANCE_REQUIRED") return { tone: "attention", label: "검토 필요" };
  return { tone: "blocked", label: "거래 차단" };
}
