import { NextResponse } from "next/server";

import {
  TOSS_TRANSPORT_DESCRIPTOR,
  TOSS_OPENAPI_VERSION,
  TOSS_OPERATIONS,
} from "@portfolio-rebalancer/broker-toss";

export function GET() {
  return NextResponse.json({
    brokers: [
      {
        id: "toss",
        displayName: "토스증권",
        openApiVersion: TOSS_OPENAPI_VERSION,
        operationCount: TOSS_OPERATIONS.length,
        connectionStatus: "not_connected",
        adapterStatus: "transport_only",
        transportCapabilities: [...TOSS_TRANSPORT_DESCRIPTOR.capabilities],
        liveOrdersEnabled: false,
      },
    ],
  });
}
