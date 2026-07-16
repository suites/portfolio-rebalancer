import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Surface } from "@portfolio-rebalancer/ui";

import { getOperatorPageContext, operatorAuthConfigured } from "@/server/operator-auth";
import { safeOperatorReturnTo } from "@/server/operator-auth-core";

import { loginOperatorAction } from "../actions";
import { OperatorLoginForm } from "../auth-form";
import styles from "../auth.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "운영자 로그인 | Portfolio Rebalancer" };

export default async function OperatorLoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly returnTo?: string; readonly status?: string }>;
}) {
  const { returnTo: rawReturnTo, status } = await searchParams;
  const returnTo = safeOperatorReturnTo(rawReturnTo);
  const current = await getOperatorPageContext();
  if (current) redirect(returnTo);
  const configured = operatorAuthConfigured();
  return (
    <main className={styles.page}>
      <Surface className={styles.card} aria-labelledby="operator-login-title">
        <p className={styles.eyebrow}>Operator security</p>
        <h1 id="operator-login-title">운영자 로그인</h1>
        <p className={styles.description}>
          이 콘솔은 개인용 단일 운영자 세션으로 보호됩니다. 로그인만으로 Live 주문이 켜지지는 않으며
          위험 동작은 최근 재인증을 다시 요구합니다.
        </p>
        {status === "signed-out" ? (
          <p className={styles.notice} role="status">
            운영자 세션을 종료했습니다.
          </p>
        ) : null}
        {!configured ? (
          <p className={styles.error} role="alert">
            운영자 인증 환경변수가 없거나 안전 기준을 충족하지 않습니다. 콘솔과 모든 위험 동작을
            차단했습니다.
          </p>
        ) : (
          <OperatorLoginForm action={loginOperatorAction} returnTo={returnTo} />
        )}
      </Surface>
    </main>
  );
}
