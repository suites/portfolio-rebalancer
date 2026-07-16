import Link from "next/link";
import type { ReactNode } from "react";

import type {
  DashboardSnapshotContract,
  OperationalConfigSnapshotContract,
} from "@portfolio-rebalancer/contracts";
import { Badge } from "@portfolio-rebalancer/ui";

import { logoutOperatorAction } from "@/app/auth/actions";
import { formatObservedAt } from "@/features/console/format";
import type { OperatorPageContext } from "@/server/operator-auth";

import styles from "./app-shell.module.css";
import { SideNavigation } from "./side-navigation";

export function AppShell({
  snapshot,
  operational,
  operator,
  children,
}: {
  readonly snapshot: DashboardSnapshotContract;
  readonly operational: OperationalConfigSnapshotContract;
  readonly operator: OperatorPageContext;
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
            <strong>{operator.operatorId}</strong>
            <span>{snapshot.accountLabel ?? "계좌 확인 필요"}</span>
          </div>
          <form action={logoutOperatorAction}>
            <input type="hidden" name="_csrf" value={operator.csrfToken} />
            <button className={styles.logoutButton} type="submit">
              로그아웃
            </button>
          </form>
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
            <Badge tone={system.tone} showDot>
              {system.label}
            </Badge>
            <Badge tone={operational.liveOrdersEnabled ? "attention" : "blocked"} showDot>
              {operational.liveOrdersEnabled ? "실주문 조건 충족" : "실주문 차단"}
            </Badge>
            <Badge tone={operational.killSwitch === "ENGAGED" ? "blocked" : "info"}>
              {operational.killSwitch === "ENGAGED"
                ? "킬 스위치 작동"
                : operational.killSwitch === "DISENGAGED"
                  ? "킬 스위치 해제"
                  : "킬 스위치 확인 불가"}
            </Badge>
            <Link
              className={styles.reauthLink}
              href="/auth/reauth?returnTo=%2F"
              aria-label={`운영자 ${operator.operatorId} 재인증`}
            >
              {operator.recentlyReauthenticated ? "재인증 유효" : "재인증 필요"}
            </Link>
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
