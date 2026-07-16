import type { CSSProperties } from "react";

export interface AllocationBandProps {
  readonly label: string;
  readonly description: string;
  readonly currentBasisPointHundredths: number;
  readonly targetBasisPoints: number | null;
  readonly lowerBasisPoints: number | null;
  readonly upperBasisPoints: number | null;
  readonly bandStatus: "IN_RANGE" | "OUTSIDE_BAND" | "TARGET_NOT_CONFIGURED";
}

type AllocationStyle = CSSProperties & {
  "--current": string;
  "--target": string;
  "--range-start": string;
  "--range-width": string;
};

export function AllocationBand({
  label,
  description,
  currentBasisPointHundredths,
  targetBasisPoints,
  lowerBasisPoints,
  upperBasisPoints,
  bandStatus,
}: AllocationBandProps) {
  if (
    targetBasisPoints === null ||
    lowerBasisPoints === null ||
    upperBasisPoints === null ||
    bandStatus === "TARGET_NOT_CONFIGURED"
  ) {
    const current = formatCurrentBasisPoints(currentBasisPointHundredths);
    const style: AllocationStyle = {
      "--current": `${currentBasisPointHundredths / 10_000}%`,
      "--target": "0%",
      "--range-start": "0%",
      "--range-width": "0%",
    };
    return (
      <article className="pr-allocation" data-status="attention">
        <div className="pr-allocation-header">
          <div className="pr-allocation-name">
            <strong>{label}</strong>
            <span>{description}</span>
          </div>
          <div className="pr-allocation-value">
            <strong>{current}</strong>
            <span>목표 미설정</span>
          </div>
        </div>
        <div
          className="pr-allocation-track"
          style={style}
          role="img"
          aria-label={`${label} 현재 ${current}, 목표 비중 미설정`}
        >
          <span className="pr-allocation-current" aria-hidden="true" />
        </div>
        <div className="pr-allocation-meta">
          <span>목표 설정 필요</span>
          <span>주문 계획 차단</span>
        </div>
      </article>
    );
  }
  const status = bandStatus === "OUTSIDE_BAND" ? "attention" : "normal";
  const style: AllocationStyle = {
    "--current": `${currentBasisPointHundredths / 10_000}%`,
    "--target": `${targetBasisPoints / 100}%`,
    "--range-start": `${lowerBasisPoints / 100}%`,
    "--range-width": `${(upperBasisPoints - lowerBasisPoints) / 100}%`,
  };
  const current = formatCurrentBasisPoints(currentBasisPointHundredths);
  const target = formatBasisPoints(targetBasisPoints);
  const lower = formatBasisPoints(lowerBasisPoints);
  const upper = formatBasisPoints(upperBasisPoints);

  return (
    <article className="pr-allocation" data-status={status}>
      <div className="pr-allocation-header">
        <div className="pr-allocation-name">
          <strong>{label}</strong>
          <span>{description}</span>
        </div>
        <div className="pr-allocation-value">
          <strong>{current}</strong>
          <span>목표 {target}</span>
        </div>
      </div>
      <div
        className="pr-allocation-track"
        style={style}
        role="img"
        aria-label={`${label} 현재 ${current}, 목표 ${target}, 허용 범위 ${lower}에서 ${upper}`}
      >
        <span className="pr-allocation-range" aria-hidden="true" />
        <span className="pr-allocation-target" aria-hidden="true" />
        <span className="pr-allocation-current" aria-hidden="true" />
      </div>
      <div className="pr-allocation-meta">
        <span>{status === "normal" ? "목표 범위 안" : "리밸런싱 검토 필요"}</span>
        <span>
          허용 범위 {lower}–{upper}
        </span>
      </div>
    </article>
  );
}

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function formatCurrentBasisPoints(value: number): string {
  return `${(value / 10_000).toFixed(3)}%`;
}
