import type {
  BrokerObservationMetadata,
  MarketCalendar,
  MarketCountry,
  MarketSessionKind,
  PriceQuote,
} from "@portfolio-rebalancer/broker";

export interface ReadinessTimePolicy {
  readonly now: Date;
  readonly maxAgeMs: number;
  readonly futureToleranceMs: number;
}

export type QuoteFreshnessStatus = "READY" | "BLOCKED" | "UNKNOWN";

export type QuoteFreshnessReasonCode =
  | "QUOTE_FRESH"
  | "READINESS_POLICY_INVALID"
  | "QUOTE_RECEIVED_TIME_INVALID"
  | "QUOTE_RECEIVED_TIME_FUTURE"
  | "QUOTE_PROVIDER_TIME_UNKNOWN"
  | "QUOTE_PROVIDER_TIME_INVALID"
  | "QUOTE_PROVIDER_TIME_FUTURE"
  | "QUOTE_TIME_ORDER_INVALID"
  | "QUOTE_STALE";

export interface QuoteFreshnessDecision {
  readonly status: QuoteFreshnessStatus;
  readonly canProceed: boolean;
  readonly reasonCode: QuoteFreshnessReasonCode;
  readonly message: string;
  readonly protectiveAction: string;
  readonly nextAction: string;
  readonly providerAgeMs: number | null;
  readonly receivedAgeMs: number | null;
}

export type MarketReadinessState = "OPEN" | "CLOSED" | "AUCTION" | "UNKNOWN";

export type MarketReadinessReasonCode =
  | "MARKET_SESSION_OPEN"
  | "MARKET_CLOSED"
  | "MARKET_SESSION_NOT_ALLOWED"
  | "MARKET_AUCTION_ACTIVE"
  | "READINESS_POLICY_INVALID"
  | "CALENDAR_RECEIVED_TIME_INVALID"
  | "CALENDAR_RECEIVED_TIME_FUTURE"
  | "CALENDAR_STALE"
  | "CALENDAR_CURRENT_DAY_MISSING"
  | "CALENDAR_CURRENT_DAY_INVALID"
  | "CALENDAR_CURRENT_DAY_MISMATCH"
  | "CALENDAR_AUCTION_BOUNDARY_MISSING";

export interface MarketReadinessDecision {
  readonly state: MarketReadinessState;
  readonly canProceed: boolean;
  readonly reasonCode: MarketReadinessReasonCode;
  readonly message: string;
  readonly protectiveAction: string;
  readonly nextAction: string;
  readonly activeSessionKind: MarketSessionKind | null;
}

export function evaluateQuoteFreshness(input: {
  readonly quote: PriceQuote;
  readonly metadata: BrokerObservationMetadata;
  readonly policy: ReadinessTimePolicy;
}): QuoteFreshnessDecision {
  const policy = parsePolicy(input.policy);
  if (!policy) {
    return quoteDecision(
      "BLOCKED",
      "READINESS_POLICY_INVALID",
      "시세 유효시간 정책을 안전하게 해석할 수 없습니다.",
      null,
      null,
      "유효한 현재 시각, 최대 데이터 나이와 미래 시각 허용 오차를 설정하세요.",
    );
  }

  const receivedAtMs = parseOffsetDateTime(input.metadata.receivedAt);
  if (receivedAtMs === null) {
    return quoteDecision(
      "UNKNOWN",
      "QUOTE_RECEIVED_TIME_INVALID",
      "시세 응답 수신 시각을 확인할 수 없습니다.",
      null,
      null,
      "새 시세를 조회하고 응답의 offset 포함 수신 시각을 확인하세요.",
    );
  }
  const receivedAgeMs = policy.nowMs - receivedAtMs;
  if (receivedAtMs - policy.nowMs > policy.futureToleranceMs) {
    return quoteDecision(
      "BLOCKED",
      "QUOTE_RECEIVED_TIME_FUTURE",
      "시세 응답 수신 시각이 현재 시각보다 허용 오차 이상 미래입니다.",
      null,
      receivedAgeMs,
      "서버 시각과 브로커 응답 시각을 확인한 뒤 새 시세를 조회하세요.",
    );
  }

  if (input.quote.observedAt === null) {
    return quoteDecision(
      "UNKNOWN",
      "QUOTE_PROVIDER_TIME_UNKNOWN",
      "브로커가 제공한 시세 관측 시각을 확인할 수 없습니다.",
      null,
      receivedAgeMs,
      "관측 시각이 포함된 새 시세를 조회하세요.",
    );
  }

  const providerObservedAtMs = parseOffsetDateTime(input.quote.observedAt);
  if (providerObservedAtMs === null) {
    return quoteDecision(
      "UNKNOWN",
      "QUOTE_PROVIDER_TIME_INVALID",
      "브로커 시세 관측 시각의 형식을 안전하게 해석할 수 없습니다.",
      null,
      receivedAgeMs,
      "offset이 포함된 정상 시세 관측 시각으로 다시 조회하세요.",
    );
  }
  const providerAgeMs = policy.nowMs - providerObservedAtMs;
  if (providerObservedAtMs - policy.nowMs > policy.futureToleranceMs) {
    return quoteDecision(
      "BLOCKED",
      "QUOTE_PROVIDER_TIME_FUTURE",
      "브로커 시세 관측 시각이 현재 시각보다 허용 오차 이상 미래입니다.",
      providerAgeMs,
      receivedAgeMs,
      "서버와 브로커의 시각 동기화를 확인한 뒤 새 시세를 조회하세요.",
    );
  }
  if (providerObservedAtMs - receivedAtMs > policy.futureToleranceMs) {
    return quoteDecision(
      "BLOCKED",
      "QUOTE_TIME_ORDER_INVALID",
      "시세 관측 시각이 응답 수신 시각보다 허용 오차 이상 늦습니다.",
      providerAgeMs,
      receivedAgeMs,
      "시각 동기화와 응답 metadata를 확인한 뒤 새 시세를 조회하세요.",
    );
  }

  const oldestEvidenceAgeMs = Math.max(providerAgeMs, receivedAgeMs);
  if (oldestEvidenceAgeMs > policy.maxAgeMs) {
    return quoteDecision(
      "BLOCKED",
      "QUOTE_STALE",
      "시세가 허용된 최대 데이터 나이보다 오래되었습니다.",
      providerAgeMs,
      receivedAgeMs,
      "최신 시세를 다시 조회한 뒤 계획을 재평가하세요.",
    );
  }

  return quoteDecision(
    "READY",
    "QUOTE_FRESH",
    "시세 관측 시각과 수신 시각이 허용 범위 안입니다.",
    providerAgeMs,
    receivedAgeMs,
    "현재 시세를 같은 계획 입력 snapshot에 고정하세요.",
  );
}

export function classifyMarketCalendarReadiness(input: {
  readonly calendar: MarketCalendar;
  readonly metadata: BrokerObservationMetadata;
  readonly allowedSessionKinds: readonly MarketSessionKind[];
  readonly policy: ReadinessTimePolicy;
}): MarketReadinessDecision {
  const policy = parsePolicy(input.policy);
  if (!policy || !allowedSessionKindsAreValid(input.allowedSessionKinds)) {
    return marketDecision(
      "UNKNOWN",
      "READINESS_POLICY_INVALID",
      "시장 운영시간 판정 정책을 안전하게 해석할 수 없습니다.",
      null,
      "현재 시각, 데이터 최대 나이, 미래 허용 오차와 허용 세션을 확인하세요.",
    );
  }

  const receivedAtMs = parseOffsetDateTime(input.metadata.receivedAt);
  if (receivedAtMs === null) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_RECEIVED_TIME_INVALID",
      "시장 캘린더 응답 수신 시각을 확인할 수 없습니다.",
      null,
      "offset이 포함된 수신 시각으로 시장 캘린더를 다시 조회하세요.",
    );
  }
  if (receivedAtMs - policy.nowMs > policy.futureToleranceMs) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_RECEIVED_TIME_FUTURE",
      "시장 캘린더 수신 시각이 현재 시각보다 허용 오차 이상 미래입니다.",
      null,
      "서버 시각을 확인한 뒤 시장 캘린더를 다시 조회하세요.",
    );
  }
  if (policy.nowMs - receivedAtMs > policy.maxAgeMs) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_STALE",
      "시장 캘린더가 허용된 최대 데이터 나이보다 오래되었습니다.",
      null,
      "현재 거래일의 시장 캘린더를 다시 조회하세요.",
    );
  }

  const currentDay = (input.calendar as Partial<MarketCalendar>).today;
  if (!currentDay) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_CURRENT_DAY_MISSING",
      "현재 거래일의 시장 캘린더 증거가 없습니다.",
      null,
      "현재 시장의 거래일 캘린더를 다시 조회하세요.",
    );
  }
  if (!isIsoDate(currentDay.date) || !Array.isArray(currentDay.sessions)) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_CURRENT_DAY_INVALID",
      "현재 거래일의 시장 캘린더 형식을 안전하게 해석할 수 없습니다.",
      null,
      "시장 캘린더의 날짜와 세션 구간을 확인한 뒤 다시 조회하세요.",
    );
  }

  const marketDate = dateInMarket(input.calendar.marketCountry, input.policy.now);
  if (marketDate === null || currentDay.date !== marketDate) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_CURRENT_DAY_MISMATCH",
      "시장 캘린더의 기준 거래일이 현재 시장 날짜와 일치하지 않습니다.",
      null,
      "현재 시장 현지 날짜를 기준으로 캘린더를 다시 조회하세요.",
    );
  }

  const parsedSessions = parseSessions(currentDay.sessions);
  if (parsedSessions === null) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_CURRENT_DAY_INVALID",
      "현재 거래일의 세션 또는 경매 구간이 올바르지 않습니다.",
      null,
      "시장 세션 시작·종료와 경매 경계가 포함된 캘린더를 다시 조회하세요.",
    );
  }

  const activeSessions = parsedSessions.filter(
    ({ startMs, endMs }) => startMs <= policy.nowMs && policy.nowMs < endMs,
  );
  const allowedKinds = new Set(input.allowedSessionKinds);
  const activeAllowedSessions = activeSessions.filter(({ kind }) => allowedKinds.has(kind));
  const krSessionWithMissingAuctionEvidence =
    input.calendar.marketCountry === "KR"
      ? activeAllowedSessions.find(
          ({ kind, hadAuctionStart, hadAuctionEnd }) =>
            (kind === "PRE_MARKET" || kind === "REGULAR_MARKET" || kind === "AFTER_MARKET") &&
            !hadAuctionStart &&
            !hadAuctionEnd,
        )
      : undefined;
  if (krSessionWithMissingAuctionEvidence) {
    return marketDecision(
      "UNKNOWN",
      "CALENDAR_AUCTION_BOUNDARY_MISSING",
      `${sessionLabel(krSessionWithMissingAuctionEvidence.kind)}의 단일가 경계를 확인할 수 없습니다.`,
      krSessionWithMissingAuctionEvidence.kind,
      "단일가 경계가 포함된 한국 시장 캘린더를 다시 조회하세요.",
    );
  }

  const auctionSession = activeAllowedSessions.find(
    ({ auctionStartMs, auctionEndMs }) =>
      auctionStartMs !== null &&
      auctionEndMs !== null &&
      auctionStartMs <= policy.nowMs &&
      policy.nowMs < auctionEndMs,
  );
  if (auctionSession) {
    return marketDecision(
      "AUCTION",
      "MARKET_AUCTION_ACTIVE",
      `${sessionLabel(auctionSession.kind)}의 단일가 경매 구간입니다.`,
      auctionSession.kind,
      "경매 구간이 끝난 뒤 최신 호가와 시장 상태를 다시 확인하세요.",
    );
  }

  const openSession = activeAllowedSessions[0];
  if (openSession) {
    return marketDecision(
      "OPEN",
      "MARKET_SESSION_OPEN",
      `${sessionLabel(openSession.kind)}이 열려 있고 주문 허용 세션에 포함됩니다.`,
      openSession.kind,
      "주문 직전에 가격, 호가와 위험 조건을 다시 확인하세요.",
    );
  }

  const disallowedSession = activeSessions[0];
  if (disallowedSession) {
    return marketDecision(
      "CLOSED",
      "MARKET_SESSION_NOT_ALLOWED",
      `${sessionLabel(disallowedSession.kind)}이지만 현재 정책에서 주문을 허용하지 않습니다.`,
      disallowedSession.kind,
      "허용된 거래 세션까지 기다린 뒤 시장 상태를 다시 확인하세요.",
    );
  }

  return marketDecision(
    "CLOSED",
    "MARKET_CLOSED",
    "현재 시각은 확인된 거래 세션 밖입니다.",
    null,
    "다음 허용 거래 세션에 시장 캘린더를 다시 확인하세요.",
  );
}

interface ParsedPolicy {
  readonly nowMs: number;
  readonly maxAgeMs: number;
  readonly futureToleranceMs: number;
}

interface ParsedSession {
  readonly kind: MarketSessionKind;
  readonly startMs: number;
  readonly endMs: number;
  readonly auctionStartMs: number | null;
  readonly auctionEndMs: number | null;
  readonly hadAuctionStart: boolean;
  readonly hadAuctionEnd: boolean;
}

const SESSION_KINDS: readonly MarketSessionKind[] = [
  "DAY_MARKET",
  "PRE_MARKET",
  "REGULAR_MARKET",
  "AFTER_MARKET",
];

function parsePolicy(policy: ReadinessTimePolicy): ParsedPolicy | null {
  if (!policy || !(policy.now instanceof Date)) return null;
  const nowMs = policy.now.getTime();
  if (
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(policy.maxAgeMs) ||
    policy.maxAgeMs < 0 ||
    !Number.isSafeInteger(policy.futureToleranceMs) ||
    policy.futureToleranceMs < 0
  ) {
    return null;
  }
  return {
    nowMs,
    maxAgeMs: policy.maxAgeMs,
    futureToleranceMs: policy.futureToleranceMs,
  };
}

function allowedSessionKindsAreValid(kinds: readonly MarketSessionKind[]): boolean {
  return kinds.every((kind) => SESSION_KINDS.includes(kind));
}

/**
 * Session and auction ranges use half-open intervals: start is included and end
 * is excluded. If only auctionStartAt is present, auction continues until the
 * session end. If only auctionEndAt is present, auction starts at session start.
 */
function parseSessions(sessions: readonly unknown[]): readonly ParsedSession[] | null {
  const parsed: ParsedSession[] = [];
  const seenKinds = new Set<MarketSessionKind>();

  for (const value of sessions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const session = value as Partial<MarketCalendar["today"]["sessions"][number]>;
    if (
      !isSessionKind(session.kind) ||
      seenKinds.has(session.kind) ||
      session.auctionStartAt === undefined ||
      session.auctionEndAt === undefined
    ) {
      return null;
    }
    const startMs = parseOffsetDateTime(session.startAt);
    const endMs = parseOffsetDateTime(session.endAt);
    if (startMs === null || endMs === null || startMs >= endMs) return null;

    const hadAuctionStart = session.auctionStartAt !== null;
    const hadAuctionEnd = session.auctionEndAt !== null;
    let auctionStartMs =
      session.auctionStartAt === null ? null : parseOffsetDateTime(session.auctionStartAt);
    let auctionEndMs =
      session.auctionEndAt === null ? null : parseOffsetDateTime(session.auctionEndAt);
    if (
      (session.auctionStartAt !== null && auctionStartMs === null) ||
      (session.auctionEndAt !== null && auctionEndMs === null)
    ) {
      return null;
    }

    if (auctionStartMs !== null || auctionEndMs !== null) {
      auctionStartMs ??= startMs;
      auctionEndMs ??= endMs;
      if (
        auctionStartMs < startMs ||
        auctionStartMs >= endMs ||
        auctionEndMs <= startMs ||
        auctionEndMs > endMs ||
        auctionStartMs >= auctionEndMs
      ) {
        return null;
      }
    }

    seenKinds.add(session.kind);
    parsed.push({
      kind: session.kind,
      startMs,
      endMs,
      auctionStartMs,
      auctionEndMs,
      hadAuctionStart,
      hadAuctionEnd,
    });
  }

  const ordered = parsed.toSorted((left, right) => left.startMs - right.startMs);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous && current && previous.endMs > current.startMs) return null;
  }
  return ordered;
}

function parseOffsetDateTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").slice(0, 3).padEnd(3, "0") || "0");
  const offsetHour = Number(match[10] ?? "0");
  const offsetMinute = Number(match[11] ?? "0");
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  const localMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const local = new Date(localMs);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    return null;
  }

  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetMs = match[8] === "Z" ? 0 : offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  return localMs - offsetMs;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function isSessionKind(value: unknown): value is MarketSessionKind {
  return typeof value === "string" && SESSION_KINDS.includes(value as MarketSessionKind);
}

function dateInMarket(marketCountry: MarketCountry, now: Date): string | null {
  const timeZone =
    marketCountry === "KR" ? "Asia/Seoul" : marketCountry === "US" ? "America/New_York" : null;
  if (!timeZone) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function quoteDecision(
  status: QuoteFreshnessStatus,
  reasonCode: QuoteFreshnessReasonCode,
  message: string,
  providerAgeMs: number | null,
  receivedAgeMs: number | null,
  nextAction: string,
): QuoteFreshnessDecision {
  return {
    status,
    canProceed: status === "READY",
    reasonCode,
    message,
    protectiveAction:
      status === "READY"
        ? "시세를 계산 입력으로만 사용하고 주문 직전에 다시 검증합니다."
        : "이 시세를 주문 계획과 실행 입력에서 제외했습니다.",
    nextAction,
    providerAgeMs,
    receivedAgeMs,
  };
}

function marketDecision(
  state: MarketReadinessState,
  reasonCode: MarketReadinessReasonCode,
  message: string,
  activeSessionKind: MarketSessionKind | null,
  nextAction: string,
): MarketReadinessDecision {
  return {
    state,
    canProceed: state === "OPEN",
    reasonCode,
    message,
    protectiveAction:
      state === "OPEN"
        ? "시장 상태를 계획 입력으로 고정하되 주문 직전에 다시 확인합니다."
        : "시장 상태를 확인할 수 있거나 허용 세션이 열릴 때까지 주문을 차단했습니다.",
    nextAction,
    activeSessionKind,
  };
}

function sessionLabel(kind: MarketSessionKind): string {
  switch (kind) {
    case "DAY_MARKET":
      return "데이마켓";
    case "PRE_MARKET":
      return "프리마켓";
    case "REGULAR_MARKET":
      return "정규장";
    case "AFTER_MARKET":
      return "애프터마켓";
  }
}
