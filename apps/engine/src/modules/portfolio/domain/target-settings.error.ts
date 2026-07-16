export type TargetSettingsErrorCode =
  | "NO_SNAPSHOT"
  | "ASSET_SET_MISMATCH"
  | "CLASS_VALUE_UNAVAILABLE"
  | "DRAFT_NOT_FOUND"
  | "LEGACY_DRAFT_REQUIRES_RECREATE"
  | "DRAFT_STALE";

export class TargetSettingsError extends Error {
  constructor(
    readonly code: TargetSettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TargetSettingsError";
  }
}
