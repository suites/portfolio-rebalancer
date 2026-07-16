import type {
  AccountId,
  BrokerId,
  BrokerOrderSummary,
  BrokerReadResult,
  BuyingPowerQuote,
  CommissionRateSchedule,
  InstrumentIdentifier,
  IsoDate,
  IsoDateTime,
  MarketCalendar,
  MarketCountry,
  OrderBookSnapshot,
  PriceLimitQuote,
  PriceQuote,
  SellableQuantityQuote,
} from "@portfolio-rebalancer/broker";
import {
  TossAccountsResponseSchema,
  TossBuyingPowerResponseSchema,
  TossCommissionsResponseSchema,
  TossExchangeRateResponseSchema,
  TossHoldingsResponseSchema,
  TossKrMarketCalendarResponseSchema,
  TossOpenApiClient,
  TossOrderbookResponseSchema,
  TossOpenOrdersResponseSchema,
  TossPriceLimitResponseSchema,
  TossPricesResponseSchema,
  TossSellableQuantityResponseSchema,
  TossStockWarningsResponseSchema,
  TossStocksResponseSchema,
  TossUsMarketCalendarResponseSchema,
  getTossResponseAuditReference,
  getTossResponseMetadata,
  normalizeTossCommissions,
  normalizeTossBuyingPower,
  normalizeTossKrMarketCalendar,
  normalizeTossOrderbook,
  normalizeTossOpenOrderSummaries,
  normalizeTossPriceLimit,
  normalizeTossPrices,
  normalizeTossSellableQuantity,
  normalizeTossUsMarketCalendar,
  type TossAccount,
  type TossBuyingPowerResponse,
  type TossExchangeRateResponse,
  type TossHoldingsResponse,
  type TossOperationId,
  type TossStockWarningsResponse,
  type TossStocksResponse,
  type TossResponseMetadata,
} from "@portfolio-rebalancer/broker-toss";
import type { ZodType } from "zod";

import { CollectionError } from "../../domain/collection.error";

export interface TossAccountReadReference {
  readonly accountSeq: number;
  readonly accountId: AccountId;
}

export interface TossNeutralReadResult<Value> extends BrokerReadResult<Value> {
  readonly redactedBody: unknown;
  readonly responseValidationId: string | null;
}

export type TossResponseValidationOutcome = "PASSED" | "SCHEMA_ERROR";

interface TossResponseValidationEventBase {
  readonly requestAttemptId: string;
  readonly operationId: TossOperationId;
  readonly redactedBody: unknown;
  readonly validatedAt: string;
}

export type TossResponseValidationEvent = TossResponseValidationEventBase &
  (
    | {
        readonly outcome: "PASSED";
        readonly safeErrorCode: null;
      }
    | {
        readonly outcome: "SCHEMA_ERROR";
        readonly safeErrorCode: "TOSS_RESPONSE_SCHEMA_ERROR";
      }
  );

export type TossResponseValidationCallback = (
  event: TossResponseValidationEvent,
) => string | Promise<string>;

export interface TossReadSource {
  listAccounts(): Promise<readonly TossAccount[]>;
  getHoldings(accountSeq: number): Promise<TossHoldingsResponse>;
  getBuyingPower(accountSeq: number, currency: "KRW" | "USD"): Promise<TossBuyingPowerResponse>;
  getPrices(
    instruments: readonly InstrumentIdentifier[],
  ): Promise<TossNeutralReadResult<readonly PriceQuote[]>>;
  getOrderBook(instrument: InstrumentIdentifier): Promise<TossNeutralReadResult<OrderBookSnapshot>>;
  getPriceLimit(instrument: InstrumentIdentifier): Promise<TossNeutralReadResult<PriceLimitQuote>>;
  getMarketCalendar(
    marketCountry: MarketCountry,
    date?: IsoDate,
  ): Promise<TossNeutralReadResult<MarketCalendar>>;
  getSellableQuantity(
    account: TossAccountReadReference,
    instrument: InstrumentIdentifier,
  ): Promise<TossNeutralReadResult<SellableQuantityQuote>>;
  getCommissionSchedule(
    account: TossAccountReadReference,
    requestedMarkets: readonly MarketCountry[],
  ): Promise<TossNeutralReadResult<CommissionRateSchedule>>;
  getUsdKrwRate(): Promise<TossExchangeRateResponse>;
  getStocks(symbols: readonly string[]): Promise<TossStocksResponse>;
  getStockWarnings(symbol: string): Promise<TossStockWarningsResponse>;
}

export interface TossPretradeReadSource extends TossReadSource {
  listAccountsEvidence(): Promise<TossNeutralReadResult<readonly TossAccount[]>>;
  getBuyingPowerEvidence(
    account: TossAccountReadReference,
    currency: "KRW" | "USD",
  ): Promise<TossNeutralReadResult<BuyingPowerQuote>>;
  getStocksEvidence(symbols: readonly string[]): Promise<TossNeutralReadResult<TossStocksResponse>>;
  getStockWarningsEvidence(
    symbol: string,
  ): Promise<TossNeutralReadResult<TossStockWarningsResponse>>;
  listOpenOrdersEvidence(
    account: TossAccountReadReference,
  ): Promise<TossNeutralReadResult<readonly BrokerOrderSummary[]>>;
}

export interface TossReadSourceDependencies {
  readonly client?: Pick<TossOpenApiClient, "read">;
}

export function createTossReadSource(
  credentials: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly accountReferenceKey?: string;
    readonly onResponseMetadata?: (
      metadata: TossResponseMetadata,
    ) => string | null | void | Promise<string | null | void>;
    readonly onResponseValidation?: TossResponseValidationCallback;
  },
  dependencies: TossReadSourceDependencies = {},
): TossPretradeReadSource {
  const onResponseValidation = credentials.onResponseValidation;
  const responseSensitiveValues = [credentials.clientId, credentials.clientSecret];
  const validateResponse = <Value>(
    response: TossBusinessResponse,
    operationId: TossOperationId,
    schema: ZodType<Value>,
    redactedBodyFactory?: (value: Value) => unknown,
  ) =>
    validateTossResponse(
      response,
      operationId,
      schema,
      onResponseValidation,
      responseSensitiveValues,
      redactedBodyFactory,
    );
  const client =
    dependencies.client ??
    new TossOpenApiClient(
      {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
      },
      {
        ...(credentials.onResponseMetadata
          ? { onResponseMetadata: credentials.onResponseMetadata }
          : {}),
      },
    );
  return {
    async listAccounts() {
      try {
        const response = await client.read.getAccounts();
        const validated = await validateResponse(
          response,
          "getAccounts",
          TossAccountsResponseSchema,
          (value) => ({
            result: value.result.map((account) => ({
              accountReferenceHmac: createTossAccountReference(
                account.accountNo,
                credentials.accountReferenceKey ?? credentials.clientSecret,
              ),
              accountNo: maskTossAccountNumber(account.accountNo),
              accountType: account.accountType,
            })),
          }),
        );
        return validated.value.result;
      } catch (error) {
        throw normalizeTossError(error, "계좌 목록");
      }
    },
    async listAccountsEvidence() {
      try {
        const response = await client.read.getAccounts();
        const validated = await validateResponse(
          response,
          "getAccounts",
          TossAccountsResponseSchema,
          (value) => ({
            result: value.result.map((account) => ({
              accountReferenceHmac: createTossAccountReference(
                account.accountNo,
                credentials.accountReferenceKey ?? credentials.clientSecret,
              ),
              accountNo: maskTossAccountNumber(account.accountNo),
              accountType: account.accountType,
            })),
          }),
        );
        return withBrokerMetadata(
          response.response,
          "getAccounts",
          validated.value.result,
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "계좌 목록");
      }
    },
    async getHoldings(accountSeq) {
      try {
        const response = await client.read.getHoldings({
          params: { header: { "X-Tossinvest-Account": accountSeq } },
        });
        return (await validateResponse(response, "getHoldings", TossHoldingsResponseSchema)).value;
      } catch (error) {
        throw normalizeTossError(error, "보유자산");
      }
    },
    async getBuyingPower(accountSeq, currency) {
      try {
        const response = await client.read.getBuyingPower({
          params: {
            header: { "X-Tossinvest-Account": accountSeq },
            query: { currency },
          },
        });
        return (await validateResponse(response, "getBuyingPower", TossBuyingPowerResponseSchema))
          .value;
      } catch (error) {
        throw normalizeTossError(error, `${currency} 매수 가능 금액`);
      }
    },
    async getBuyingPowerEvidence(account, currency) {
      assertAccountReference(account);
      try {
        const response = await client.read.getBuyingPower({
          params: {
            header: { "X-Tossinvest-Account": account.accountSeq },
            query: { currency },
          },
        });
        const validated = await validateResponse(
          response,
          "getBuyingPower",
          TossBuyingPowerResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getBuyingPower",
          normalizeTossBuyingPower(validated.value, account.accountId, currency),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, `${currency} 매수 가능 금액`);
      }
    },
    async getPrices(instruments) {
      assertInstrumentRequest(instruments, 200, "시세");
      try {
        const response = await client.read.getPrices({
          params: { query: { symbols: instruments.map(({ symbol }) => symbol).join(",") } },
        });
        const validated = await validateResponse(response, "getPrices", TossPricesResponseSchema);
        return withBrokerMetadata(
          response.response,
          "getPrices",
          normalizeTossPrices(validated.value, instruments),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "현재가");
      }
    },
    async getOrderBook(instrument) {
      assertInstrument(instrument, "호가");
      try {
        const response = await client.read.getOrderbook({
          params: { query: { symbol: instrument.symbol } },
        });
        const validated = await validateResponse(
          response,
          "getOrderbook",
          TossOrderbookResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getOrderbook",
          normalizeTossOrderbook(validated.value, instrument),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "호가");
      }
    },
    async getPriceLimit(instrument) {
      assertInstrument(instrument, "가격 제한");
      try {
        const response = await client.read.getPriceLimit({
          params: { query: { symbol: instrument.symbol } },
        });
        const validated = await validateResponse(
          response,
          "getPriceLimit",
          TossPriceLimitResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getPriceLimit",
          normalizeTossPriceLimit(validated.value, instrument),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "가격 제한");
      }
    },
    async getMarketCalendar(marketCountry, date) {
      if (date !== undefined) assertIsoDate(date);
      try {
        if (marketCountry === "KR") {
          const response = await client.read.getKrMarketCalendar(
            date === undefined ? {} : { params: { query: { date } } },
          );
          const validated = await validateResponse(
            response,
            "getKrMarketCalendar",
            TossKrMarketCalendarResponseSchema,
          );
          return withBrokerMetadata(
            response.response,
            "getKrMarketCalendar",
            normalizeTossKrMarketCalendar(validated.value),
            validated.redactedBody,
            validated.responseValidationId,
          );
        }
        if (marketCountry === "US") {
          const response = await client.read.getUsMarketCalendar(
            date === undefined ? {} : { params: { query: { date } } },
          );
          const validated = await validateResponse(
            response,
            "getUsMarketCalendar",
            TossUsMarketCalendarResponseSchema,
          );
          return withBrokerMetadata(
            response.response,
            "getUsMarketCalendar",
            normalizeTossUsMarketCalendar(validated.value),
            validated.redactedBody,
            validated.responseValidationId,
          );
        }
        throw invalidRequest(
          "시장 캘린더 조회 국가가 올바르지 않습니다.",
          "KR 또는 US 시장을 선택하세요.",
        );
      } catch (error) {
        throw normalizeTossError(error, `${marketCountry} 시장 캘린더`);
      }
    },
    async getSellableQuantity(account, instrument) {
      assertAccountReference(account);
      assertInstrument(instrument, "매도 가능 수량");
      try {
        const response = await client.read.getSellableQuantity({
          params: {
            header: { "X-Tossinvest-Account": account.accountSeq },
            query: { symbol: instrument.symbol },
          },
        });
        const validated = await validateResponse(
          response,
          "getSellableQuantity",
          TossSellableQuantityResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getSellableQuantity",
          normalizeTossSellableQuantity(validated.value, account.accountId, instrument),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "매도 가능 수량");
      }
    },
    async getCommissionSchedule(account, requestedMarkets) {
      assertAccountReference(account);
      try {
        const response = await client.read.getCommissions({
          params: { header: { "X-Tossinvest-Account": account.accountSeq } },
        });
        const validated = await validateResponse(
          response,
          "getCommissions",
          TossCommissionsResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getCommissions",
          normalizeTossCommissions(validated.value, account.accountId, requestedMarkets),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "수수료 일정");
      }
    },
    async getUsdKrwRate() {
      try {
        const response = await client.read.getExchangeRate({
          params: { query: { baseCurrency: "USD", quoteCurrency: "KRW" } },
        });
        return (await validateResponse(response, "getExchangeRate", TossExchangeRateResponseSchema))
          .value;
      } catch (error) {
        throw normalizeTossError(error, "원화 환율");
      }
    },
    async getStocks(symbols) {
      assertStockSymbols(symbols);
      try {
        const response = await client.read.getStocks({
          params: { query: { symbols: symbols.join(",") } },
        });
        return (await validateResponse(response, "getStocks", TossStocksResponseSchema)).value;
      } catch (error) {
        throw normalizeTossError(error, "종목 기본 정보");
      }
    },
    async getStocksEvidence(symbols) {
      assertStockSymbols(symbols);
      try {
        const response = await client.read.getStocks({
          params: { query: { symbols: symbols.join(",") } },
        });
        const validated = await validateResponse(response, "getStocks", TossStocksResponseSchema);
        return withBrokerMetadata(
          response.response,
          "getStocks",
          validated.value,
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "종목 기본 정보");
      }
    },
    async getStockWarnings(symbol) {
      assertStockWarningSymbol(symbol);
      try {
        const response = await client.read.getStockWarnings({
          params: { path: { symbol } },
        });
        return (
          await validateResponse(response, "getStockWarnings", TossStockWarningsResponseSchema)
        ).value;
      } catch (error) {
        throw normalizeTossError(error, "종목 유의사항");
      }
    },
    async getStockWarningsEvidence(symbol) {
      assertStockWarningSymbol(symbol);
      try {
        const response = await client.read.getStockWarnings({
          params: { path: { symbol } },
        });
        const validated = await validateResponse(
          response,
          "getStockWarnings",
          TossStockWarningsResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getStockWarnings",
          validated.value,
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "종목 유의사항");
      }
    },
    async listOpenOrdersEvidence(account) {
      assertAccountReference(account);
      try {
        const response = await client.read.getOrders({
          params: {
            header: { "X-Tossinvest-Account": account.accountSeq },
            query: { status: "OPEN" },
          },
        });
        const validated = await validateResponse(
          response,
          "getOrders",
          TossOpenOrdersResponseSchema,
        );
        return withBrokerMetadata(
          response.response,
          "getOrders",
          normalizeTossOpenOrderSummaries(validated.value),
          validated.redactedBody,
          validated.responseValidationId,
        );
      } catch (error) {
        throw normalizeTossError(error, "미체결 주문");
      }
    },
  };
}

const TOSS_BROKER_ID = "toss" as BrokerId;
const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_RESPONSE_KEY_PARTS = [
  "token",
  "secret",
  "authorization",
  "authentication",
  "authheader",
  "bearer",
  "credential",
  "password",
  "apikey",
] as const;
const SENSITIVE_ACCOUNT_KEY_SUFFIXES = [
  "account",
  "accountno",
  "accountnumber",
  "accountseq",
  "accountid",
  "accountkey",
  "accountref",
  "accountreference",
  "accountreferencekey",
  "accountrefhmac",
  "accountname",
  "accountalias",
] as const;

interface TossBusinessResponse {
  readonly data?: unknown;
  readonly response: Response;
}

interface ValidatedTossResponse<Value> {
  readonly value: Value;
  readonly redactedBody: unknown;
  readonly responseValidationId: string | null;
}

async function validateTossResponse<Value>(
  response: TossBusinessResponse,
  operationId: TossOperationId,
  schema: ZodType<Value>,
  onResponseValidation: TossResponseValidationCallback | undefined,
  sensitiveValues: readonly string[],
  redactedBodyFactory?: (value: Value) => unknown,
): Promise<ValidatedTossResponse<Value>> {
  const fallbackRedactedBody = redactTossResponseBody(response.data, sensitiveValues);
  const requestAttemptId = onResponseValidation
    ? requireResponseAuditReference(response.response, operationId)
    : null;
  const parsed = schema.safeParse(response.data);
  const validatedAt = new Date().toISOString();

  if (!parsed.success) {
    if (onResponseValidation && requestAttemptId) {
      await emitResponseValidation(onResponseValidation, {
        requestAttemptId,
        operationId,
        outcome: "SCHEMA_ERROR",
        redactedBody: fallbackRedactedBody,
        safeErrorCode: "TOSS_RESPONSE_SCHEMA_ERROR",
        validatedAt,
      });
    }
    throw parsed.error;
  }

  const redactedBody = redactedBodyFactory
    ? redactedBodyFactory(parsed.data)
    : fallbackRedactedBody;
  let responseValidationId: string | null = null;
  if (onResponseValidation && requestAttemptId) {
    responseValidationId = await emitResponseValidation(onResponseValidation, {
      requestAttemptId,
      operationId,
      outcome: "PASSED",
      redactedBody,
      safeErrorCode: null,
      validatedAt,
    });
  }

  return { value: parsed.data, redactedBody, responseValidationId };
}

function createTossAccountReference(accountNo: string, key: string): string {
  return createHmac("sha256", key).update(`toss-account-v1:${accountNo}`).digest("hex");
}

function maskTossAccountNumber(accountNo: string): string {
  return `**** ${accountNo.slice(-4)}`;
}

function requireResponseAuditReference(response: Response, operationId: TossOperationId): string {
  const auditReference = getTossResponseAuditReference(response);
  if (auditReference === null) {
    throw new CollectionError(
      "BROKER_FETCH_FAILED",
      `토스증권 ${operationId} 응답에 요청 감사 참조가 없습니다.`,
      "요청 감사 저장과 응답 검증 감사 연결을 확인한 뒤 다시 조회하세요.",
    );
  }
  return auditReference;
}

async function emitResponseValidation(
  callback: TossResponseValidationCallback,
  event: TossResponseValidationEvent,
): Promise<string> {
  try {
    const reference = await callback(event);
    if (!isUuid(reference)) {
      throw new Error("토스증권 응답 검증 감사 참조가 UUID가 아닙니다.");
    }
    return reference;
  } catch (cause) {
    throw new CollectionError(
      "BROKER_FETCH_FAILED",
      "토스증권 응답 검증 감사 기록을 저장하지 못했습니다.",
      "감사 저장소 상태를 확인한 뒤 다시 조회하세요.",
      { cause },
    );
  }
}

export function redactTossResponseBody(
  value: unknown,
  sensitiveValues: readonly string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactTossResponseBody(item, sensitiveValues));
  }
  if (typeof value === "string") {
    return redactSensitiveString(value, sensitiveValues);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value);
  const namedSensitiveField = entries.some(
    ([key, child]) =>
      isDescriptorKey(key) && typeof child === "string" && isSensitiveResponseKey(child),
  );
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      isSensitiveResponseKey(key) || (namedSensitiveField && !isDescriptorKey(key))
        ? REDACTED_VALUE
        : redactTossResponseBody(child, sensitiveValues),
    ]),
  );
}

function isSensitiveResponseKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  if (normalized === "accounttype" || normalized === "accounttypename") {
    return false;
  }
  return (
    /계좌|비밀번호|토큰|비밀/.test(key) ||
    SENSITIVE_RESPONSE_KEY_PARTS.some((part) => normalized.includes(part)) ||
    normalized.includes("account") ||
    SENSITIVE_ACCOUNT_KEY_SUFFIXES.some((suffix) => normalized === suffix)
  );
}

function isDescriptorKey(key: string): boolean {
  const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
  return normalized === "name" || normalized === "key" || normalized === "header";
}

function redactSensitiveString(value: string, sensitiveValues: readonly string[]): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") {
        return JSON.stringify(redactTossResponseBody(parsed, sensitiveValues));
      }
    } catch {
      // Continue with best-effort free-form redaction below.
    }
  }

  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue.length >= 4) {
      redacted = redacted.replaceAll(sensitiveValue, REDACTED_VALUE);
    }
  }
  redacted = redacted
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED_VALUE)
    .replace(/((?:authorization)\s*[:=]\s*)([^,;]+)/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /((?:\\?["'])?(?:access[_\s-]?token|refresh[_\s-]?token|client[_\s-]?secret|api[_\s-]?key|credential|password|token|secret)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)([^\\"',;\s}]+)/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /((?:\\?["'])?(?:account(?:id|identifier|number|no|seq|key|ref|hash)?|계좌(?:\s*번호)?)(?:\\?["'])?(?:\s*[:=#-]\s*(?:\\?["'])?|\s+))([^\\"',;\s}]{6,})/gi,
      `$1${REDACTED_VALUE}`,
    );
  return redacted;
}

function withBrokerMetadata<Value>(
  response: Response,
  expectedOperationId: TossOperationId,
  value: Value,
  redactedBody: unknown,
  responseValidationId: string | null,
): TossNeutralReadResult<Value> {
  const metadata = getTossResponseMetadata(response);
  if (
    !metadata ||
    metadata.operationId !== expectedOperationId ||
    metadata.outcome !== "SUCCESS" ||
    metadata.httpStatus === null ||
    metadata.httpStatus !== response.status ||
    !Number.isFinite(Date.parse(metadata.receivedAt))
  ) {
    throw new CollectionError(
      "BROKER_FETCH_FAILED",
      "토스증권 조회 응답의 감사 메타데이터를 확인하지 못했습니다.",
      "요청 감사 저장과 토스증권 transport 연결을 확인한 뒤 다시 조회하세요.",
    );
  }

  return {
    value,
    metadata: {
      brokerId: TOSS_BROKER_ID,
      operationId: metadata.operationId,
      requestId: metadata.requestId,
      httpStatus: metadata.httpStatus,
      rateLimitGroup: metadata.staticRateLimitGroup,
      receivedAt: metadata.receivedAt as IsoDateTime,
      auditReference: getTossResponseAuditReference(response),
    },
    redactedBody,
    responseValidationId,
  };
}

function assertInstrumentRequest(
  instruments: readonly InstrumentIdentifier[],
  maximum: number,
  subject: string,
): void {
  if (instruments.length === 0 || instruments.length > maximum) {
    throw invalidRequest(
      `${subject} 조회 종목 수가 올바르지 않습니다.`,
      `종목을 1개 이상 ${maximum}개 이하로 선택하세요.`,
    );
  }
  const symbols = new Set<string>();
  for (const instrument of instruments) {
    assertInstrument(instrument, subject);
    if (symbols.has(instrument.symbol)) {
      throw invalidRequest(
        `${subject} 조회에 중복 종목 코드가 있습니다.`,
        "같은 종목 코드는 한 번만 요청하세요.",
      );
    }
    symbols.add(instrument.symbol);
  }
}

function assertInstrument(instrument: InstrumentIdentifier, subject: string): void {
  if (
    (instrument.marketCountry !== "KR" && instrument.marketCountry !== "US") ||
    !/^[A-Za-z0-9.-]+$/.test(instrument.symbol)
  ) {
    throw invalidRequest(
      `${subject} 조회 종목 식별자가 올바르지 않습니다.`,
      "시장 국가와 국내 종목코드 또는 미국 티커를 확인하세요.",
    );
  }
}

function assertAccountReference(account: TossAccountReadReference): void {
  if (
    !Number.isSafeInteger(account.accountSeq) ||
    account.accountSeq <= 0 ||
    typeof account.accountId !== "string" ||
    account.accountId.trim().length === 0
  ) {
    throw invalidRequest(
      "토스 계좌 번호와 저장 계좌 ID의 매핑이 올바르지 않습니다.",
      "계좌 목록의 accountSeq와 저장된 계좌 ID를 다시 확인하세요.",
    );
  }
}

function assertStockSymbols(symbols: readonly string[]): void {
  if (
    symbols.length === 0 ||
    symbols.length > 200 ||
    symbols.some((symbol) => !/^[A-Za-z0-9.-]+$/.test(symbol))
  ) {
    throw invalidRequest(
      "종목 심볼 조회 요청이 올바르지 않습니다.",
      "국내 종목코드 또는 미국 티커를 확인하세요.",
    );
  }
}

function assertStockWarningSymbol(symbol: string): void {
  if (!/^[A-Za-z0-9.-]+$/.test(symbol)) {
    throw invalidRequest(
      "종목 유의사항 조회 심볼이 올바르지 않습니다.",
      "국내 종목코드 또는 미국 티커를 확인하세요.",
    );
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertIsoDate(date: IsoDate): void {
  const milliseconds = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString().slice(0, 10) !== date
  ) {
    throw invalidRequest(
      "시장 캘린더 기준일이 올바르지 않습니다.",
      "YYYY-MM-DD 형식의 실제 날짜를 입력하세요.",
    );
  }
}

function invalidRequest(message: string, action: string): CollectionError {
  return new CollectionError("DATA_INVALID", message, action);
}

function normalizeTossError(error: unknown, subject: string): CollectionError {
  if (error instanceof CollectionError) return error;
  return new CollectionError(
    "BROKER_FETCH_FAILED",
    `토스증권 ${subject} 데이터를 확인하지 못했습니다.`,
    "자격증명, 허용 IP와 토스증권 API 상태를 확인한 뒤 다시 수집하세요.",
    { cause: error },
  );
}
import { createHmac } from "node:crypto";
