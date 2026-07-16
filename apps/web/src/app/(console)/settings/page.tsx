import type { Metadata } from "next";

import { SettingsScreen } from "@/features/settings/settings-screen";
import { getEngineTargetSettings } from "@/server/engine-console";

export const metadata: Metadata = { title: "설정 | Portfolio Rebalancer" };

export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  return <SettingsScreen settings={await getEngineTargetSettings()} status={status} />;
}
