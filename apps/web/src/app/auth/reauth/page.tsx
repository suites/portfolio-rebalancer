import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Surface } from "@portfolio-rebalancer/ui";

import { getOperatorPageContext } from "@/server/operator-auth";
import { safeOperatorReturnTo } from "@/server/operator-auth-core";

import { reauthenticateOperatorAction } from "../actions";
import { OperatorReauthenticationForm } from "../auth-form";
import styles from "../auth.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "운영자 재인증 | Portfolio Rebalancer" };

export default async function OperatorReauthenticationPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly returnTo?: string }>;
}) {
  const { returnTo: rawReturnTo } = await searchParams;
  const returnTo = safeOperatorReturnTo(rawReturnTo);
  const operator = await getOperatorPageContext();
  if (!operator) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return (
    <main className={styles.page}>
      <Surface className={styles.card} aria-labelledby="operator-reauth-title">
        <p className={styles.eyebrow}>Recent authentication</p>
        <h1 id="operator-reauth-title">위험 동작 전 재인증</h1>
        <p className={styles.description}>
          Live 승인·실행, 킬 스위치 해제, Live 승격, 취소와 UNKNOWN 복구에는 최근 비밀번호 확인이
          필요합니다.
        </p>
        <p className={styles.meta}>현재 운영자: {operator.operatorId}</p>
        <OperatorReauthenticationForm
          action={reauthenticateOperatorAction}
          returnTo={returnTo}
          csrfToken={operator.csrfToken}
        />
        <Link className={styles.link} href={returnTo}>
          취소하고 돌아가기
        </Link>
      </Surface>
    </main>
  );
}
