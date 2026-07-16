"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { TargetSettingsDraftInputContract } from "@portfolio-rebalancer/contracts";

import {
  activateEngineTargetDraft,
  createEngineTargetDraft,
  EngineConsoleRequestError,
} from "@/server/engine-console";
import { refreshEngineDashboard } from "@/server/engine-dashboard";
import { targetSettingsInputFromFormData } from "@/server/target-settings-input";

export async function refreshPortfolioAction() {
  await refreshEngineDashboard();
  revalidatePath("/", "layout");
  redirect("/troubleshooting");
}

export async function saveTargetDraftAction(formData: FormData) {
  let input: TargetSettingsDraftInputContract;
  try {
    input = targetSettingsInputFromFormData(formData);
  } catch {
    revalidatePath("/", "layout");
    redirect("/settings?status=invalid");
  }

  try {
    await createEngineTargetDraft(input);
  } catch (error) {
    const status =
      error instanceof EngineConsoleRequestError
        ? error.code === "DRAFT_STALE"
          ? "draft-stale"
          : error.status === 400
            ? "invalid"
            : "unavailable"
        : "unavailable";
    revalidatePath("/", "layout");
    redirect(`/settings?status=${status}`);
  }
  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function activateTargetDraftAction(formData: FormData) {
  let status: string | null = "activate-invalid";
  const rawVersion = formData.get("version");
  if (typeof rawVersion === "string" && /^\d+$/.test(rawVersion)) {
    try {
      await activateEngineTargetDraft(Number(rawVersion));
      status = null;
    } catch (error) {
      status =
        error instanceof EngineConsoleRequestError
          ? error.code === "DRAFT_STALE"
            ? "draft-stale"
            : error.status === 400
              ? "activate-invalid"
              : "unavailable"
          : "unavailable";
    }
  }
  revalidatePath("/", "layout");
  redirect(status === null ? "/settings" : `/settings?status=${status}`);
}
