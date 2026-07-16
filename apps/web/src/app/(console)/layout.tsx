import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { getEngineOperationalConfig } from "@/server/engine-console";
import { getEngineDashboard } from "@/server/engine-dashboard";
import { getOperatorPageContext } from "@/server/operator-auth";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  const operator = await getOperatorPageContext();
  if (!operator) redirect("/auth/login");
  const [snapshot, operational] = await Promise.all([
    getEngineDashboard(),
    getEngineOperationalConfig(),
  ]);
  return (
    <AppShell snapshot={snapshot} operational={operational} operator={operator}>
      {children}
    </AppShell>
  );
}
