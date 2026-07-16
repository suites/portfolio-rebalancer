"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@portfolio-rebalancer/ui";

import type { OperatorAuthActionState } from "./actions";
import styles from "./auth.module.css";

const INITIAL_STATE: OperatorAuthActionState = { status: "idle", message: null };

export function OperatorLoginForm({
  action,
  returnTo,
  defaultOperatorId,
}: {
  readonly action: (
    previousState: OperatorAuthActionState,
    formData: FormData,
  ) => Promise<OperatorAuthActionState>;
  readonly returnTo: string;
  readonly defaultOperatorId?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <label>
        운영자 ID
        <input
          name="operatorId"
          defaultValue={defaultOperatorId}
          autoComplete="username"
          maxLength={128}
          required
        />
      </label>
      <label>
        비밀번호
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          maxLength={512}
          required
        />
      </label>
      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}
      <SubmitButton label="운영자 세션 시작" pendingLabel="확인 중…" />
    </form>
  );
}

export function OperatorReauthenticationForm({
  action,
  returnTo,
  csrfToken,
}: {
  readonly action: (
    previousState: OperatorAuthActionState,
    formData: FormData,
  ) => Promise<OperatorAuthActionState>;
  readonly returnTo: string;
  readonly csrfToken: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <form className={styles.form} action={formAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="_csrf" value={csrfToken} />
      <label>
        비밀번호 다시 입력
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={12}
          maxLength={512}
          autoFocus
          required
        />
      </label>
      {state.status === "error" && state.message ? (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      ) : null}
      <SubmitButton label="최근 재인증 갱신" pendingLabel="재인증 중…" />
    </form>
  );
}

function SubmitButton({
  label,
  pendingLabel,
}: {
  readonly label: string;
  readonly pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
