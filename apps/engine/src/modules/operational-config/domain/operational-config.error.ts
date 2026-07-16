export type OperationalConfigErrorCode =
  | "OPERATIONAL_CONFIG_INPUT_INVALID"
  | "OPERATIONAL_CONFIG_ACCOUNT_MISSING"
  | "OPERATIONAL_CONFIG_DRAFT_NOT_FOUND"
  | "OPERATIONAL_CONFIG_DRAFT_STALE"
  | "OPERATIONAL_CONFIG_HASH_MISMATCH"
  | "OPERATIONAL_CONFIG_CONTENT_REUSED"
  | "OPERATIONAL_CONFIG_ACTIVE_REQUIRED"
  | "OPERATIONAL_CONFIG_INTEGRITY_BLOCKED"
  | "LIVE_PROMOTION_POLICY_BLOCKED"
  | "LIVE_PROMOTION_KILL_SWITCH_BLOCKED"
  | "LIVE_PROMOTION_REVOKE_REQUIRED"
  | "OPERATIONAL_CONFIG_STORE_UNAVAILABLE";

export type OperationalConfigErrorKind = "BAD_REQUEST" | "CONFLICT" | "UNAVAILABLE";

export class OperationalConfigError extends Error {
  constructor(
    readonly code: OperationalConfigErrorCode,
    message: string,
    readonly kind: OperationalConfigErrorKind,
  ) {
    super(message);
    this.name = "OperationalConfigError";
  }
}
