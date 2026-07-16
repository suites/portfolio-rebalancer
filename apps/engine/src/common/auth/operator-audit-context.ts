import { UnauthorizedException } from "@nestjs/common";

export interface EngineOperatorAuditContext {
  readonly operatorId: string;
  readonly sessionId: string;
  readonly authenticatedAt: string;
  readonly reauthenticatedAt: string;
}

const OPERATOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REAUTH_AGE_MS = 5 * 60_000;
const FUTURE_TOLERANCE_MS = 10_000;

export function requireOperatorAuditContext(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  options: { readonly recentReauthentication: boolean },
  now: Date = new Date(),
): EngineOperatorAuditContext {
  const operatorId = singleHeader(headers["x-portfolio-operator-id"]);
  const sessionId = singleHeader(headers["x-portfolio-operator-session-id"]);
  const authenticatedAt = singleHeader(headers["x-portfolio-operator-authenticated-at"]);
  const reauthenticatedAt = singleHeader(headers["x-portfolio-operator-reauthenticated-at"]);
  const authenticatedTime = Date.parse(authenticatedAt ?? "");
  const reauthenticatedTime = Date.parse(reauthenticatedAt ?? "");
  const currentTime = now.getTime();

  if (
    !operatorId ||
    !OPERATOR_ID_PATTERN.test(operatorId) ||
    !sessionId ||
    !UUID_PATTERN.test(sessionId) ||
    !authenticatedAt ||
    !Number.isFinite(authenticatedTime) ||
    !reauthenticatedAt ||
    !Number.isFinite(reauthenticatedTime) ||
    authenticatedTime > currentTime + FUTURE_TOLERANCE_MS ||
    reauthenticatedTime > currentTime + FUTURE_TOLERANCE_MS ||
    reauthenticatedTime < authenticatedTime ||
    (options.recentReauthentication && currentTime - reauthenticatedTime > MAX_REAUTH_AGE_MS)
  ) {
    throw new UnauthorizedException({
      code: options.recentReauthentication
        ? "OPERATOR_RECENT_REAUTH_REQUIRED"
        : "OPERATOR_SESSION_REQUIRED",
      message: options.recentReauthentication
        ? "최근 5분 이내 운영자 재인증 증거가 없어 위험 동작을 차단했습니다."
        : "유효한 운영자 세션 증거가 없어 변경 동작을 차단했습니다.",
    });
  }

  return { operatorId, sessionId, authenticatedAt, reauthenticatedAt };
}

export function operatorAuditActor(context: EngineOperatorAuditContext): string {
  return [
    `operator=${context.operatorId}`,
    `session=${context.sessionId}`,
    `authenticatedAt=${context.authenticatedAt}`,
    `reauthenticatedAt=${context.reauthenticatedAt}`,
  ].join(";");
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
