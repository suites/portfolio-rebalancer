export type RebalancePlanErrorCode =
  | "NO_SNAPSHOT"
  | "TARGET_CONFIG_MISSING"
  | "TARGET_CONFIG_STALE"
  | "SNAPSHOT_UNVERIFIED"
  | "MANAGED_CASH_MISSING"
  | "PLAN_IN_PROGRESS"
  | "PLAN_PREVIOUSLY_FAILED"
  | "PLAN_BROKER_PREFLIGHT_FAILED"
  | "PLAN_PERSIST_FAILED";

export class RebalancePlanError extends Error {
  constructor(
    readonly code: RebalancePlanErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RebalancePlanError";
  }
}
