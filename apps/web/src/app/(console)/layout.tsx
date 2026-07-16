import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  const snapshot = await getEngineDashboard();
  return <AppShell snapshot={snapshot}>{children}</AppShell>;
}
