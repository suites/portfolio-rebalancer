import { describe, expect, it, vi } from "vitest";

import type { PrismaPortfolioRepository } from "../infrastructure/persistence/prisma-portfolio.repository";
import { getConsoleRecords } from "./console.presenter";

describe("getConsoleRecords", () => {
  it("첫 snapshot 전에 실패한 현재 계좌 수집 기록도 숨기지 않는다", async () => {
    const repository = {
      latestCollectionAccountId: vi.fn().mockResolvedValue("account-1"),
      recentCollectionRecords: vi.fn().mockResolvedValue([
        {
          id: "77777777-7777-4777-8777-777777777777",
          status: "FAILED",
          startedAt: new Date("2026-07-16T03:00:00.000Z"),
          completedAt: new Date("2026-07-16T03:00:01.000Z"),
          errorCode: "BROKER_FETCH_FAILED",
          snapshot: null,
        },
      ]),
    } as unknown as PrismaPortfolioRepository;

    const result = await getConsoleRecords(repository);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      status: "FAILED",
      errorCode: "BROKER_FETCH_FAILED",
      observedAt: null,
    });
  });
});
