import { NextResponse } from "next/server";

import { getStoredEngineDashboard } from "../../../../server/engine-dashboard";

export async function GET() {
  const dashboard = await getStoredEngineDashboard();
  return NextResponse.json({
    brokers: [
      {
        id: "toss",
        displayName: "토스증권",
        connectionStatus: dashboard.brokerConnection.toLowerCase(),
        adapterStatus: "read_only_adapter",
        lastObservedAt: dashboard.observedAt,
        liveOrdersEnabled: false,
      },
    ],
  });
}
