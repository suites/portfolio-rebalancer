import Link from "next/link";

import type { DashboardSnapshotContract } from "@portfolio-rebalancer/contracts";
import { Badge, Button, StatusBanner, Surface } from "@portfolio-rebalancer/ui";

import { formatBasisPoints, formatCurrentWeight } from "@/features/console/format";
import { ConsolePageHeader } from "@/features/console/page-header";
import styles from "@/features/console/console.module.css";

export function RebalancingScreen({ snapshot }: { readonly snapshot: DashboardSnapshotContract }) {
  const targetFixed =
    snapshot.allocations.length > 0 &&
    snapshot.allocations.every(({ targetBasisPoints }) => targetBasisPoints !== null) &&
    !["TARGET_CONFIG_STALE", "UNMANAGED_ASSET"].includes(snapshot.blockReason?.code ?? "");
  const tone =
    snapshot.conclusion === "BLOCKED"
      ? "blocked"
      : snapshot.conclusion === "REBALANCE_REQUIRED"
        ? "attention"
        : "normal";
  const title =
    snapshot.blockReason?.problem ??
    (snapshot.conclusion === "REBALANCE_REQUIRED"
      ? "허용 범위를 벗어난 자산이 있습니다."
      : "현재 목표 범위 안에 있습니다.");
  const description = snapshot.blockReason
    ? `${snapshot.blockReason.protectiveAction} ${snapshot.blockReason.nextAction}`
    : "현재 비중과 목표 범위를 확인했습니다.";
  return (
    <>
      <ConsolePageHeader
        eyebrow="리밸런싱"
        title="리밸런싱 점검"
        description="현재 비중과 목표 범위를 비교하고 필요한 조치를 확인하세요."
      />
      <div className={styles.pageStack}>
        <StatusBanner
          tone={tone}
          icon={tone === "normal" ? "✓" : tone === "attention" ? "↗" : "!"}
          eyebrow="현재 판단"
          title={title}
          description={description}
        />

        <div className={styles.grid2}>
          <Surface className={styles.surface} aria-labelledby="comparison-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="comparison-title">현재와 목표 비교</h2>
                <p>목표가 없는 자산은 미설정으로 표시합니다.</p>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption>자산별 현재 비중, 목표와 허용 범위 판정</caption>
                <thead>
                  <tr>
                    <th scope="col">자산</th>
                    <th scope="col">현재</th>
                    <th scope="col">목표</th>
                    <th scope="col">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.allocations.map((allocation) => (
                    <tr key={allocation.id}>
                      <td>
                        <strong>{allocation.label}</strong>
                      </td>
                      <td data-numeric="true">
                        {formatCurrentWeight(allocation.currentBasisPointHundredths)}
                      </td>
                      <td data-numeric="true">
                        {allocation.targetBasisPoints === null
                          ? "미설정"
                          : formatBasisPoints(allocation.targetBasisPoints)}
                      </td>
                      <td>
                        <Badge tone={allocation.bandStatus === "IN_RANGE" ? "normal" : "attention"}>
                          {allocation.bandStatus === "IN_RANGE"
                            ? "범위 안"
                            : allocation.bandStatus === "OUTSIDE_BAND"
                              ? "이탈"
                              : "미설정"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Surface>

          <Surface className={styles.surface} aria-labelledby="risk-title">
            <h2 id="risk-title">점검 항목</h2>
            <ul className={styles.statusList}>
              <CheckRow
                label="계좌 정보"
                description="최근 보유자산 확인"
                passed={snapshot.brokerConnection === "CONNECTED" && snapshot.observedAt !== null}
              />
              <CheckRow label="목표 설정" description="현재 계좌에 적용됨" passed={targetFixed} />
              <CheckRow
                label="관리 현금"
                description="평가에 사용할 관리 기준 반영"
                passed={snapshot.managedCashMinor !== null}
              />
              <li>
                <div>
                  <strong>거래 가능 여부</strong>
                  <span>가격, 수수료와 시장 상태 확인 필요</span>
                </div>
                <Badge tone="blocked">확인 필요</Badge>
              </li>
            </ul>
          </Surface>
        </div>

        <Surface className={styles.surface} aria-labelledby="plan-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="plan-title">주문 제안</h2>
              <p>현재 생성된 주문 제안이 없습니다.</p>
            </div>
            <Badge tone="blocked">확인 필요</Badge>
          </div>
          <div className={styles.buttonRow}>
            <Button type="button" disabled>
              주문 제안 만들기
            </Button>
            <Link
              className={styles.safeLink}
              href={
                snapshot.blockReason?.code === "TARGET_CONFIG_MISSING"
                  ? "/settings"
                  : "/troubleshooting"
              }
            >
              다음 행동 확인
            </Link>
          </div>
        </Surface>
      </div>
    </>
  );
}

function CheckRow({
  label,
  description,
  passed,
}: {
  readonly label: string;
  readonly description: string;
  readonly passed: boolean;
}) {
  return (
    <li>
      <div>
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <Badge tone={passed ? "normal" : "blocked"}>{passed ? "확인됨" : "차단"}</Badge>
    </li>
  );
}
