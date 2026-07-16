import type { Metadata } from "next";

import { RebalancingScreen } from "@/features/rebalancing/rebalancing-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const metadata: Metadata = { title: "리밸런싱 | Portfolio Rebalancer" };

export default async function RebalancingPage() {
  return <RebalancingScreen snapshot={await getEngineDashboard()} />;
}
