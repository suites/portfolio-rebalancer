import { CollectionError } from "./errors";

export interface SafeErrorMetadata {
  readonly code: string;
  readonly errorName?: string;
  readonly upstreamStatus?: number;
  readonly databaseCode?: string;
}

export function safeErrorMetadata(error: unknown): SafeErrorMetadata {
  const code = error instanceof CollectionError ? error.code : "UNEXPECTED_ERROR";
  const errorName = error instanceof Error ? error.name : undefined;
  const databaseCode =
    error instanceof Error && typeof (error as Error & { code?: unknown }).code === "string"
      ? ((error as Error & { code: string }).code ?? undefined)
      : undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const status = (current as Error & { httpStatus?: unknown }).httpStatus;
    if (typeof status === "number") {
      return {
        code,
        ...(errorName ? { errorName } : {}),
        ...(databaseCode ? { databaseCode } : {}),
        upstreamStatus: status,
      };
    }
    current = current.cause;
  }
  return {
    code,
    ...(errorName ? { errorName } : {}),
    ...(databaseCode ? { databaseCode } : {}),
  };
}
