import type { Metadata } from "next";

import { TroubleshootingScreen } from "@/features/troubleshooting/troubleshooting-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";
import { requireOperatorPageContext } from "@/server/operator-auth";

export const metadata: Metadata = { title: "문제 해결 | Portfolio Rebalancer" };

export default async function TroubleshootingPage() {
  const operator = await requireOperatorPageContext("/troubleshooting");
  const snapshot = await getEngineDashboard();
  return <TroubleshootingScreen snapshot={snapshot} csrfToken={operator.csrfToken} />;
}
