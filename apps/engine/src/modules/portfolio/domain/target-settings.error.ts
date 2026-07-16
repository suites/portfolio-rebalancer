export type TargetSettingsErrorCode =
  "NO_SNAPSHOT" | "ASSET_SET_MISMATCH" | "DRAFT_NOT_FOUND" | "DRAFT_STALE";

export class TargetSettingsError extends Error {
  constructor(
    readonly code: TargetSettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TargetSettingsError";
  }
}
