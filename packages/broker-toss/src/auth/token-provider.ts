export interface TossCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface TossTokenProviderOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly refreshSkewMs?: number;
}

export const TOSS_OPENAPI_ORIGIN = "https://openapi.tossinvest.com" as const;

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

export class TossTokenProvider {
  readonly #credentials: TossCredentials;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;
  readonly #refreshSkewMs: number;
  #cachedToken: CachedToken | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(credentials: TossCredentials, options: TossTokenProviderOptions = {}) {
    if (credentials.clientId.trim().length === 0 || credentials.clientSecret.length === 0) {
      throw new TossCredentialsConfigurationError();
    }
    this.#credentials = credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#refreshSkewMs = options.refreshSkewMs ?? 30_000;
  }

  async getAccessToken(): Promise<string> {
    if (this.#cachedToken && this.#cachedToken.expiresAtMs > this.#now() + this.#refreshSkewMs) {
      return this.#cachedToken.accessToken;
    }
    if (this.#inFlight) {
      return this.#inFlight;
    }

    this.#inFlight = this.#issueToken();
    try {
      return await this.#inFlight;
    } finally {
      this.#inFlight = undefined;
    }
  }

  invalidate(): void {
    this.#cachedToken = undefined;
  }

  async #issueToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    });
    const response = await this.#fetch(new URL("/oauth2/token", TOSS_OPENAPI_ORIGIN), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new TossAuthenticationError(
        response.status,
        redactCredentials(readErrorDescription(payload), this.#credentials),
      );
    }
    if (!isTokenResponse(payload)) {
      throw new TossAuthenticationError(response.status, "토큰 응답 형식이 올바르지 않습니다.");
    }

    this.#cachedToken = {
      accessToken: payload.access_token,
      expiresAtMs: this.#now() + payload.expires_in * 1_000,
    };
    return payload.access_token;
  }
}

export class TossCredentialsConfigurationError extends Error {
  readonly code = "TOSS_CREDENTIALS_INVALID";

  constructor() {
    super("토스증권 API 자격증명이 설정되지 않았습니다.");
  }
}

export class TossAuthenticationError extends Error {
  readonly code = "TOSS_AUTHENTICATION_FAILED";

  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

function isTokenResponse(
  value: unknown,
): value is { access_token: string; token_type: "Bearer"; expires_in: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.access_token === "string" &&
    candidate.access_token.trim().length > 0 &&
    candidate.token_type === "Bearer" &&
    typeof candidate.expires_in === "number" &&
    Number.isSafeInteger(candidate.expires_in) &&
    candidate.expires_in > 0 &&
    candidate.expires_in <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
  );
}

function readErrorDescription(value: unknown): string {
  if (!value || typeof value !== "object") return "토큰 발급에 실패했습니다.";
  const description = (value as Record<string, unknown>).error_description;
  return typeof description === "string" ? description : "토큰 발급에 실패했습니다.";
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new TossAuthenticationError(response.status, "토큰 응답 형식이 올바르지 않습니다.");
  }
}

function redactCredentials(message: string, credentials: TossCredentials): string {
  return [credentials.clientId, credentials.clientSecret]
    .filter((credential) => credential.length > 0)
    .reduce((redacted, credential) => redacted.split(credential).join("[REDACTED]"), message);
}
