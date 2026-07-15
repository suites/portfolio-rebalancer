import { useId, type ReactNode } from "react";

export interface StatusBannerProps {
  readonly tone: "normal" | "attention" | "blocked";
  readonly icon: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
}

export function StatusBanner({ tone, icon, eyebrow, title, description }: StatusBannerProps) {
  const titleId = useId();

  return (
    <section className="pr-status-banner" data-tone={tone} aria-labelledby={titleId}>
      <div className="pr-status-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="pr-status-content">
        <p>{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}
