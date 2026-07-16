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
    : "이 평가는 주문을 만들거나 제출하지 않습니다.";
  return (
    <>
      <ConsolePageHeader
        eyebrow="리밸런싱"
        title="주문 없는 리밸런싱 점검"
        description="현재 스냅샷에 고정된 목표 설정으로 범위 이탈과 차단 조건만 확인합니다. 가격·수수료·수량을 갖춘 주문 계획은 아직 생성하지 않습니다."
      />
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
              <p>고정된 목표가 없는 자산은 미설정으로 표시합니다.</p>
            </div>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption>자산별 현재 비중, 목표와 정확한 밴드 판정</caption>
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
          <h2 id="risk-title">주문 없는 안전 검사</h2>
          <ul className={styles.statusList}>
            <CheckRow
              label="토스 계좌 스냅샷"
              description="저장된 실제 보유 데이터"
              passed={snapshot.brokerConnection === "CONNECTED" && snapshot.observedAt !== null}
            />
            <CheckRow
              label="목표 설정 버전 고정"
              description="과거 스냅샷을 새 설정으로 재해석하지 않음"
              passed={targetFixed}
            />
            <CheckRow
              label="관리 현금 검증"
              description="buying power를 평가용 현금으로 사용하지 않음"
              passed={snapshot.verifiedCashMinor !== null}
            />
            <li>
              <div>
                <strong>미체결 주문·호가·수수료·시장 상태</strong>
                <span>주문 원장과 pretrade 검사가 아직 연결되지 않음</span>
              </div>
              <Badge tone="blocked">평가 안 됨</Badge>
            </li>
            <li>
              <div>
                <strong>실주문 실행</strong>
                <span>live 쓰기 호출은 코드에서 하드 차단</span>
              </div>
              <Badge tone="blocked">차단</Badge>
            </li>
          </ul>
        </Surface>
      </div>

      <Surface className={styles.surface} aria-labelledby="plan-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="plan-title">주문 계획</h2>
            <p>저장된 계획, 주문 수량, 예상 비용과 거래 후 비중이 없으므로 실행할 수 없습니다.</p>
          </div>
          <Badge tone="blocked">계획 없음</Badge>
        </div>
        <div className={styles.buttonRow}>
          <Button type="button" disabled>
            주문 계획 생성 불가
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
