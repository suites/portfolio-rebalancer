import type { Metadata } from "next";

import { SettingsScreen } from "@/features/settings/settings-screen";
import { getEngineOperationalConfig, getEngineTargetSettings } from "@/server/engine-console";

export const metadata: Metadata = { title: "설정 | Portfolio Rebalancer" };

export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string }>;
}) {
  const [{ status }, settings, operational] = await Promise.all([
    searchParams,
    getEngineTargetSettings(),
    getEngineOperationalConfig(),
  ]);
  return <SettingsScreen settings={settings} operational={operational} status={status} />;
}
