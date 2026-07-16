import type { Metadata } from "next";

import { OrdersScreen } from "@/features/orders/orders-screen";
import { getEngineOrders, getEngineRecords } from "@/server/engine-console";
import { requireOperatorPageContext } from "@/server/operator-auth";

export const metadata: Metadata = { title: "주문·기록 | Portfolio Rebalancer" };

export default async function OrdersPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly status?: string }>;
}) {
  const operator = await requireOperatorPageContext("/orders");
  const [{ status }, records, orders] = await Promise.all([
    searchParams,
    getEngineRecords(),
    getEngineOrders(),
  ]);
  return (
    <OrdersScreen
      records={records}
      orders={orders}
      actionStatus={status}
      csrfToken={operator.csrfToken}
    />
  );
}
