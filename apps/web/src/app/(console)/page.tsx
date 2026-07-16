import { OverviewScreen } from "@/features/overview/overview-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";
import { requireOperatorPageContext } from "@/server/operator-auth";

export default async function HomePage() {
  await requireOperatorPageContext("/");
  const snapshot = await getEngineDashboard();
  return <OverviewScreen snapshot={snapshot} />;
}
