import type { AccountId, CommissionRateSchedule, IsoDate } from "@portfolio-rebalancer/broker";
import { decimal } from "@portfolio-rebalancer/domain";
import { describe, expect, it } from "vitest";

import {
  COMMISSION_ESTIMATE_POLICY_VERSION,
  CommissionEstimateError,
  estimateCommission,
  type CommissionEstimateIssue,
} from "./commission";

describe("estimateCommission", () => {
  it("0.015를 0.015%로 해석하고 원 단위 수수료를 계산한다", () => {
    expect(
      estimateCommission({
        schedule: schedule([
          {
            marketCountry: "KR",
            commissionRatePercent: decimal("0.015"),
            startDate: null,
            endDate: null,
          },
        ]),
        marketCountry: "KR",
        tradeDate: "2026-07-16" as IsoDate,
        notionalMinor: 100_000n,
      }),
    ).toEqual({
      policyVersion: COMMISSION_ESTIMATE_POLICY_VERSION,
      marketCountry: "KR",
      tradeDate: "2026-07-16",
      notionalMinor: 100_000n,
      commissionRatePercent: "0.015",
      commissionMinor: 15n,
      taxIncluded: false,
    });
  });

  it("minor unit보다 작은 양수 수수료를 보수적으로 올림한다", () => {
    expect(
      estimateCommission({
        schedule: schedule([
          {
            marketCountry: "KR",
            commissionRatePercent: decimal("0.015"),
            startDate: null,
            endDate: null,
          },
        ]),
        marketCountry: "KR",
        tradeDate: "2026-07-16" as IsoDate,
        notionalMinor: 1n,
      }).commissionMinor,
    ).toBe(1n);
  });

  it("거래일에 적용되는 기간 하나만 선택한다", () => {
    const value = estimateCommission({
      schedule: schedule([
        {
          marketCountry: "KR",
          commissionRatePercent: decimal("0.015"),
          startDate: "2026-01-01" as IsoDate,
          endDate: "2026-06-30" as IsoDate,
        },
        {
          marketCountry: "KR",
          commissionRatePercent: decimal("0.010"),
          startDate: "2026-07-01" as IsoDate,
          endDate: null,
        },
      ]),
      marketCountry: "KR",
      tradeDate: "2026-07-16" as IsoDate,
      notionalMinor: 100_000n,
    });

    expect(value.commissionRatePercent).toBe("0.010");
    expect(value.commissionMinor).toBe(10n);
  });

  it("수수료율 누락·중복과 비정상 날짜를 fail closed 한다", () => {
    expectIssue(
      () =>
        estimateCommission({
          schedule: schedule([]),
          marketCountry: "KR",
          tradeDate: "2026-07-16" as IsoDate,
          notionalMinor: 1n,
        }),
      "COMMISSION_RATE_MISSING",
    );
    expectIssue(
      () =>
        estimateCommission({
          schedule: schedule([
            {
              marketCountry: "KR",
              commissionRatePercent: decimal("0.015"),
              startDate: null,
              endDate: null,
            },
            {
              marketCountry: "KR",
              commissionRatePercent: decimal("0.010"),
              startDate: null,
              endDate: null,
            },
          ]),
          marketCountry: "KR",
          tradeDate: "2026-07-16" as IsoDate,
          notionalMinor: 1n,
        }),
      "COMMISSION_RATE_AMBIGUOUS",
    );
    expectIssue(
      () =>
        estimateCommission({
          schedule: schedule([]),
          marketCountry: "KR",
          tradeDate: "2026-02-30" as IsoDate,
          notionalMinor: 1n,
        }),
      "TRADE_DATE_INVALID",
    );
  });
});

function schedule(periods: CommissionRateSchedule["periods"]): CommissionRateSchedule {
  return {
    accountId: "account-1" as AccountId,
    periods,
  };
}

function expectIssue(action: () => unknown, issue: CommissionEstimateIssue): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CommissionEstimateError);
    expect((error as CommissionEstimateError).issue).toBe(issue);
    return;
  }
  throw new Error(`예상한 수수료 차단 오류가 발생하지 않았습니다: ${issue}`);
}
