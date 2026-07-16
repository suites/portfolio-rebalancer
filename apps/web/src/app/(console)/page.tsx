import { OverviewScreen } from "@/features/overview/overview-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";

export default async function HomePage() {
  const snapshot = await getEngineDashboard();
  return <OverviewScreen snapshot={snapshot} />;
}
