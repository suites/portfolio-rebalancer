import type {
  AccountId,
  BrokerId,
  BrokerReadResult,
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
  TossPriceLimitResponseSchema,
  TossPricesResponseSchema,
  TossSellableQuantityResponseSchema,
  TossStockWarningsResponseSchema,
  TossStocksResponseSchema,
  TossUsMarketCalendarResponseSchema,
  getTossResponseAuditReference,
  getTossResponseMetadata,
  normalizeTossCommissions,
  normalizeTossKrMarketCalendar,
  normalizeTossOrderbook,
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

import { CollectionError } from "../../domain/collection.error";

export interface TossAccountReadReference {
  readonly accountSeq: number;
  readonly accountId: AccountId;
}

export interface TossNeutralReadResult<Value> extends BrokerReadResult<Value> {
  readonly redactedBody: unknown;
}

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

export interface TossReadSourceDependencies {
  readonly client?: Pick<TossOpenApiClient, "read">;
}

export function createTossReadSource(
  credentials: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly onResponseMetadata?: (
      metadata: TossResponseMetadata,
    ) => string | null | void | Promise<string | null | void>;
  },
  dependencies: TossReadSourceDependencies = {},
): TossReadSource {
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
        return TossAccountsResponseSchema.parse(response.data).result;
      } catch (error) {
        throw normalizeTossError(error, "계좌 목록");
      }
    },
    async getHoldings(accountSeq) {
      try {
        const response = await client.read.getHoldings({
          params: { header: { "X-Tossinvest-Account": accountSeq } },
        });
        return TossHoldingsResponseSchema.parse(response.data);
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
        return TossBuyingPowerResponseSchema.parse(response.data);
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
        const parsed = TossPricesResponseSchema.parse(response.data);
        return withBrokerMetadata(
          response.response,
          "getPrices",
          normalizeTossPrices(parsed, instruments),
          parsed,
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
        const parsed = TossOrderbookResponseSchema.parse(response.data);
        return withBrokerMetadata(
          response.response,
          "getOrderbook",
          normalizeTossOrderbook(parsed, instrument),
          parsed,
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
        const parsed = TossPriceLimitResponseSchema.parse(response.data);
        return withBrokerMetadata(
          response.response,
          "getPriceLimit",
          normalizeTossPriceLimit(parsed, instrument),
          parsed,
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
          const parsed = TossKrMarketCalendarResponseSchema.parse(response.data);
          return withBrokerMetadata(
            response.response,
            "getKrMarketCalendar",
            normalizeTossKrMarketCalendar(parsed),
            parsed,
          );
        }
        if (marketCountry === "US") {
          const response = await client.read.getUsMarketCalendar(
            date === undefined ? {} : { params: { query: { date } } },
          );
          const parsed = TossUsMarketCalendarResponseSchema.parse(response.data);
          return withBrokerMetadata(
            response.response,
            "getUsMarketCalendar",
            normalizeTossUsMarketCalendar(parsed),
            parsed,
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
        const parsed = TossSellableQuantityResponseSchema.parse(response.data);
        return withBrokerMetadata(
          response.response,
          "getSellableQuantity",
          normalizeTossSellableQuantity(parsed, account.accountId, instrument),
          parsed,
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
        const parsed = TossCommissionsResponseSchema.parse(response.data);
        return withBrokerMetadata(
          response.response,
          "getCommissions",
          normalizeTossCommissions(parsed, account.accountId, requestedMarkets),
          parsed,
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
        return TossExchangeRateResponseSchema.parse(response.data);
      } catch (error) {
        throw normalizeTossError(error, "원화 환율");
      }
    },
    async getStocks(symbols) {
      if (
        symbols.length === 0 ||
        symbols.length > 200 ||
        symbols.some((symbol) => !/^[A-Za-z0-9.-]+$/.test(symbol))
      ) {
        throw new CollectionError(
          "DATA_INVALID",
          "종목 심볼 조회 요청이 올바르지 않습니다.",
          "국내 종목코드 또는 미국 티커를 확인하세요.",
        );
      }
      try {
        const response = await client.read.getStocks({
          params: { query: { symbols: symbols.join(",") } },
        });
        return TossStocksResponseSchema.parse(response.data);
      } catch (error) {
        throw normalizeTossError(error, "종목 기본 정보");
      }
    },
    async getStockWarnings(symbol) {
      if (!/^[A-Za-z0-9.-]+$/.test(symbol)) {
        throw new CollectionError(
          "DATA_INVALID",
          "종목 유의사항 조회 심볼이 올바르지 않습니다.",
          "국내 종목코드 또는 미국 티커를 확인하세요.",
        );
      }
      try {
        const response = await client.read.getStockWarnings({
          params: { path: { symbol } },
        });
        return TossStockWarningsResponseSchema.parse(response.data);
      } catch (error) {
        throw normalizeTossError(error, "종목 유의사항");
      }
    },
  };
}

const TOSS_BROKER_ID = "toss" as BrokerId;

function withBrokerMetadata<Value>(
  response: Response,
  expectedOperationId: TossOperationId,
  value: Value,
  redactedBody: unknown,
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
