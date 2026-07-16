import type { Metadata } from "next";

import { OrdersScreen } from "@/features/orders/orders-screen";
import { getEngineRecords } from "@/server/engine-console";

export const metadata: Metadata = { title: "주문·기록 | Portfolio Rebalancer" };

export default async function OrdersPage() {
  return <OrdersScreen records={await getEngineRecords()} />;
}
