"use client";

import Link from "next/link";
import { useState } from "react";

import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import {
  AllocationBand,
  Badge,
  Button,
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

import styles from "./overview.module.css";

export interface OverviewScreenProps {
  readonly snapshot: DashboardSnapshotContract;
}

export function OverviewScreen({ snapshot }: OverviewScreenProps) {
  const [amountsHidden, setAmountsHidden] = useState(false);
  const conclusion = getConclusionCopy(snapshot.conclusion);
  const action = getActionCopy(snapshot);
  const outOfBandAllocations = snapshot.allocations.filter(
    ({ bandStatus }) => bandStatus === "OUTSIDE_BAND",
  );
  const observedAt = formatObservedAt(snapshot.observedAt);

  return (
    <>
      <div className={styles.pageHeader}>
        <div>
          <p>{observedAt}</p>
          <h1>
            안녕하세요.
            <br />
            오늘의 자산 상태예요.
          </h1>
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-pressed={amountsHidden}
          onClick={() => setAmountsHidden((hidden) => !hidden)}
        >
          {amountsHidden ? "금액 보기" : "금액 숨기기"}
        </Button>
      </div>

      <StatusBanner
        tone={conclusion.tone}
        icon={conclusion.icon}
        eyebrow={conclusion.eyebrow}
        title={conclusion.title}
        description={
          snapshot.blockReason
            ? `${snapshot.blockReason.problem} ${snapshot.blockReason.protectiveAction} ${snapshot.blockReason.nextAction}`
            : conclusion.description
        }
      />

      <section className={styles.summaryGrid} aria-label="포트폴리오 요약">
        <SummaryCard
          label="총 관리 자산"
          value={
            snapshot.totalValueMinor === null
              ? "확인 불가"
              : amountsHidden
                ? "••••••••"
                : formatWon(snapshot.totalValueMinor)
          }
          description={`${observedAt} 기준`}
          emphasis="strong"
        />
        <SummaryCard
          label="검증된 관리 현금"
          value={
            snapshot.verifiedCashMinor === null
              ? "확인 불가"
              : amountsHidden
                ? "••••••••"
                : formatWon(snapshot.verifiedCashMinor)
          }
          description={
            snapshot.verifiedCashMinor === null
              ? "현금 비중 계산과 주문을 차단합니다"
              : "목표 현금 비중에 포함되는 금액입니다"
          }
        />
        <SummaryCard
          label="목표 범위 밖"
          value={`${outOfBandAllocations.length}개`}
          description={
            outOfBandAllocations.length > 0 ? "목표 비중을 확인해 주세요" : "모두 목표 범위 안"
          }
        />
      </section>

      <div className={styles.contentGrid}>
        <Surface className={styles.allocations} aria-labelledby="allocation-title">
          <div className={styles.sectionHeader}>
            <div>
              <p>포트폴리오</p>
              <h2 id="allocation-title">현재 비중과 목표</h2>
            </div>
            <Badge tone={conclusion.tone}>{conclusion.allocationLabel}</Badge>
          </div>
          <div className={styles.allocationList}>
            {snapshot.allocations.length > 0 ? (
              snapshot.allocations.map((allocation) => (
                <AllocationBand key={allocation.id} {...allocation} />
              ))
            ) : (
              <p>표시할 실제 보유자산이 없습니다. 차단 원인과 다음 행동을 확인해 주세요.</p>
            )}
          </div>
        </Surface>

        <aside className={styles.rightColumn} aria-label="필요한 행동과 최근 활동">
          <Surface className={styles.actionCard} aria-labelledby="action-title">
            <p>필요한 행동</p>
            <h2 id="action-title">{action.title}</h2>
            <p>{action.description}</p>
            {outOfBandAllocations.length > 0 ? (
              <dl>
                {outOfBandAllocations.map((allocation) => (
                  <div key={allocation.id}>
                    <dt>{allocation.label}</dt>
                    <dd>
                      {formatCurrentWeight(allocation.currentBasisPointHundredths)} → 목표{" "}
                      {allocation.targetBasisPoints === null
                        ? "미설정"
                        : formatBasisPoints(allocation.targetBasisPoints)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <Link className={styles.actionLink} href={action.href}>
              {action.linkLabel}
            </Link>
          </Surface>

          <Surface className={styles.activity} aria-labelledby="activity-title">
            <h2 id="activity-title">최근 상태</h2>
            <ol>
              <li>
                <strong>계좌 정보 업데이트</strong>
                <span>{observedAt}</span>
              </li>
            </ol>
          </Surface>
        </aside>
      </div>
    </>
  );
}

function getConclusionCopy(conclusion: DashboardSnapshotContract["conclusion"]): {
  tone: "normal" | "attention" | "blocked";
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  allocationLabel: string;
} {
  switch (conclusion) {
    case "NO_ACTION":
      return {
        tone: "normal",
        icon: "✓",
        eyebrow: "오늘의 점검을 마쳤어요",
        title: "지금은 거래할 필요가 없어요",
        description: "모든 자산이 허용 범위 안에 있습니다.",
        allocationLabel: "목표 범위 안",
      };
    case "REBALANCE_REQUIRED":
      return {
        tone: "attention",
        icon: "↗",
        eyebrow: "리밸런싱 검토가 필요해요",
        title: "목표 비중을 벗어난 자산이 있어요",
        description: "주문 계획을 만들기 전에 현재 비중과 허용 범위를 확인해 주세요.",
        allocationLabel: "범위 이탈",
      };
    case "BLOCKED":
      return {
        tone: "blocked",
        icon: "!",
        eyebrow: "안전을 위해 거래를 멈췄어요",
        title: "상태를 확인하기 전에는 실행할 수 없어요",
        description: "새 주문을 차단했습니다. 원인을 해결한 뒤 상태를 다시 확인해 주세요.",
        allocationLabel: "거래 차단",
      };
  }
}

function getActionCopy(snapshot: DashboardSnapshotContract): {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
} {
  if (snapshot.conclusion === "NO_ACTION") {
    return {
      title: "추가 행동이 필요하지 않아요",
      description: "모든 자산이 설정된 허용 범위 안에 있습니다.",
      href: "/portfolio",
      linkLabel: "포트폴리오 상세 보기",
    };
  }
  if (snapshot.conclusion === "REBALANCE_REQUIRED") {
    return {
      title: "목표 비중을 확인해 주세요",
      description: "범위를 벗어난 자산과 필요한 점검 항목을 확인할 수 있습니다.",
      href: "/rebalancing",
      linkLabel: "리밸런싱 점검 보기",
    };
  }
  const settingsRequired = ["TARGET_CONFIG_MISSING", "UNMANAGED_ASSET"].includes(
    snapshot.blockReason?.code ?? "",
  );
  return {
    title: "안전 검사를 통과하지 못했어요",
    description: "문제·보호 조치·다음 행동을 실제 상태에서 확인하세요.",
    href: settingsRequired ? "/settings" : "/troubleshooting",
    linkLabel: settingsRequired ? "목표 설정 열기" : "차단 원인 해결하기",
  };
}
