import { describe, expect, it, vi } from "vitest";

import type { CollectionError } from "../domain/collection.error";
import {
  collectPortfolio,
  createAccountReference,
  maskAccountNumber,
} from "./collect-portfolio.use-case";

const collectionLease = {
  owner: "11111111-1111-4111-8111-111111111111",
  fencingToken: 1n,
};

describe("collectPortfolio", () => {
  it("여러 계좌를 임의 선택하지 않고 보유 조회 전에 차단한다", async () => {
    const source = {
      listAccounts: vi.fn().mockResolvedValue([
        { accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" },
        { accountNo: "98765432109", accountSeq: 2, accountType: "BROKERAGE" },
      ]),
      getHoldings: vi.fn(),
      getBuyingPower: vi.fn(),
      getUsdKrwRate: vi.fn(),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      collectPortfolio({
        source,
        repository: repository as never,
        accountReferenceKey: "a".repeat(32),
      }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_SELECTION_REQUIRED",
    } satisfies Partial<CollectionError>);
    expect(source.getHoldings).not.toHaveBeenCalled();
    expect(repository.releaseCollectionLease).toHaveBeenCalledWith(collectionLease);
  });

  it("보유자산 운용 통화의 매수 가능 금액을 관리 현금과 분리해 저장한다", async () => {
    const source = {
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getHoldings: vi.fn().mockResolvedValue(emptyHoldingsResponse()),
      getBuyingPower: vi.fn((_: number, currency: "KRW" | "USD") =>
        Promise.resolve({
          result: {
            currency,
            cashBuyingPower: currency === "KRW" ? "5000000" : "0",
          },
        }),
      ),
      getUsdKrwRate: vi.fn(),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const completeCollection = vi.fn().mockResolvedValue(true);
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      heartbeatCollectionLease: vi.fn().mockResolvedValue(true),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
      upsertAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
      startCollection: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeCollection,
      failCollection: vi.fn(),
    };

    await collectPortfolio({
      source,
      repository: repository as never,
      accountReferenceKey: "a".repeat(32),
      now: () => new Date("2026-07-16T09:00:00+09:00"),
    });

    expect(source.getBuyingPower).toHaveBeenCalledOnce();
    expect(source.getBuyingPower).toHaveBeenCalledWith(1, "KRW");
    expect(source.getUsdKrwRate).not.toHaveBeenCalled();
    expect(repository.heartbeatCollectionLease).toHaveBeenCalledTimes(2);
    const stored = completeCollection.mock.calls[0]?.[0] as
      | {
          securitiesValueMinor: bigint;
          buyingPower: readonly {
            currency: string;
            amount: string;
            valueKrwMinor: bigint;
          }[];
          rawResponses: readonly { operationId: string; ordinal: number }[];
        }
      | undefined;
    expect(stored?.securitiesValueMinor).toBe(0n);
    expect(stored?.buyingPower).toEqual([
      { currency: "KRW", amount: "5000000", valueKrwMinor: 5_000_000n },
    ]);
    expect(
      stored?.rawResponses.some(
        ({ operationId, ordinal }) => operationId === "getBuyingPower" && ordinal === 0,
      ),
    ).toBe(true);
  });

  it("USD 매수 가능 금액이 있으면 환율로 원화 증거 금액을 계산한다", async () => {
    const source = {
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getHoldings: vi.fn().mockResolvedValue(usdHoldingsResponse()),
      getBuyingPower: vi.fn((_: number, currency: "KRW" | "USD") =>
        Promise.resolve({
          result: {
            currency,
            cashBuyingPower: currency === "KRW" ? "0" : "10.5",
          },
        }),
      ),
      getUsdKrwRate: vi.fn().mockResolvedValue({
        result: {
          baseCurrency: "USD",
          quoteCurrency: "KRW",
          rate: "1380",
          midRate: "1380",
          basisPoint: "0",
          rateChangeType: "UNCHANGED",
          validFrom: "2026-07-16T08:59:00+09:00",
          validUntil: "2026-07-16T09:01:00+09:00",
        },
      }),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const completeCollection = vi.fn().mockResolvedValue(true);
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      heartbeatCollectionLease: vi.fn().mockResolvedValue(true),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
      upsertAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
      startCollection: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeCollection,
      failCollection: vi.fn(),
    };

    await collectPortfolio({
      source,
      repository: repository as never,
      accountReferenceKey: "a".repeat(32),
    });

    const stored = completeCollection.mock.calls[0]?.[0] as
      | {
          securitiesValueMinor: bigint;
          buyingPower: readonly {
            currency: string;
            amount: string;
            valueKrwMinor: bigint;
          }[];
        }
      | undefined;
    expect(stored?.securitiesValueMinor).toBe(1_380n);
    expect(stored?.buyingPower).toContainEqual({
      currency: "USD",
      amount: "10.5",
      valueKrwMinor: 14_490n,
    });
  });

  it("요청 통화와 다른 매수 가능 금액 응답은 저장하지 않고 차단한다", async () => {
    const source = {
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getHoldings: vi.fn().mockResolvedValue(emptyHoldingsResponse()),
      getBuyingPower: vi.fn((_: number, _currency: "KRW" | "USD") =>
        Promise.resolve({
          result: {
            currency: "USD" as const,
            cashBuyingPower: "0",
          },
        }),
      ),
      getUsdKrwRate: vi.fn(),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const completeCollection = vi.fn();
    const failCollection = vi.fn().mockResolvedValue(undefined);
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      heartbeatCollectionLease: vi.fn().mockResolvedValue(true),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
      upsertAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
      startCollection: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeCollection,
      failCollection,
    };

    await expect(
      collectPortfolio({
        source,
        repository: repository as never,
        accountReferenceKey: "a".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "DATA_INVALID" });
    expect(completeCollection).not.toHaveBeenCalled();
    expect(failCollection).toHaveBeenCalledWith("run-1", "DATA_INVALID", expect.any(Date));
  });

  it("heartbeat에서 fencing 소유권을 잃으면 계좌나 스냅샷을 저장하지 않는다", async () => {
    const source = {
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getHoldings: vi.fn(),
      getBuyingPower: vi.fn(),
      getUsdKrwRate: vi.fn(),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      heartbeatCollectionLease: vi.fn().mockResolvedValue(false),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
      upsertAccount: vi.fn(),
      completeCollection: vi.fn(),
    };

    await expect(
      collectPortfolio({
        source,
        repository: repository as never,
        accountReferenceKey: "a".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "COLLECTION_LEASE_LOST" });
    expect(repository.upsertAccount).not.toHaveBeenCalled();
    expect(source.getHoldings).not.toHaveBeenCalled();
    expect(repository.completeCollection).not.toHaveBeenCalled();
    expect(repository.releaseCollectionLease).toHaveBeenCalledWith(collectionLease);
  });

  it("최종 저장 직전 fencing 검증이 실패하면 실행을 실패로 기록한다", async () => {
    const source = {
      listAccounts: vi
        .fn()
        .mockResolvedValue([{ accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" }]),
      getHoldings: vi.fn().mockResolvedValue(emptyHoldingsResponse()),
      getBuyingPower: vi.fn().mockResolvedValue({
        result: { currency: "KRW" as const, cashBuyingPower: "0" },
      }),
      getUsdKrwRate: vi.fn(),
      getStocks: vi.fn(),
      getStockWarnings: vi.fn(),
    };
    const failCollection = vi.fn().mockResolvedValue(undefined);
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(collectionLease),
      heartbeatCollectionLease: vi.fn().mockResolvedValue(true),
      releaseCollectionLease: vi.fn().mockResolvedValue(undefined),
      upsertAccount: vi.fn().mockResolvedValue({ id: "account-1" }),
      startCollection: vi.fn().mockResolvedValue({ id: "run-1" }),
      completeCollection: vi.fn().mockResolvedValue(false),
      failCollection,
    };

    await expect(
      collectPortfolio({
        source,
        repository: repository as never,
        accountReferenceKey: "a".repeat(32),
      }),
    ).rejects.toMatchObject({ code: "COLLECTION_LEASE_LOST" });
    expect(failCollection).toHaveBeenCalledWith("run-1", "COLLECTION_LEASE_LOST", expect.any(Date));
    expect(repository.releaseCollectionLease).toHaveBeenCalledWith(collectionLease);
  });

  it("계좌번호는 마스킹하고 HMAC 참조만 만든다", () => {
    expect(maskAccountNumber("12345678901")).toBe("**** 8901");
    const reference = createAccountReference("12345678901", "a".repeat(32));
    expect(reference).toMatch(/^[a-f0-9]{64}$/);
    expect(reference).not.toContain("12345678901");
  });
});

function emptyHoldingsResponse() {
  const zeroByCurrency = { krw: "0", usd: "0" };
  return {
    result: {
      totalPurchaseAmount: zeroByCurrency,
      marketValue: {
        amount: zeroByCurrency,
        amountAfterCost: zeroByCurrency,
      },
      profitLoss: {
        amount: zeroByCurrency,
        amountAfterCost: zeroByCurrency,
        rate: "0",
        rateAfterCost: "0",
      },
      dailyProfitLoss: {
        amount: zeroByCurrency,
        rate: "0",
      },
      items: [],
    },
  };
}

function usdHoldingsResponse() {
  const response = emptyHoldingsResponse();
  return {
    result: {
      ...response.result,
      items: [
        {
          symbol: "AAPL",
          name: "Apple",
          marketCountry: "US",
          currency: "USD",
          quantity: "1",
          lastPrice: "1",
          averagePurchasePrice: "1",
          marketValue: {
            purchaseAmount: "1",
            amount: "1",
            amountAfterCost: "1",
          },
          profitLoss: {
            amount: "0",
            amountAfterCost: "0",
            rate: "0",
            rateAfterCost: "0",
          },
          dailyProfitLoss: {
            amount: "0",
            rate: "0",
          },
          cost: {
            commission: "0",
            tax: "0",
          },
        },
      ],
    },
  };
}
