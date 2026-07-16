import type { Metadata } from "next";

import { RebalancingScreen } from "@/features/rebalancing/rebalancing-screen";
import { getEngineOperationalConfig, getEngineRebalancePlan } from "@/server/engine-console";
import { getEngineDashboard } from "@/server/engine-dashboard";
import { requireOperatorPageContext } from "@/server/operator-auth";

export const metadata: Metadata = { title: "리밸런싱 | Portfolio Rebalancer" };

export default async function RebalancingPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const operator = await requireOperatorPageContext("/rebalancing");
  const [{ status }, snapshot, plan, operational] = await Promise.all([
    searchParams,
    getEngineDashboard(),
    getEngineRebalancePlan(),
    getEngineOperationalConfig(),
  ]);
  return (
    <RebalancingScreen
      snapshot={snapshot}
      plan={plan}
      operational={operational}
      actionStatus={status}
      csrfToken={operator.csrfToken}
    />
  );
}
