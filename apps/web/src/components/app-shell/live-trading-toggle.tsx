"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  setLiveTradingFromShellAction,
  type SetLiveTradingActionState,
} from "@/app/(console)/actions";

import styles from "./app-shell.module.css";

const initialState: SetLiveTradingActionState = { status: "idle", message: null };

export function LiveTradingToggle({ enabled }: { readonly enabled: boolean }) {
  const [state, action] = useActionState(setLiveTradingFromShellAction, initialState);
  return (
    <div className={styles.liveToggleGroup}>
      <form action={action}>
        <input type="hidden" name="desired" value={enabled ? "OFF" : "ON"} />
        <ToggleButton enabled={enabled} />
      </form>
      {state.status === "error" && state.message ? (
        <span className={styles.liveToggleError} role="alert">
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

function ToggleButton({ enabled }: { readonly enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.liveToggle}
      data-enabled={enabled}
      role="switch"
      aria-checked={enabled}
      aria-label={`실거래 ${enabled ? "ON" : "OFF"}`}
      disabled={pending}
    >
      <span>실거래</span>
      <i aria-hidden="true">
        <b />
      </i>
      <strong>{pending ? "변경 중" : enabled ? "ON" : "OFF"}</strong>
    </button>
  );
}
