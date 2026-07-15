export type TossTransportErrorCode = "TOSS_API_TIMEOUT" | "TOSS_API_NETWORK_FAILED";

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
  readonly requestId: string | null;
  readonly rateLimitGroup: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(response: Response) {
    super(responseMessage(response.status));
    this.httpStatus = response.status;
    this.requestId =
      response.headers.get("x-request-id") ?? response.headers.get("x-toss-request-id");
    this.rateLimitGroup = response.headers.get("x-ratelimit-group");
    this.retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
  }
}

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
    const callerSignal = init?.signal;
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

    try {
      return await fetchImplementation(input, { ...init, signal });
    } catch {
      const timedOut = timeoutSignal.aborted && !callerSignal?.aborted;
      throw new TossTransportError(timedOut ? "TOSS_API_TIMEOUT" : "TOSS_API_NETWORK_FAILED");
    }
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
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
