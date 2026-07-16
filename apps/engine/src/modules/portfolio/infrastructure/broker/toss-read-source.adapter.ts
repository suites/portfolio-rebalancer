import {
  TossAccountsResponseSchema,
  TossBuyingPowerResponseSchema,
  TossExchangeRateResponseSchema,
  TossHoldingsResponseSchema,
  TossOpenApiClient,
  type TossAccount,
  type TossBuyingPowerResponse,
  type TossExchangeRateResponse,
  type TossHoldingsResponse,
} from "@portfolio-rebalancer/broker-toss";

import { CollectionError } from "../../domain/collection.error";

export interface TossReadSource {
  listAccounts(): Promise<readonly TossAccount[]>;
  getHoldings(accountSeq: number): Promise<TossHoldingsResponse>;
  getBuyingPower(accountSeq: number, currency: "KRW" | "USD"): Promise<TossBuyingPowerResponse>;
  getUsdKrwRate(): Promise<TossExchangeRateResponse>;
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
