import { OverviewScreen } from "@/features/overview/overview-screen";
import { getDemoDashboard } from "@/server/demo-dashboard";

export default function HomePage() {
  const snapshot = getDemoDashboard();
  return <OverviewScreen snapshot={snapshot} />;
}
