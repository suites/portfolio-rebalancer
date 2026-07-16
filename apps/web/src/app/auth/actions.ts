"use server";

import { redirect } from "next/navigation";

import {
  clearOperatorSession,
  OperatorAuthError,
  reauthenticateOperator,
  requireOperatorMutation,
  startOperatorSession,
} from "@/server/operator-auth";
import { safeOperatorReturnTo } from "@/server/operator-auth-core";

export type OperatorAuthActionState = {
  readonly status: "idle" | "error";
  readonly message: string | null;
};

export async function loginOperatorAction(
  _previousState: OperatorAuthActionState,
  formData: FormData,
): Promise<OperatorAuthActionState> {
  const returnTo = safeOperatorReturnTo(formData.get("returnTo"));
  try {
    await startOperatorSession({
      operatorId: stringField(formData, "operatorId"),
      password: passwordField(formData),
    });
  } catch (error) {
    return authActionErrorState(error);
  }
  redirect(returnTo);
}

export async function reauthenticateOperatorAction(
  _previousState: OperatorAuthActionState,
  formData: FormData,
): Promise<OperatorAuthActionState> {
  const returnTo = safeOperatorReturnTo(formData.get("returnTo"));
  try {
    await reauthenticateOperator({
      formData,
      password: passwordField(formData),
    });
  } catch (error) {
    if (error instanceof OperatorAuthError && error.code === "AUTH_UNAUTHENTICATED") {
      redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
    return authActionErrorState(error);
  }
  redirect(returnTo);
}

export async function logoutOperatorAction(formData: FormData): Promise<void> {
  try {
    await requireOperatorMutation(formData);
  } catch {
    redirect("/auth/login");
  }
  await clearOperatorSession();
  redirect("/auth/login?status=signed-out");
}

function authActionErrorState(error: unknown): OperatorAuthActionState {
  if (error instanceof OperatorAuthError) {
    if (error.code === "AUTH_NOT_CONFIGURED") {
      return {
        status: "error",
        message:
          "운영자 인증 환경변수가 없거나 안전 기준을 충족하지 않습니다. 설정 전에는 모든 위험 동작을 차단합니다.",
      };
    }
    if (error.code === "AUTH_ORIGIN_INVALID" || error.code === "AUTH_CSRF_INVALID") {
      return {
        status: "error",
        message: "요청 출처 또는 CSRF 토큰을 확인하지 못해 인증을 진행하지 않았습니다.",
      };
    }
  }
  return {
    status: "error",
    message: "운영자 ID 또는 비밀번호가 일치하지 않습니다.",
  };
}

function stringField(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function passwordField(formData: FormData): string {
  const value = formData.get("password");
  return typeof value === "string" ? value : "";
}
