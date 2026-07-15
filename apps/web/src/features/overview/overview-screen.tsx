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

import styles from "./overview.module.css";

export interface OverviewScreenProps {
  readonly snapshot: DashboardSnapshotContract;
}

const NAVIGATION = ["포트폴리오", "리밸런싱", "주문·기록", "문제 해결", "설정"];

export function OverviewScreen({ snapshot }: OverviewScreenProps) {
  const [amountsHidden, setAmountsHidden] = useState(false);
  const conclusion = getConclusionCopy(snapshot.conclusion);
  const action = getActionCopy(snapshot.conclusion);
  const outOfBandAllocations = snapshot.allocations.filter(
    ({ bandStatus }) => bandStatus === "OUTSIDE_BAND",
  );
  const observedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(snapshot.observedAt));

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main-content">
        본문으로 건너뛰기
      </a>
      <aside className={styles.sidebar} aria-label="주요 메뉴">
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
        <nav className={styles.navigation}>
          <Link className={styles.activeNav} href="/" aria-current="page">
            <span className={styles.navMarker} aria-hidden="true" />홈
          </Link>
          {NAVIGATION.map((item) => (
            <span className={styles.navItem} aria-disabled="true" key={item}>
              <span className={styles.navMarker} aria-hidden="true" />
              {item}
              <small>준비 중</small>
            </span>
          ))}
        </nav>
        <div className={styles.accountCard}>
          <span className={styles.avatar} aria-hidden="true">
            나
          </span>
          <div>
            <strong>내 포트폴리오</strong>
            <span>{snapshot.mode} 계좌</span>
          </div>
        </div>
      </aside>

      <div className={styles.body}>
        <header className={styles.safetyBar} aria-label="실행 안전 상태">
          <div>
            <Badge tone="info" showDot>
              {snapshot.mode}
            </Badge>
            <Badge tone="info">데모 · 합성 데이터</Badge>
            <span className={styles.accountMeta}>합성 계좌 {snapshot.accountLabel}</span>
            <span className={styles.observedMeta}>데이터 {observedAt}</span>
          </div>
          <div>
            <Badge tone={conclusion.tone} showDot>
              {conclusion.systemLabel}
            </Badge>
            <Badge tone="blocked" showDot>
              실주문 차단
            </Badge>
          </div>
        </header>

        <main id="main-content" className={styles.main} tabIndex={-1}>
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
            description={conclusion.description}
          />

          <section className={styles.summaryGrid} aria-label="포트폴리오 요약">
            <SummaryCard
              label="총 관리 자산"
              value={formatWon(snapshot.totalValueMinor, amountsHidden)}
              description={`${observedAt} 기준`}
              emphasis="strong"
            />
            <SummaryCard
              label="검증된 관리 현금"
              value={
                snapshot.verifiedCashMinor === null
                  ? "확인 불가"
                  : formatWon(snapshot.verifiedCashMinor, amountsHidden)
              }
              description={
                snapshot.verifiedCashMinor === null
                  ? "현금 비중 계산과 주문을 차단합니다"
                  : "목표 현금 비중에 포함되는 금액입니다"
              }
            />
            <SummaryCard
              label="오늘의 거래 한도"
              value="사용 안 함"
              description="안전한 주문 실행기가 아직 연결되지 않았습니다"
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
                {snapshot.allocations.map((allocation) => (
                  <AllocationBand key={allocation.id} {...allocation} />
                ))}
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
                          {formatCurrentBasisPoints(allocation.currentBasisPointHundredths)} → 목표{" "}
                          {formatBasisPoints(allocation.targetBasisPoints)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <Button type="button" disabled aria-describedby="plan-disabled-reason">
                  {action.buttonLabel}
                </Button>
                <p id="plan-disabled-reason" className={styles.safeNote}>
                  {action.safeNote}
                </p>
              </Surface>

              <Surface className={styles.activity} aria-labelledby="activity-title">
                <h2 id="activity-title">최근 활동</h2>
                <ol>
                  <li>
                    <strong>자산 비중 계산 완료</strong>
                    <span>{observedAt} · 데모 합성 스냅샷</span>
                  </li>
                  <li>
                    <strong>실주문 연결 차단 유지</strong>
                    <span>주문 원장과 멱등성 검증 미연결</span>
                  </li>
                </ol>
              </Surface>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function formatWon(valueMinor: string, hidden: boolean): string {
  if (hidden) return "••••••••";
  return `₩${BigInt(valueMinor).toLocaleString("ko-KR")}`;
}

function getConclusionCopy(conclusion: DashboardSnapshotContract["conclusion"]): {
  tone: "normal" | "attention" | "blocked";
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  systemLabel: string;
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
        systemLabel: "시스템 정상",
        allocationLabel: "목표 범위 안",
      };
    case "REBALANCE_REQUIRED":
      return {
        tone: "attention",
        icon: "↗",
        eyebrow: "리밸런싱 검토가 필요해요",
        title: "목표 비중을 벗어난 자산이 있어요",
        description: "주문 계획을 만들기 전에 현재 비중과 허용 범위를 확인해 주세요.",
        systemLabel: "검토 필요",
        allocationLabel: "범위 이탈",
      };
    case "BLOCKED":
    case "UNKNOWN":
      return {
        tone: "blocked",
        icon: "!",
        eyebrow: "안전을 위해 거래를 멈췄어요",
        title: "상태를 확인하기 전에는 실행할 수 없어요",
        description: "새 주문을 차단했습니다. 원인을 해결한 뒤 상태를 다시 확인해 주세요.",
        systemLabel: conclusion === "UNKNOWN" ? "상태 확인 필요" : "거래 차단",
        allocationLabel: "거래 차단",
      };
  }
}

function getActionCopy(conclusion: DashboardSnapshotContract["conclusion"]): {
  title: string;
  description: string;
  buttonLabel: string;
  safeNote: string;
} {
  switch (conclusion) {
    case "NO_ACTION":
      return {
        title: "추가 행동이 필요하지 않아요",
        description: "모든 자산이 설정된 허용 범위 안에 있습니다.",
        buttonLabel: "상세 점검 기능 준비 중",
        safeNote: "현재 화면은 읽기 전용이며 실제 주문을 제출하지 않습니다.",
      };
    case "REBALANCE_REQUIRED":
      return {
        title: "목표 비중을 확인해 주세요",
        description:
          "범위를 벗어난 자산이 있습니다. 주문 계획과 위험 검사는 다음 단계에서 생성합니다.",
        buttonLabel: "계획 생성 기능 준비 중",
        safeNote: "수량·가격·수수료를 검증한 저장 계획이 없으므로 주문은 실행할 수 없습니다.",
      };
    case "BLOCKED":
      return {
        title: "안전 검사를 통과하지 못했어요",
        description: "차단 원인을 해결하고 새 스냅샷을 확인해야 합니다.",
        buttonLabel: "문제 해결 기능 준비 중",
        safeNote: "차단 상태에서는 새 주문과 수동 재제출을 허용하지 않습니다.",
      };
    case "UNKNOWN":
      return {
        title: "상태를 확정할 수 없어요",
        description: "상태 대사가 끝날 때까지 새로운 행동을 시작할 수 없습니다.",
        buttonLabel: "복구 기능 준비 중",
        safeNote: "알 수 없음 상태에서는 새 주문과 수동 재제출을 허용하지 않습니다.",
      };
  }
}

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function formatCurrentBasisPoints(value: number): string {
  return `${(value / 10_000).toFixed(3)}%`;
}
