import {
  TOSS_OPERATIONS,
  type TossOperation,
  type TossOperationId,
  type TossRateLimitGroup,
} from "./generated/operations";

export type TossTransportErrorCode = "TOSS_API_TIMEOUT" | "TOSS_API_NETWORK_FAILED";
export type TossRequestOutcome = "SUCCESS" | "HTTP_ERROR" | "TIMEOUT" | "NETWORK_ERROR";

export interface TossResponseMetadata {
  readonly operationId: TossOperationId;
  readonly staticRateLimitGroup: TossRateLimitGroup | null;
  readonly attempt: 1 | 2;
  readonly startedAt: string;
  readonly receivedAt: string;
  readonly outcome: TossRequestOutcome;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly rateLimitLimit: number | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetSeconds: number | null;
  readonly retryAfterSeconds: number | null;
  readonly legacyRequestId: string | null;
  readonly unofficialRateLimitGroup: string | null;
}

export interface TossManagedFetchOptions {
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly maxRetryAfterMs?: number;
  readonly retryJitterMaxMs?: number;
  readonly onResponseMetadata?: (metadata: TossResponseMetadata) => void | Promise<void>;
}

export class TossTransportError extends Error {
  constructor(readonly code: TossTransportErrorCode) {
    super(
      code === "TOSS_API_TIMEOUT"
        ? "토스증권 API 응답 시간이 초과되었습니다. 거래 상태를 확인하기 전에는 다시 제출하지 마세요."
        : "토스증권 API에 연결하지 못했습니다. 거래 상태를 확인하기 전에는 다시 제출하지 마세요.",
    );
  }
}

export class TossApiResponseError extends Error {
  readonly code = "TOSS_API_RESPONSE_ERROR";
  readonly httpStatus: number;
  readonly operationId: TossOperationId | null;
  readonly attempt: 1 | 2 | null;
  readonly requestId: string | null;
  readonly staticRateLimitGroup: TossRateLimitGroup | null;
  readonly rateLimitGroup: string | null;
  readonly unofficialRateLimitGroup: string | null;
  readonly rateLimitLimit: number | null;
  readonly rateLimitRemaining: number | null;
  readonly rateLimitResetSeconds: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(response: Response) {
    super(responseMessage(response.status));
    const metadata = responseMetadata.get(response);
    const legacyRequestId = response.headers.get("x-toss-request-id");
    const unofficialRateLimitGroup = response.headers.get("x-ratelimit-group");

    this.httpStatus = response.status;
    this.operationId = metadata?.operationId ?? null;
    this.attempt = metadata?.attempt ?? null;
    this.requestId = metadata?.requestId ?? response.headers.get("x-request-id") ?? legacyRequestId;
    this.staticRateLimitGroup = metadata?.staticRateLimitGroup ?? null;
    this.rateLimitGroup = this.staticRateLimitGroup ?? unofficialRateLimitGroup;
    this.unofficialRateLimitGroup = unofficialRateLimitGroup;
    this.rateLimitLimit =
      metadata?.rateLimitLimit ??
      parseNonNegativeInteger(response.headers.get("x-ratelimit-limit"));
    this.rateLimitRemaining =
      metadata?.rateLimitRemaining ??
      parseNonNegativeInteger(response.headers.get("x-ratelimit-remaining"));
    this.rateLimitResetSeconds =
      metadata?.rateLimitResetSeconds ??
      parseNonNegativeInteger(response.headers.get("x-ratelimit-reset"));
    this.retryAfterSeconds =
      metadata?.retryAfterSeconds ?? parseRetryAfter(response.headers.get("retry-after"));
  }
}

export class TossOperationMetadataError extends Error {
  readonly code = "TOSS_OPERATION_METADATA_MISSING";

  constructor(method: string, pathname: string) {
    super(`토스증권 operation 메타데이터를 찾지 못했습니다: ${method} ${pathname}`);
  }
}

export class TossRequestAuditError extends Error {
  readonly code = "TOSS_REQUEST_AUDIT_FAILED";

  constructor(options: { readonly cause: unknown }) {
    super(
      "토스증권 요청 감사 기록을 저장하지 못해 후속 처리를 차단했습니다. 저장소 상태를 확인한 뒤 다시 점검하세요.",
      options,
    );
  }
}

const responseMetadata = new WeakMap<Response, TossResponseMetadata>();
const groupQueueTails = new Map<string, Promise<void>>();
const operationMatchers = TOSS_OPERATIONS.map((operation) => ({
  operation,
  pathPattern: operationPathPattern(operation.path),
}));

export function assertTossResponse(response: Response): void {
  if (!response.ok) throw new TossApiResponseError(response);
}

export function createTimedFetch(
  fetchImplementation: typeof globalThis.fetch,
  timeoutMs: number,
): typeof globalThis.fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("requestTimeoutMs는 0보다 큰 안전한 정수여야 합니다.");
  }

  return async (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

    try {
      return await fetchImplementation(input, { ...init, signal });
    } catch {
      const timedOut = timeoutSignal.aborted && !callerSignal?.aborted;
      throw new TossTransportError(timedOut ? "TOSS_API_TIMEOUT" : "TOSS_API_NETWORK_FAILED");
    }
  };
}

export function createTossManagedFetch(
  fetchImplementation: typeof globalThis.fetch,
  options: TossManagedFetchOptions = {},
): typeof globalThis.fetch {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const retryJitterMaxMs = options.retryJitterMaxMs ?? 250;

  assertNonNegativeSafeInteger(maxRetryAfterMs, "maxRetryAfterMs");
  assertPositiveSafeInteger(retryJitterMaxMs, "retryJitterMaxMs");

  return async (input, init) => {
    const reusableRequest = new Request(input, init);
    const operation = findOperation(reusableRequest);
    if (!operation) {
      const url = new URL(reusableRequest.url);
      throw new TossOperationMetadataError(reusableRequest.method, url.pathname);
    }

    const execute = () =>
      executeManagedRequest(reusableRequest, operation, fetchImplementation, {
        now,
        sleep,
        random,
        maxRetryAfterMs,
        retryJitterMaxMs,
        onResponseMetadata: options.onResponseMetadata,
      });
    return operation.rateLimitGroup
      ? enqueueByRateLimitGroup(operation.rateLimitGroup, execute)
      : execute();
  };
}

interface ResolvedManagedFetchOptions {
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly random: () => number;
  readonly maxRetryAfterMs: number;
  readonly retryJitterMaxMs: number;
  readonly onResponseMetadata: TossManagedFetchOptions["onResponseMetadata"];
}

async function executeManagedRequest(
  reusableRequest: Request,
  operation: TossOperation,
  fetchImplementation: typeof globalThis.fetch,
  options: ResolvedManagedFetchOptions,
): Promise<Response> {
  for (const attempt of [1, 2] as const) {
    const startedAt = toIsoString(options.now());
    let response: Response;
    try {
      response = await fetchImplementation(reusableRequest.clone());
    } catch (cause) {
      await emitMetadata(options.onResponseMetadata, {
        operationId: operation.operationId,
        staticRateLimitGroup: operation.rateLimitGroup,
        attempt,
        startedAt,
        receivedAt: toIsoString(options.now()),
        outcome:
          cause instanceof TossTransportError && cause.code === "TOSS_API_TIMEOUT"
            ? "TIMEOUT"
            : "NETWORK_ERROR",
        httpStatus: null,
        requestId: null,
        rateLimitLimit: null,
        rateLimitRemaining: null,
        rateLimitResetSeconds: null,
        retryAfterSeconds: null,
        legacyRequestId: null,
        unofficialRateLimitGroup: null,
      });
      throw cause;
    }

    const metadata = metadataFromResponse(response, operation, attempt, startedAt, options.now());
    responseMetadata.set(response, metadata);
    await emitMetadata(options.onResponseMetadata, metadata);

    const retryDelayMs = getReadRateLimitRetryDelayMs(
      response,
      operation,
      attempt,
      options.maxRetryAfterMs,
      options.retryJitterMaxMs,
      options.random,
    );
    if (retryDelayMs === null) return response;
    await options.sleep(retryDelayMs);
  }

  throw new Error("토스증권 read retry 상태가 올바르지 않습니다.");
}

function metadataFromResponse(
  response: Response,
  operation: TossOperation,
  attempt: 1 | 2,
  startedAt: string,
  receivedAtMs: number,
): TossResponseMetadata {
  return {
    operationId: operation.operationId,
    staticRateLimitGroup: operation.rateLimitGroup,
    attempt,
    startedAt,
    receivedAt: toIsoString(receivedAtMs),
    outcome: response.ok ? "SUCCESS" : "HTTP_ERROR",
    httpStatus: response.status,
    requestId: response.headers.get("x-request-id"),
    rateLimitLimit: parseNonNegativeInteger(response.headers.get("x-ratelimit-limit")),
    rateLimitRemaining: parseNonNegativeInteger(response.headers.get("x-ratelimit-remaining")),
    rateLimitResetSeconds: parseNonNegativeInteger(response.headers.get("x-ratelimit-reset")),
    retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    legacyRequestId: response.headers.get("x-toss-request-id"),
    unofficialRateLimitGroup: response.headers.get("x-ratelimit-group"),
  };
}

function getReadRateLimitRetryDelayMs(
  response: Response,
  operation: TossOperation,
  attempt: 1 | 2,
  maxRetryAfterMs: number,
  retryJitterMaxMs: number,
  random: () => number,
): number | null {
  if (attempt !== 1 || operation.method !== "GET" || response.status !== 429) return null;
  const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  if (retryAfterSeconds === null) return null;
  const retryAfterMs = retryAfterSeconds * 1_000;
  if (!Number.isSafeInteger(retryAfterMs)) return null;

  const sample = random();
  const boundedSample = Number.isFinite(sample) ? Math.min(Math.max(sample, 0), 1) : 0;
  const requestedJitterMs = Math.max(1, Math.ceil(boundedSample * retryJitterMaxMs));
  const totalDelayMs = retryAfterMs + Math.min(requestedJitterMs, retryJitterMaxMs);
  return totalDelayMs <= maxRetryAfterMs ? totalDelayMs : null;
}

async function enqueueByRateLimitGroup<T>(
  rateLimitGroup: string,
  task: () => Promise<T>,
): Promise<T> {
  const previousTail = groupQueueTails.get(rateLimitGroup) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const currentSlot = new Promise<void>((resolveSlot) => {
    release = resolveSlot;
  });
  const currentTail = previousTail.catch(() => undefined).then(() => currentSlot);
  groupQueueTails.set(rateLimitGroup, currentTail);

  await previousTail.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (groupQueueTails.get(rateLimitGroup) === currentTail) {
      groupQueueTails.delete(rateLimitGroup);
    }
  }
}

function findOperation(request: Request): TossOperation | undefined {
  const { pathname } = new URL(request.url);
  return operationMatchers.find(
    ({ operation, pathPattern }) =>
      operation.method === request.method.toUpperCase() && pathPattern.test(pathname),
  )?.operation;
}

function operationPathPattern(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((segment) =>
      /^\{[^}]+\}$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${pattern}$`);
}

async function emitMetadata(
  callback: TossManagedFetchOptions["onResponseMetadata"],
  metadata: TossResponseMetadata,
): Promise<void> {
  if (!callback) return;
  try {
    await callback(metadata);
  } catch (cause) {
    throw new TossRequestAuditError({ cause });
  }
}

function parseRetryAfter(value: string | null): number | null {
  return parseNonNegativeInteger(value);
}

function parseNonNegativeInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const integer = Number(value);
  return Number.isSafeInteger(integer) ? integer : null;
}

function toIsoString(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) {
    throw new Error("now는 유효한 epoch milliseconds를 반환해야 합니다.");
  }
  return new Date(milliseconds).toISOString();
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name}는 0보다 큰 안전한 정수여야 합니다.`);
  }
}

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name}는 0 이상의 안전한 정수여야 합니다.`);
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function responseMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "토스증권 인증 또는 권한을 확인할 수 없어 요청을 차단했습니다.";
  }
  if (status === 429) {
    return "토스증권 API 요청 한도에 도달했습니다. 서버가 안내한 시간 이후 다시 확인하세요.";
  }
  if (status >= 500) {
    return "토스증권 API가 요청을 처리하지 못했습니다. 상태를 확인하기 전에는 다시 제출하지 마세요.";
  }
  return "토스증권 API 요청이 거부되었습니다.";
}
