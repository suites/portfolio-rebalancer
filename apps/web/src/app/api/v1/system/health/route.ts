import { NextResponse } from "next/server";

import { getEngineOperationalConfig } from "../../../../../server/engine-console";
import { getStoredEngineDashboard } from "../../../../../server/engine-dashboard";

export async function GET() {
  const [dashboard, operational] = await Promise.all([
    getStoredEngineDashboard(),
    getEngineOperationalConfig(),
  ]);
  return NextResponse.json({
    status:
      dashboard.brokerConnection === "FAILED" || operational.state === "UNAVAILABLE"
        ? "degraded"
        : "ok",
    mode: (operational.activeVersion?.config.mode ?? "PAPER").toLowerCase(),
    portfolioMode: dashboard.mode.toLowerCase(),
    dataSource: "toss",
    brokerConnection: dashboard.brokerConnection.toLowerCase(),
    killSwitch: operational.killSwitch.toLowerCase(),
    livePromotion: operational.livePromotion.toLowerCase(),
    liveOrdersEnabled: operational.liveOrdersEnabled,
    timestamp: new Date().toISOString(),
  });
}
