import { NextResponse } from "next/server";

import { getStoredEngineDashboard } from "../../../../../server/engine-dashboard";

export async function GET() {
  const dashboard = await getStoredEngineDashboard();
  return NextResponse.json({
    status: dashboard.brokerConnection === "FAILED" ? "degraded" : "ok",
    mode: "shadow",
    dataSource: "toss",
    brokerConnection: dashboard.brokerConnection.toLowerCase(),
    liveOrdersEnabled: false,
    timestamp: new Date().toISOString(),
  });
}
