import { createHmac, randomUUID } from "node:crypto";

import {
  TOSS_OPENAPI_VERSION,
  type TossAccount,
  type TossHoldingItem,
} from "@portfolio-rebalancer/broker-toss";

import type {
  CollectionLease,
  PrismaPortfolioRepository,
  StoredBuyingPowerInput,
  StoredHoldingInput,
} from "../infrastructure/persistence/prisma-portfolio.repository";
import type { TossReadSource } from "../infrastructure/broker/toss-read-source.adapter";
import { CollectionError } from "../domain/collection.error";
import { krwAmountToMinor, usdAmountToKrwMinor } from "../domain/valuation";

export interface CollectPortfolioOptions {
  readonly source: TossReadSource;
  readonly repository: PrismaPortfolioRepository;
  readonly selectedAccountSeq?: number | undefined;
  readonly accountReferenceKey: string;
  readonly now?: () => Date;
}

export async function collectPortfolio(options: CollectPortfolioOptions): Promise<void> {
  const leaseOwner = randomUUID();
  const lease = await options.repository.acquireCollectionLease(leaseOwner);
  if (!lease) {
    throw new CollectionError(
      "COLLECTION_IN_PROGRESS",
      "다른 토스증권 데이터 수집이 이미 진행 중입니다.",
      "기존 수집이 끝난 뒤 저장된 최신 스냅샷을 확인하세요.",
    );
  }
  try {
    const observedAt = (options.now ?? (() => new Date()))();
    const accounts = await options.source.listAccounts();
    const selected = selectAccount(accounts, options.selectedAccountSeq);
    await assertCollectionLease(options.repository, lease);
    const account = await options.repository.upsertAccount({
      externalRefHmac: createAccountReference(selected.accountNo, options.accountReferenceKey),
      maskedNumber: maskAccountNumber(selected.accountNo),
      accountTypeRaw: selected.accountType,
      seenAt: observedAt,
    });
    const run = await options.repository.startCollection(
      account.id,
      observedAt,
      TOSS_OPENAPI_VERSION,
    );

    try {
      const holdingsResponse = await options.source.getHoldings(selected.accountSeq);
      const hasUsd = holdingsResponse.result.items.some(({ currency }) => currency === "USD");
      const buyingPowerCurrencies: readonly ("KRW" | "USD")[] = hasUsd ? ["KRW", "USD"] : ["KRW"];
      const buyingPowerResponses = await Promise.all(
        buyingPowerCurrencies.map(async (currency) => {
          const response = await options.source.getBuyingPower(selected.accountSeq, currency);
          validateBuyingPowerCurrency(response.result.currency, currency);
          return response;
        }),
      );
      const exchangeResponse = hasUsd ? await options.source.getUsdKrwRate() : null;
      if (
        exchangeResponse &&
        (exchangeResponse.result.baseCurrency !== "USD" ||
          exchangeResponse.result.quoteCurrency !== "KRW")
      ) {
        throw new CollectionError(
          "DATA_INVALID",
          "USD/KRW 환율 응답의 통화 방향이 올바르지 않습니다.",
          "토스증권 환율 응답을 확인한 뒤 다시 수집하세요.",
        );
      }

      const holdings = holdingsResponse.result.items.map((item) =>
        normalizeHolding(item, exchangeResponse?.result.rate),
      );
      const securitiesValueMinor = holdings.reduce(
        (total, holding) => total + holding.marketValueKrwMinor,
        0n,
      );
      const buyingPower: readonly StoredBuyingPowerInput[] = buyingPowerResponses.map(
        ({ result }) => {
          if (result.currency === "KRW") {
            return {
              currency: result.currency,
              amount: result.cashBuyingPower,
              valueKrwMinor: krwAmountToMinor(result.cashBuyingPower),
            };
          }
          if (!exchangeResponse) {
            throw new CollectionError(
              "DATA_INVALID",
              "USD 매수 가능 금액이 있지만 USD/KRW 환율을 확인하지 못했습니다.",
              "환율 API 상태를 확인한 뒤 다시 수집하세요.",
            );
          }
          return {
            currency: result.currency,
            amount: result.cashBuyingPower,
            valueKrwMinor: usdAmountToKrwMinor(
              result.cashBuyingPower,
              exchangeResponse.result.rate,
            ),
          };
        },
      );
      await assertCollectionLease(options.repository, lease);
      const completed = await options.repository.completeCollection({
        runId: run.id,
        accountId: account.id,
        observedAt,
        securitiesValueMinor,
        usdKrwRate: exchangeResponse?.result.rate ?? null,
        holdings,
        buyingPower,
        lease,
        rawResponses: [
          {
            operationId: "getAccounts",
            ordinal: 0,
            receivedAt: observedAt,
            body: {
              result: accounts.map((item) => ({
                accountNo: maskAccountNumber(item.accountNo),
                accountSeq: "[REDACTED]",
                accountType: item.accountType,
              })),
            },
          },
          {
            operationId: "getHoldings",
            ordinal: 0,
            receivedAt: observedAt,
            body: holdingsResponse,
          },
          ...buyingPowerResponses.map((response, ordinal) => ({
            operationId: "getBuyingPower",
            ordinal,
            receivedAt: observedAt,
            body: response,
          })),
          ...(exchangeResponse
            ? [
                {
                  operationId: "getExchangeRate",
                  ordinal: 0,
                  receivedAt: observedAt,
                  body: exchangeResponse,
                },
              ]
            : []),
        ],
      });
      if (!completed) throw collectionLeaseLost();
    } catch (error) {
      const collectionError =
        error instanceof CollectionError
          ? error
          : new CollectionError(
              "DATA_INVALID",
              "수집한 토스증권 데이터를 안전하게 저장하지 못했습니다.",
              "응답 데이터와 PostgreSQL 상태를 확인한 뒤 다시 수집하세요.",
              { cause: error },
            );
      await options.repository.failCollection(run.id, collectionError.code, new Date());
      throw collectionError;
    }
  } finally {
    await options.repository.releaseCollectionLease(lease);
  }
}

async function assertCollectionLease(
  repository: PrismaPortfolioRepository,
  lease: CollectionLease,
): Promise<void> {
  if (!(await repository.heartbeatCollectionLease(lease))) throw collectionLeaseLost();
}

function collectionLeaseLost(): CollectionError {
  return new CollectionError(
    "COLLECTION_LEASE_LOST",
    "수집 도중 실행 소유권을 잃어 새 스냅샷을 저장하지 않았습니다.",
    "진행 중인 수집이 끝난 뒤 최신 상태를 다시 확인하세요.",
  );
}

function validateBuyingPowerCurrency(actual: string, expected: "KRW" | "USD"): void {
  if (actual !== expected) {
    throw new CollectionError(
      "DATA_INVALID",
      `${expected} 매수 가능 금액 응답의 통화가 일치하지 않습니다.`,
      "토스증권 매수 가능 금액 응답을 확인한 뒤 다시 수집하세요.",
    );
  }
}

function selectAccount(
  accounts: readonly TossAccount[],
  selectedAccountSeq: number | undefined,
): TossAccount {
  if (accounts.length === 0) {
    throw new CollectionError(
      "EMPTY_ACCOUNT",
      "토스증권에서 사용할 수 있는 계좌를 찾지 못했습니다.",
      "토스증권 앱에서 계좌 상태와 Open API 사용 가능 여부를 확인하세요.",
    );
  }
  if (selectedAccountSeq !== undefined) {
    const selected = accounts.find(({ accountSeq }) => accountSeq === selectedAccountSeq);
    if (!selected) {
      throw new CollectionError(
        "ACCOUNT_NOT_FOUND",
        "선택한 토스증권 계좌를 계좌 목록에서 찾지 못했습니다.",
        "TOSSINVEST_ACCOUNT_SEQ를 현재 계좌의 accountSeq로 수정하세요.",
      );
    }
    return selected;
  }
  if (accounts.length > 1) {
    throw new CollectionError(
      "ACCOUNT_SELECTION_REQUIRED",
      "사용 가능한 토스증권 계좌가 여러 개라 자동으로 선택하지 않았습니다.",
      "TOSSINVEST_ACCOUNT_SEQ에 사용할 계좌의 accountSeq를 설정하세요.",
    );
  }
  return accounts[0] as TossAccount;
}

function normalizeHolding(
  item: TossHoldingItem,
  usdKrwRate: string | undefined,
): StoredHoldingInput {
  if (item.marketCountry !== "KR" && item.marketCountry !== "US") {
    throw unsupportedHolding(item, "시장");
  }
  if (item.currency !== "KRW" && item.currency !== "USD") {
    throw unsupportedHolding(item, "통화");
  }
  if (item.marketCountry === "KR" && item.currency !== "KRW") {
    throw unsupportedHolding(item, "시장과 통화 조합");
  }
  if (item.marketCountry === "US" && item.currency !== "USD") {
    throw unsupportedHolding(item, "시장과 통화 조합");
  }
  if (item.currency === "USD" && !usdKrwRate) {
    throw new CollectionError(
      "DATA_INVALID",
      "미국 주식이 있지만 USD/KRW 환율을 확인하지 못했습니다.",
      "환율 API 상태를 확인한 뒤 다시 수집하세요.",
    );
  }

  const marketValueKrwMinor =
    item.currency === "KRW"
      ? krwAmountToMinor(item.marketValue.amount)
      : usdAmountToKrwMinor(item.marketValue.amount, usdKrwRate as string);
  return {
    marketCountry: item.marketCountry,
    symbol: item.symbol,
    name: item.name,
    currency: item.currency,
    quantity: item.quantity,
    lastPrice: item.lastPrice,
    averagePurchasePrice: item.averagePurchasePrice,
    marketValue: item.marketValue.amount,
    marketValueKrwMinor,
    rawPayload: item,
  };
}

function unsupportedHolding(item: TossHoldingItem, subject: string): CollectionError {
  return new CollectionError(
    "DATA_INVALID",
    `${item.symbol} 보유자산의 ${subject}을 안전하게 해석할 수 없습니다.`,
    "지원 시장과 통화 설정을 확인한 뒤 다시 수집하세요.",
  );
}

export function maskAccountNumber(accountNo: string): string {
  const visible = accountNo.slice(-4);
  return `**** ${visible}`;
}

export function createAccountReference(accountNo: string, key: string): string {
  return createHmac("sha256", key).update(`toss-account-v1:${accountNo}`).digest("hex");
}
