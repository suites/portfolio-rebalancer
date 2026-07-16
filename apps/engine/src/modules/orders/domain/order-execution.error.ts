export type OrderExecutionErrorCode =
  | "ORDER_INPUT_INVALID"
  | "ORDER_PLAN_NOT_FOUND"
  | "ORDER_PLAN_NOT_EXECUTABLE"
  | "ORDER_PLAN_STALE"
  | "ORDER_APPROVAL_INVALID"
  | "ORDER_APPROVAL_STALE"
  | "ORDER_EXECUTION_BLOCKED"
  | "ORDER_PRETRADE_BLOCKED"
  | "ORDER_DISPATCH_BLOCKED"
  | "ORDER_NOT_FOUND"
  | "ORDER_CANCEL_BLOCKED"
  | "ORDER_RECOVERY_BLOCKED"
  | "ORDER_STORE_UNAVAILABLE"
  | "BROKER_EXECUTION_UNAVAILABLE";

export type OrderExecutionErrorKind = "BAD_REQUEST" | "CONFLICT" | "UNAVAILABLE";

export class OrderExecutionError extends Error {
  constructor(
    readonly code: OrderExecutionErrorCode,
    message: string,
    readonly kind: OrderExecutionErrorKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OrderExecutionError";
  }
}
