import type { Metadata } from "next";

import { PortfolioScreen } from "@/features/portfolio/portfolio-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";

export const metadata: Metadata = { title: "포트폴리오 | Portfolio Rebalancer" };

export default async function PortfolioPage() {
  return <PortfolioScreen snapshot={await getEngineDashboard()} />;
}
