import { NextResponse } from "next/server";

import { getEngineOperationalConfig } from "../../../../server/engine-console";
import { getStoredEngineDashboard } from "../../../../server/engine-dashboard";

export async function GET() {
  const [dashboard, operational] = await Promise.all([
    getStoredEngineDashboard(),
    getEngineOperationalConfig(),
  ]);
  return NextResponse.json({
    brokers: [
      {
        id: "toss",
        displayName: "토스증권",
        connectionStatus: dashboard.brokerConnection.toLowerCase(),
        adapterStatus: operational.liveOrdersEnabled ? "live_gated_ready" : "live_gated_blocked",
        lastObservedAt: dashboard.observedAt,
        killSwitch: operational.killSwitch.toLowerCase(),
        livePromotion: operational.livePromotion.toLowerCase(),
        liveOrdersEnabled: operational.liveOrdersEnabled,
      },
    ],
  });
}
