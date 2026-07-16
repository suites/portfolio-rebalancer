import type { Metadata } from "next";

import { RebalancingScreen } from "@/features/rebalancing/rebalancing-screen";
import { getEngineRebalancePlan } from "@/server/engine-console";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const metadata: Metadata = { title: "리밸런싱 | Portfolio Rebalancer" };

export default async function RebalancingPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const [{ status }, snapshot, plan] = await Promise.all([
    searchParams,
    getEngineDashboard(),
    getEngineRebalancePlan(),
  ]);
  return <RebalancingScreen snapshot={snapshot} plan={plan} actionStatus={status} />;
}
