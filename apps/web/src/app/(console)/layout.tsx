import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import { getEngineOperationalConfig } from "@/server/engine-console";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  const [snapshot, operational] = await Promise.all([
    getEngineDashboard(),
    getEngineOperationalConfig(),
  ]);
  return <AppShell snapshot={snapshot} operational={operational}>{children}</AppShell>;
}
