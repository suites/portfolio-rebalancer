import {
  TossAccountsResponseSchema,
  TossBuyingPowerResponseSchema,
  TossExchangeRateResponseSchema,
  TossHoldingsResponseSchema,
  TossOpenApiClient,
  TossStockWarningsResponseSchema,
  TossStocksResponseSchema,
  type TossAccount,
  type TossBuyingPowerResponse,
  type TossExchangeRateResponse,
  type TossHoldingsResponse,
  type TossStockWarningsResponse,
  type TossStocksResponse,
} from "@portfolio-rebalancer/broker-toss";

import { CollectionError } from "../../domain/collection.error";

export interface TossReadSource {
  listAccounts(): Promise<readonly TossAccount[]>;
  getHoldings(accountSeq: number): Promise<TossHoldingsResponse>;
  getBuyingPower(accountSeq: number, currency: "KRW" | "USD"): Promise<TossBuyingPowerResponse>;
  getUsdKrwRate(): Promise<TossExchangeRateResponse>;
  getStocks(symbols: readonly string[]): Promise<TossStocksResponse>;
  getStockWarnings(symbol: string): Promise<TossStockWarningsResponse>;
}

export function createTossReadSource(credentials: {
  readonly clientId: string;
  readonly clientSecret: string;
}): TossReadSource {
  const client = new TossOpenApiClient(credentials);
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

function normalizeTossError(error: unknown, subject: string): CollectionError {
  if (error instanceof CollectionError) return error;
  return new CollectionError(
    "BROKER_FETCH_FAILED",
    `토스증권 ${subject} 데이터를 확인하지 못했습니다.`,
    "자격증명, 허용 IP와 토스증권 API 상태를 확인한 뒤 다시 수집하세요.",
    { cause: error },
  );
}
