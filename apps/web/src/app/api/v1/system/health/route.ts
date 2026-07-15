import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    mode: "paper",
    dataSource: "synthetic",
    brokerConnection: "not_connected",
    liveOrdersEnabled: false,
    timestamp: new Date().toISOString(),
  });
}
