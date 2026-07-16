import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  allowedMutationOrigins,
  createOperatorSession,
  isRecentOperatorReauthentication,
  operatorAuditContext,
  parseOperatorSession,
  readOperatorAuthConfiguration,
  refreshOperatorSessionAfterReauthentication,
  serializeOperatorSession,
  verifyOperatorCredentials,
  verifyOperatorCsrfToken,
  type OperatorAuditContext,
  type OperatorAuthConfig,
  type OperatorSession,
} from "./operator-auth-core";

const LOCAL_COOKIE_NAME = "portfolio_operator_session";
const SECURE_COOKIE_NAME = "__Host-portfolio_operator_session";

export type OperatorPageContext = {
  readonly operatorId: string;
  readonly csrfToken: string;
  readonly authenticatedAt: string;
  readonly reauthenticatedAt: string;
  readonly reauthenticationExpiresAt: string;
  readonly recentlyReauthenticated: boolean;
};

export type OperatorAuthErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_UNAUTHENTICATED"
  | "AUTH_CREDENTIALS_INVALID"
  | "AUTH_ORIGIN_INVALID"
  | "AUTH_CSRF_INVALID"
  | "AUTH_REAUTH_REQUIRED";

export class OperatorAuthError extends Error {
  constructor(readonly code: OperatorAuthErrorCode) {
    super(code);
    this.name = "OperatorAuthError";
  }
}

export function operatorAuthConfigured(): boolean {
  return readOperatorAuthConfiguration().configured;
}

export async function getOperatorPageContext(): Promise<OperatorPageContext | null> {
  const configured = requiredConfigurationOrNull();
  if (!configured) return null;
  const session = await currentSession(configured);
  return session ? pageContext(session, configured) : null;
}

export async function requireOperatorPageContext(
  returnTo: string = "/",
): Promise<OperatorPageContext> {
  const configuration = readOperatorAuthConfiguration();
  if (!configuration.configured) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const session = await currentSession(configuration.config);
  if (!session) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return pageContext(session, configuration.config);
}

export async function requireOperatorMutation(
  formData: FormData,
  options: { readonly recentReauthentication?: boolean } = {},
): Promise<OperatorAuditContext> {
  const configuration = readOperatorAuthConfiguration();
  if (!configuration.configured) throw new OperatorAuthError("AUTH_NOT_CONFIGURED");
  await assertSameOrigin(configuration.config);
  const session = await currentSession(configuration.config);
  if (!session) throw new OperatorAuthError("AUTH_UNAUTHENTICATED");
  if (!verifyOperatorCsrfToken(session, formData.get("_csrf"))) {
    throw new OperatorAuthError("AUTH_CSRF_INVALID");
  }
  if (
    options.recentReauthentication &&
    !isRecentOperatorReauthentication(session, configuration.config)
  ) {
    throw new OperatorAuthError("AUTH_REAUTH_REQUIRED");
  }
  return operatorAuditContext(session);
}

export async function startOperatorSession(input: {
  readonly operatorId: string;
  readonly password: string;
}): Promise<OperatorPageContext> {
  const configuration = readOperatorAuthConfiguration();
  if (!configuration.configured) throw new OperatorAuthError("AUTH_NOT_CONFIGURED");
  await assertSameOrigin(configuration.config);
  if (!verifyOperatorCredentials(input.operatorId, input.password, configuration.config)) {
    throw new OperatorAuthError("AUTH_CREDENTIALS_INVALID");
  }
  const session = createOperatorSession(configuration.config);
  await writeSession(session, configuration.config);
  return pageContext(session, configuration.config);
}

export async function reauthenticateOperator(input: {
  readonly formData: FormData;
  readonly password: string;
}): Promise<OperatorPageContext> {
  const configuration = readOperatorAuthConfiguration();
  if (!configuration.configured) throw new OperatorAuthError("AUTH_NOT_CONFIGURED");
  await assertSameOrigin(configuration.config);
  const session = await currentSession(configuration.config);
  if (!session) throw new OperatorAuthError("AUTH_UNAUTHENTICATED");
  if (!verifyOperatorCsrfToken(session, input.formData.get("_csrf"))) {
    throw new OperatorAuthError("AUTH_CSRF_INVALID");
  }
  if (!verifyOperatorCredentials(session.operatorId, input.password, configuration.config)) {
    throw new OperatorAuthError("AUTH_CREDENTIALS_INVALID");
  }
  const refreshed = refreshOperatorSessionAfterReauthentication(session, configuration.config);
  await writeSession(refreshed, configuration.config);
  return pageContext(refreshed, configuration.config);
}

export async function clearOperatorSession(): Promise<void> {
  const store = await cookies();
  store.delete(cookieName());
}

async function currentSession(config: OperatorAuthConfig): Promise<OperatorSession | null> {
  const store = await cookies();
  return parseOperatorSession(store.get(cookieName())?.value, config);
}

async function writeSession(session: OperatorSession, config: OperatorAuthConfig): Promise<void> {
  const store = await cookies();
  store.set(cookieName(), serializeOperatorSession(session, config), {
    httpOnly: true,
    sameSite: "strict",
    secure: secureCookie(),
    path: "/",
    priority: "high",
    maxAge: config.sessionTtlSeconds,
  });
}

async function assertSameOrigin(config: OperatorAuthConfig): Promise<void> {
  const requestHeaders = await headers();
  if (
    !allowedMutationOrigins({
      origin: requestHeaders.get("origin"),
      host: requestHeaders.get("host"),
      forwardedHost: requestHeaders.get("x-forwarded-host"),
      forwardedProto: requestHeaders.get("x-forwarded-proto"),
      configuredOrigins: config.allowedOrigins,
    })
  ) {
    throw new OperatorAuthError("AUTH_ORIGIN_INVALID");
  }
}

function requiredConfigurationOrNull(): OperatorAuthConfig | null {
  const configuration = readOperatorAuthConfiguration();
  return configuration.configured ? configuration.config : null;
}

function pageContext(session: OperatorSession, config: OperatorAuthConfig): OperatorPageContext {
  return {
    operatorId: session.operatorId,
    csrfToken: session.csrfToken,
    authenticatedAt: new Date(session.authenticatedAt).toISOString(),
    reauthenticatedAt: new Date(session.reauthenticatedAt).toISOString(),
    reauthenticationExpiresAt: new Date(
      session.reauthenticatedAt + config.reauthTtlSeconds * 1_000,
    ).toISOString(),
    recentlyReauthenticated: isRecentOperatorReauthentication(session, config),
  };
}

function cookieName(): string {
  return secureCookie() ? SECURE_COOKIE_NAME : LOCAL_COOKIE_NAME;
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production" || process.env.WEB_OPERATOR_SECURE_COOKIE === "true";
}

export type { OperatorAuditContext };
