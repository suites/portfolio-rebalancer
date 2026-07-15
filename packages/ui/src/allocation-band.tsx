import type { CSSProperties } from "react";

export interface AllocationBandProps {
  readonly label: string;
  readonly description: string;
  readonly currentBasisPointHundredths: number;
  readonly targetBasisPoints: number;
  readonly lowerBasisPoints: number;
  readonly upperBasisPoints: number;
  readonly bandStatus: "IN_RANGE" | "OUTSIDE_BAND";
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
