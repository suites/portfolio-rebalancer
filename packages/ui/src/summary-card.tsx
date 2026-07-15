import type { ReactNode } from "react";

import { Surface } from "./surface";

export interface SummaryCardProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly description: string;
  readonly meta?: ReactNode;
  readonly emphasis?: "default" | "strong";
}

export function SummaryCard({
  label,
  value,
  description,
  meta,
  emphasis = "default",
}: SummaryCardProps) {
  return (
    <Surface className="pr-summary-card" data-emphasis={emphasis}>
      <div className="pr-summary-label">
        <span>{label}</span>
        {meta}
      </div>
      <strong className="pr-summary-value">{value}</strong>
      <p className="pr-summary-description">{description}</p>
    </Surface>
  );
}
