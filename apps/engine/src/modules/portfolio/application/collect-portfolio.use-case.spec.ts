import { describe, expect, it, vi } from "vitest";

import type { CollectionError } from "../domain/collection.error";
import {
  collectPortfolio,
  createAccountReference,
  maskAccountNumber,
} from "./collect-portfolio.use-case";

describe("collectPortfolio", () => {
  it("여러 계좌를 임의 선택하지 않고 보유 조회 전에 차단한다", async () => {
    const source = {
      listAccounts: vi.fn().mockResolvedValue([
        { accountNo: "12345678901", accountSeq: 1, accountType: "BROKERAGE" },
        { accountNo: "98765432109", accountSeq: 2, accountType: "BROKERAGE" },
      ]),
      getHoldings: vi.fn(),
      getUsdKrwRate: vi.fn(),
    };
    const repository = {
      acquireCollectionLease: vi.fn().mockResolvedValue(true),
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
    expect(repository.releaseCollectionLease).toHaveBeenCalledOnce();
  });

  it("계좌번호는 마스킹하고 HMAC 참조만 만든다", () => {
    expect(maskAccountNumber("12345678901")).toBe("**** 8901");
    const reference = createAccountReference("12345678901", "a".repeat(32));
    expect(reference).toMatch(/^[a-f0-9]{64}$/);
    expect(reference).not.toContain("12345678901");
  });
});
