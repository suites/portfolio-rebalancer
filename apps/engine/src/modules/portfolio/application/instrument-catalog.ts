import type { TossStockInfo, TossStockWarning } from "@portfolio-rebalancer/broker-toss";
import type { InstrumentCandidateContract } from "@portfolio-rebalancer/contracts";

import type { StoredInstrumentValidationInput } from "../infrastructure/persistence/prisma-portfolio.repository";

export const TOSS_STOCK_API_VERSION = "1.2.4";

const supportedListingMarkets = new Set(["KOSPI", "KOSDAQ", "NYSE", "NASDAQ", "AMEX"]);
const supportedSecurityTypes = new Set([
  "STOCK",
  "FOREIGN_STOCK",
  "INFRASTRUCTURE_FUND",
  "REIT",
  "ETF",
  "FOREIGN_ETF",
]);
const viWarningTypes = new Set(["VI_STATIC", "VI_DYNAMIC", "VI_STATIC_AND_DYNAMIC"]);
const knownTradeWarningTypes = new Set([
  "LIQUIDATION_TRADING",
  "OVERHEATED",
  "INVESTMENT_WARNING",
  "INVESTMENT_RISK",
  "VI_STATIC_AND_DYNAMIC",
  "VI_STATIC",
  "VI_DYNAMIC",
  "STOCK_WARRANTS",
]);

export interface ExactInstrumentQuery {
  readonly requestedMarketCountry: "KR" | "US";
  readonly symbol: string;
}

export interface StoredValidationCandidate {
  readonly id: string;
  readonly marketCountry: string;
  readonly symbol: string;
  readonly listingMarket: string;
  readonly name: string;
  readonly englishName: string | null;
  readonly currency: string;
  readonly securityType: string;
  readonly listingStatus: string;
  readonly targetEligibility: string;
  readonly targetReasonCodes: unknown;
  readonly tradeBlockedNow: boolean;
  readonly tradeReasonCodes: unknown;
  readonly requiresOrderRevalidation: boolean;
  readonly observedAt: Date;
}

export function parseExactInstrumentQuery(query: string): ExactInstrumentQuery | null {
  const normalized = query.trim();
  const qualified = /^(KR|US):(.+)$/i.exec(normalized);
  if (qualified) {
    const marketCountry = qualified[1]?.toUpperCase();
    const rawSymbol = qualified[2] ?? "";
    if (marketCountry === "KR" && /^\d{6}$/.test(rawSymbol)) {
      return { requestedMarketCountry: "KR", symbol: rawSymbol };
    }
    if (marketCountry === "US" && /^[A-Za-z][A-Za-z0-9.-]{0,19}$/.test(rawSymbol)) {
      return { requestedMarketCountry: "US", symbol: rawSymbol.toUpperCase() };
    }
    return null;
  }
  if (/^\d{6}$/.test(normalized)) {
    return { requestedMarketCountry: "KR", symbol: normalized };
  }
  if (/^[A-Za-z][A-Za-z0-9.-]{0,19}$/.test(normalized)) {
    return { requestedMarketCountry: "US", symbol: normalized.toUpperCase() };
  }
  return null;
}

export function normalizeTossInstrumentValidation(input: {
  readonly request: ExactInstrumentQuery;
  readonly stock: TossStockInfo;
  readonly warnings: readonly TossStockWarning[];
  readonly observedAt: Date;
}): StoredInstrumentValidationInput {
  const marketCountry = marketCountryFor(input.stock.market);
  const expectedCurrency = marketCountry === "KR" ? "KRW" : "USD";
  const targetReasonCodes: string[] = [];
  const tradeReasonCodes: string[] = [];
  const koreanDetail = input.stock.koreanMarketDetail ?? null;

  if (!supportedListingMarkets.has(input.stock.market)) {
    targetReasonCodes.push("UNSUPPORTED_LISTING_MARKET");
  }
  if (marketCountry !== input.request.requestedMarketCountry) {
    targetReasonCodes.push("MARKET_MISMATCH");
  }
  if (input.stock.currency !== expectedCurrency) {
    targetReasonCodes.push("CURRENCY_MISMATCH");
  }
  if (input.stock.status !== "ACTIVE") {
    targetReasonCodes.push("LISTING_NOT_ACTIVE");
  }
  const observedDate = dateInSeoul(input.observedAt);
  if (
    (input.stock.delistDate !== null && input.stock.delistDate !== undefined) ||
    (input.stock.listDate !== null &&
      input.stock.listDate !== undefined &&
      input.stock.listDate > observedDate)
  ) {
    targetReasonCodes.push("LISTING_METADATA_CONFLICT");
  }
  if (!supportedSecurityTypes.has(input.stock.securityType)) {
    targetReasonCodes.push("UNSUPPORTED_SECURITY_TYPE");
  }
  if (
    (input.stock.securityType === "STOCK" || input.stock.securityType === "FOREIGN_STOCK") &&
    !input.stock.isCommonShare
  ) {
    targetReasonCodes.push("NON_COMMON_SHARE");
  }
  if (input.stock.securityType === "ETF" || input.stock.securityType === "FOREIGN_ETF") {
    if (input.stock.leverageFactor === null || input.stock.leverageFactor === undefined) {
      targetReasonCodes.push("LEVERAGE_UNKNOWN");
    } else if (!isPositiveOne(input.stock.leverageFactor)) {
      targetReasonCodes.push("LEVERAGED_OR_INVERSE");
    }
  } else if (input.stock.leverageFactor !== null && input.stock.leverageFactor !== undefined) {
    targetReasonCodes.push("UNKNOWN_REFERENCE_CODE");
  }
  if (marketCountry === "KR" && koreanDetail === null) {
    targetReasonCodes.push("UNKNOWN_REFERENCE_CODE");
  }
  if (koreanDetail?.liquidationTrading) {
    targetReasonCodes.push("LIQUIDATION_TRADING");
  }
  if (koreanDetail?.krxTradingSuspended) {
    tradeReasonCodes.push("KRX_TRADING_SUSPENDED");
  }

  for (const warning of input.warnings) {
    if (warning.warningType === "LIQUIDATION_TRADING") {
      targetReasonCodes.push("LIQUIDATION_TRADING");
    }
    if (warning.warningType === "STOCK_WARRANTS") {
      targetReasonCodes.push("UNSUPPORTED_SECURITY_TYPE");
    }
    tradeReasonCodes.push(
      knownTradeWarningTypes.has(warning.warningType)
        ? warning.warningType
        : "UNKNOWN_STOCK_WARNING",
    );
  }

  const uniqueTargetReasons = uniqueSorted(targetReasonCodes);
  const uniqueTradeReasons = uniqueSorted(tradeReasonCodes);
  return {
    requestedMarketCountry: input.request.requestedMarketCountry,
    requestedSymbol: input.request.symbol,
    providerApiVersion: TOSS_STOCK_API_VERSION,
    marketCountry,
    symbol: marketCountry === "US" ? input.stock.symbol.toUpperCase() : input.stock.symbol,
    listingMarket: input.stock.market,
    name: input.stock.name,
    englishName: input.stock.englishName,
    isinCode: input.stock.isinCode,
    currency: input.stock.currency,
    securityType: input.stock.securityType,
    isCommonShare: input.stock.isCommonShare,
    listingStatus: input.stock.status,
    listDate: input.stock.listDate ?? null,
    delistDate: input.stock.delistDate ?? null,
    sharesOutstanding: input.stock.sharesOutstanding,
    leverageFactor: input.stock.leverageFactor ?? null,
    liquidationTrading: koreanDetail?.liquidationTrading ?? null,
    nxtSupported: koreanDetail?.nxtSupported ?? null,
    krxTradingSuspended: koreanDetail?.krxTradingSuspended ?? null,
    nxtTradingSuspended: koreanDetail?.nxtTradingSuspended ?? null,
    targetEligibility: uniqueTargetReasons.length === 0 ? "ELIGIBLE" : "BLOCKED",
    targetReasonCodes: uniqueTargetReasons,
    tradeBlockedNow: uniqueTradeReasons.length > 0,
    tradeReasonCodes: uniqueTradeReasons,
    requiresOrderRevalidation: input.warnings.some(({ warningType }) =>
      viWarningTypes.has(warningType),
    ),
    stockPayload: { ...input.stock },
    warningsPayload: input.warnings.map((warning) => ({ ...warning })),
    observedAt: input.observedAt,
  };
}

export function validationCandidate(
  validation: StoredValidationCandidate,
  source: "CATALOG" | "TOSS_EXACT",
): InstrumentCandidateContract {
  const marketCountry = requireMarketCountry(validation.marketCountry);
  const currency = requireCurrency(validation.currency);
  const targetReasonCodes = requireReasonCodes(validation.targetReasonCodes);
  const tradeReasonCodes = requireReasonCodes(validation.tradeReasonCodes);
  const targetEligibility = validation.targetEligibility === "ELIGIBLE" ? "ELIGIBLE" : "BLOCKED";
  return {
    validationId: validation.id,
    instrumentKey: `${marketCountry}:${validation.symbol}`,
    symbol: validation.symbol,
    name: validation.name,
    englishName: validation.englishName,
    marketCountry,
    listingMarket: validation.listingMarket,
    currency,
    securityType: validation.securityType,
    listingStatus: validation.listingStatus,
    source,
    targetEligibility,
    targetReasonCodes,
    addEligible: targetEligibility === "ELIGIBLE",
    blockedReason:
      targetEligibility === "BLOCKED" ? reasonsMessage(targetReasonCodes, "목표 편입") : null,
    tradeBlockedNow: validation.tradeBlockedNow,
    tradeReasonCodes,
    tradeBlockedReason: validation.tradeBlockedNow
      ? reasonsMessage(tradeReasonCodes, "현재 거래")
      : null,
    requiresOrderRevalidation: validation.requiresOrderRevalidation,
    verifiedAt: validation.observedAt.toISOString(),
  };
}

export function selectExactStock(
  stocks: readonly TossStockInfo[],
  request: ExactInstrumentQuery,
): TossStockInfo {
  const matches = stocks.filter(
    (stock) =>
      stock.symbol.toUpperCase() === request.symbol.toUpperCase() &&
      marketCountryFor(stock.market) === request.requestedMarketCountry,
  );
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "요청한 시장과 심볼에 정확히 일치하는 종목을 찾지 못했습니다."
        : "같은 시장과 심볼의 종목이 둘 이상 반환되어 안전하게 선택할 수 없습니다.",
    );
  }
  return matches[0]!;
}

function marketCountryFor(market: TossStockInfo["market"]): "KR" | "US" {
  switch (market) {
    case "KOSPI":
    case "KOSDAQ":
    case "KR_ETC":
      return "KR";
    case "NYSE":
    case "NASDAQ":
    case "AMEX":
    case "US_ETC":
      return "US";
  }
}

function isPositiveOne(value: string): boolean {
  return /^1(?:\.0+)?$/.test(value);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function requireMarketCountry(value: string): "KR" | "US" {
  if (value === "KR" || value === "US") return value;
  throw new Error("저장된 종목 국가 코드가 올바르지 않습니다.");
}

function requireCurrency(value: string): "KRW" | "USD" {
  if (value === "KRW" || value === "USD") return value;
  throw new Error("저장된 종목 통화 코드가 올바르지 않습니다.");
}

function requireReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("저장된 종목 검증 이유 코드가 올바르지 않습니다.");
  }
  const codes: string[] = [];
  for (const code of value as unknown[]) {
    if (typeof code !== "string" || code === "") {
      throw new Error("저장된 종목 검증 이유 코드가 올바르지 않습니다.");
    }
    codes.push(code);
  }
  return codes;
}

function reasonsMessage(codes: readonly string[], subject: string): string {
  return `${subject} 차단: ${codes.map(reasonLabel).join(", ")}`;
}

function reasonLabel(code: string): string {
  switch (code) {
    case "UNSUPPORTED_LISTING_MARKET":
      return "지원하지 않는 상장 시장";
    case "MARKET_MISMATCH":
      return "요청 시장과 응답 시장 불일치";
    case "CURRENCY_MISMATCH":
      return "시장과 통화 불일치";
    case "LISTING_NOT_ACTIVE":
      return "상장 활성 상태 아님";
    case "LISTING_METADATA_CONFLICT":
      return "상장일 정보 모순";
    case "UNSUPPORTED_SECURITY_TYPE":
      return "지원하지 않는 상품 유형";
    case "NON_COMMON_SHARE":
      return "보통주 아님";
    case "LEVERAGE_UNKNOWN":
      return "ETF 레버리지 배수 확인 불가";
    case "LEVERAGED_OR_INVERSE":
      return "레버리지 또는 인버스 상품";
    case "LIQUIDATION_TRADING":
      return "정리매매";
    case "UNKNOWN_REFERENCE_CODE":
      return "필수 종목 정보 확인 불가";
    case "KRX_TRADING_SUSPENDED":
      return "KRX 거래정지";
    case "OVERHEATED":
      return "단기과열";
    case "INVESTMENT_WARNING":
      return "투자경고";
    case "INVESTMENT_RISK":
      return "투자위험";
    case "VI_STATIC":
    case "VI_DYNAMIC":
    case "VI_STATIC_AND_DYNAMIC":
      return "변동성 완화장치 발동";
    case "STOCK_WARRANTS":
      return "신주인수권 유의";
    case "UNKNOWN_STOCK_WARNING":
      return "알 수 없는 종목 유의사항";
    default:
      return code;
  }
}

function dateInSeoul(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
