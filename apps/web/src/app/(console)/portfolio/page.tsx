import type { Metadata } from "next";

import { PortfolioScreen } from "@/features/portfolio/portfolio-screen";
import { getEngineDashboard } from "@/server/engine-dashboard";
import { requireOperatorPageContext } from "@/server/operator-auth";

export const metadata: Metadata = { title: "포트폴리오 | Portfolio Rebalancer" };

export default async function PortfolioPage() {
  await requireOperatorPageContext("/portfolio");
  return <PortfolioScreen snapshot={await getEngineDashboard()} />;
}
