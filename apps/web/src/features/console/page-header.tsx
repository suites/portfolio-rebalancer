import type { ReactNode } from "react";

import styles from "./console.module.css";

export function ConsolePageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
