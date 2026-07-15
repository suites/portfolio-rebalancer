import type { ReactNode } from "react";

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "info" | "normal" | "attention" | "blocked";
  readonly showDot?: boolean;
}

export function Badge({ children, tone = "neutral", showDot = false }: BadgeProps) {
  return (
    <span className="pr-badge" data-tone={tone}>
      {showDot ? <span className="pr-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
