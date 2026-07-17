import type { Metadata } from "next";

import { TroubleshootingScreen } from "@/features/troubleshooting/troubleshooting-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const metadata: Metadata = { title: "문제 해결 | Portfolio Rebalancer" };

export default async function TroubleshootingPage() {
  const snapshot = await getEngineDashboard();
  return <TroubleshootingScreen snapshot={snapshot} />;
}
