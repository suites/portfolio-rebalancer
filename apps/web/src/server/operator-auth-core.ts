import "server-only";

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const SESSION_VERSION = 1;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_REAUTH_TTL_SECONDS = 5 * 60;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;
const MAX_REAUTH_TTL_SECONDS = 5 * 60;

export type OperatorAuthConfig = {
  readonly operatorId: string;
  readonly password: string;
  readonly sessionSecret: string;
  readonly sessionTtlSeconds: number;
  readonly reauthTtlSeconds: number;
  readonly allowedOrigins: readonly string[];
};

export type OperatorSession = {
  readonly version: 1;
  readonly operatorId: string;
  readonly sessionId: string;
  readonly authenticatedAt: number;
  readonly reauthenticatedAt: number;
  readonly expiresAt: number;
  readonly csrfToken: string;
};

export type OperatorAuditContext = {
  readonly operatorId: string;
  readonly sessionId: string;
  readonly authenticatedAt: string;
  readonly reauthenticatedAt: string;
};

export type OperatorAuthConfiguration =
  | { readonly configured: true; readonly config: OperatorAuthConfig }
  | { readonly configured: false; readonly reason: string };

export function readOperatorAuthConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OperatorAuthConfiguration {
  const operatorId = environment.WEB_OPERATOR_ID?.trim() ?? "";
  const password = environment.WEB_OPERATOR_PASSWORD ?? "";
  const sessionSecret = environment.WEB_OPERATOR_SESSION_SECRET ?? "";
  const secureCookie = environment.WEB_OPERATOR_SECURE_COOKIE;
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/.test(operatorId)) {
    return {
      configured: false,
      reason: "WEB_OPERATOR_ID가 없거나 허용된 운영자 ID 형식이 아닙니다.",
    };
  }
  if (password.length < 12) {
    return {
      configured: false,
      reason: "WEB_OPERATOR_PASSWORD는 12자 이상이어야 합니다.",
    };
  }
  if (Buffer.byteLength(sessionSecret, "utf8") < 32) {
    return {
      configured: false,
      reason: "WEB_OPERATOR_SESSION_SECRET는 32바이트 이상이어야 합니다.",
    };
  }
  if (secureCookie !== undefined && secureCookie !== "true" && secureCookie !== "false") {
    return {
      configured: false,
      reason: "WEB_OPERATOR_SECURE_COOKIE는 true 또는 false만 사용할 수 있습니다.",
    };
  }

  const sessionTtlSeconds = parseTtl(
    environment.WEB_OPERATOR_SESSION_TTL_SECONDS,
    DEFAULT_SESSION_TTL_SECONDS,
    60,
    MAX_SESSION_TTL_SECONDS,
  );
  const reauthTtlSeconds = parseTtl(
    environment.WEB_OPERATOR_REAUTH_TTL_SECONDS,
    DEFAULT_REAUTH_TTL_SECONDS,
    30,
    MAX_REAUTH_TTL_SECONDS,
  );
  if (sessionTtlSeconds === null || reauthTtlSeconds === null) {
    return {
      configured: false,
      reason: "운영자 세션 또는 최근 재인증 TTL 설정이 허용 범위를 벗어났습니다.",
    };
  }

  const allowedOrigins = parseAllowedOrigins(environment.WEB_OPERATOR_ALLOWED_ORIGINS);
  if (allowedOrigins === null) {
    return {
      configured: false,
      reason: "WEB_OPERATOR_ALLOWED_ORIGINS에는 http 또는 https origin만 사용할 수 있습니다.",
    };
  }
  if (environment.NODE_ENV === "production" && allowedOrigins.length === 0) {
    return {
      configured: false,
      reason: "production에서는 WEB_OPERATOR_ALLOWED_ORIGINS를 명시해야 합니다.",
    };
  }

  return {
    configured: true,
    config: {
      operatorId,
      password,
      sessionSecret,
      sessionTtlSeconds,
      reauthTtlSeconds,
      allowedOrigins,
    },
  };
}

export function verifyOperatorCredentials(
  operatorId: string,
  password: string,
  config: OperatorAuthConfig,
): boolean {
  const idMatches = timingSafeTextEqual(
    operatorId.trim(),
    config.operatorId,
    config.sessionSecret,
    "operator-id",
  );
  const passwordMatches = timingSafeTextEqual(
    password,
    config.password,
    config.sessionSecret,
    "operator-password",
  );
  return idMatches && passwordMatches;
}

export function createOperatorSession(
  config: OperatorAuthConfig,
  now: number = Date.now(),
): OperatorSession {
  return {
    version: SESSION_VERSION,
    operatorId: config.operatorId,
    sessionId: randomUUID(),
    authenticatedAt: now,
    reauthenticatedAt: now,
    expiresAt: now + config.sessionTtlSeconds * 1_000,
    csrfToken: randomBytes(32).toString("hex"),
  };
}

export function refreshOperatorSessionAfterReauthentication(
  _session: OperatorSession,
  config: OperatorAuthConfig,
  now: number = Date.now(),
): OperatorSession {
  return createOperatorSession(config, now);
}

export function serializeOperatorSession(
  session: OperatorSession,
  config: OperatorAuthConfig,
): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sessionSignature(payload, config)}`;
}

export function parseOperatorSession(
  value: string | undefined,
  config: OperatorAuthConfig,
  now: number = Date.now(),
): OperatorSession | null {
  if (!value || value.length > 4096) return null;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = sessionSignature(payload, config);
  if (!timingSafeEncodedEqual(suppliedSignature, expectedSignature)) return null;

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isOperatorSession(candidate)) return null;
  if (
    !timingSafeTextEqual(
      candidate.operatorId,
      config.operatorId,
      config.sessionSecret,
      "session-operator-id",
    ) ||
    candidate.expiresAt <= now ||
    candidate.authenticatedAt > now + 10_000 ||
    candidate.reauthenticatedAt > now + 10_000 ||
    candidate.reauthenticatedAt < candidate.authenticatedAt ||
    candidate.expiresAt <= candidate.authenticatedAt ||
    candidate.expiresAt > candidate.authenticatedAt + config.sessionTtlSeconds * 1_000
  ) {
    return null;
  }
  return candidate;
}

export function verifyOperatorCsrfToken(session: OperatorSession, supplied: unknown): boolean {
  return (
    typeof supplied === "string" &&
    /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEncodedEqual(supplied, session.csrfToken)
  );
}

export function isRecentOperatorReauthentication(
  session: OperatorSession,
  config: OperatorAuthConfig,
  now: number = Date.now(),
): boolean {
  return (
    session.reauthenticatedAt <= now + 10_000 &&
    now - session.reauthenticatedAt <= config.reauthTtlSeconds * 1_000
  );
}

export function operatorAuditContext(session: OperatorSession): OperatorAuditContext {
  return {
    operatorId: session.operatorId,
    sessionId: session.sessionId,
    authenticatedAt: new Date(session.authenticatedAt).toISOString(),
    reauthenticatedAt: new Date(session.reauthenticatedAt).toISOString(),
  };
}

export function allowedMutationOrigins(input: {
  readonly origin: string | null;
  readonly host: string | null;
  readonly forwardedHost: string | null;
  readonly forwardedProto: string | null;
  readonly configuredOrigins: readonly string[];
}): boolean {
  if (!input.origin) return false;
  let normalizedOrigin: string;
  let originProtocol: "http" | "https";
  try {
    const parsedOrigin = new URL(input.origin);
    normalizedOrigin = parsedOrigin.origin;
    if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") return false;
    originProtocol = parsedOrigin.protocol.slice(0, -1) as "http" | "https";
  } catch {
    return false;
  }

  const candidates = new Set(input.configuredOrigins);
  if (candidates.size === 0) {
    const host = firstForwardedValue(input.forwardedHost) ?? input.host?.trim() ?? "";
    const forwardedProtocol = firstForwardedValue(input.forwardedProto);
    const protocol =
      forwardedProtocol === "http" || forwardedProtocol === "https"
        ? forwardedProtocol
        : originProtocol;
    if (host && (protocol === "http" || protocol === "https")) {
      try {
        candidates.add(new URL(`${protocol}://${host}`).origin);
      } catch {
        return false;
      }
    }
  }
  return [...candidates].some((candidate) => timingSafeOriginEqual(normalizedOrigin, candidate));
}

export function safeOperatorReturnTo(value: unknown, fallback: string = "/"): string {
  if (typeof value !== "string") return fallback;
  const returnTo = value.trim();
  if (
    returnTo.length === 0 ||
    returnTo.length > 500 ||
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\") ||
    [...returnTo].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return fallback;
  }
  return returnTo;
}

function isOperatorSession(value: unknown): value is OperatorSession {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 7 ||
    record.version !== SESSION_VERSION ||
    typeof record.operatorId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/.test(record.operatorId) ||
    typeof record.sessionId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.sessionId,
    ) ||
    typeof record.authenticatedAt !== "number" ||
    !Number.isSafeInteger(record.authenticatedAt) ||
    typeof record.reauthenticatedAt !== "number" ||
    !Number.isSafeInteger(record.reauthenticatedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt) ||
    typeof record.csrfToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(record.csrfToken)
  ) {
    return false;
  }
  return true;
}

function sessionSignature(payload: string, config: OperatorAuthConfig): string {
  const signingKey = createHmac("sha256", config.sessionSecret)
    .update("portfolio-operator-session-key\0")
    .update(config.password)
    .digest();
  return createHmac("sha256", signingKey).update(payload, "utf8").digest("base64url");
}

function timingSafeTextEqual(left: string, right: string, secret: string, domain: string): boolean {
  const leftDigest = createHmac("sha256", secret).update(domain).update("\0").update(left).digest();
  const rightDigest = createHmac("sha256", secret)
    .update(domain)
    .update("\0")
    .update(right)
    .digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function timingSafeEncodedEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function timingSafeOriginEqual(left: string, right: string): boolean {
  const leftDigest = createHmac("sha256", "portfolio-rebalancer-origin").update(left).digest();
  const rightDigest = createHmac("sha256", "portfolio-rebalancer-origin").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseTtl(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function parseAllowedOrigins(raw: string | undefined): readonly string[] | null {
  if (raw === undefined || raw.trim() === "") return [];
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    try {
      const url = new URL(entry.trim());
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== entry.trim()) {
        return null;
      }
      origins.push(url.origin);
    } catch {
      return null;
    }
  }
  return [...new Set(origins)];
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}
