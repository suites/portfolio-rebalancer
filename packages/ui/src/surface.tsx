import type { HTMLAttributes } from "react";

export function Surface({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`pr-surface ${className}`} {...props} />;
}
