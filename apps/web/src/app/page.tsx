import { OverviewScreen } from "@/features/overview/overview-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const snapshot = await getEngineDashboard();
  return <OverviewScreen snapshot={snapshot} />;
}
