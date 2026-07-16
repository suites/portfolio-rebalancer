import { z } from "zod";

const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonNegativeDecimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nullableDecimal = decimalString.nullable();

const priceByCurrency = z.object({
  krw: nullableDecimal,
  usd: nullableDecimal,
});

const marketValue = z.object({
  purchaseAmount: decimalString,
  amount: decimalString,
  amountAfterCost: decimalString,
});

const profitLoss = z.object({
  amount: decimalString,
  amountAfterCost: decimalString,
  rate: decimalString,
  rateAfterCost: decimalString,
});

const dailyProfitLoss = z.object({
  amount: decimalString,
  rate: decimalString,
});

export const TossAccountSchema = z.object({
  accountNo: z.string().min(1),
  accountSeq: z.number().int().safe(),
  accountType: z.string().min(1),
});

export const TossAccountsResponseSchema = z.object({
  result: z.array(TossAccountSchema),
});

export const TossHoldingItemSchema = z.object({
  symbol: z.string().min(1),
  name: z.string().min(1),
  marketCountry: z.string().min(1),
  currency: z.string().min(1),
  quantity: decimalString,
  lastPrice: decimalString,
  averagePurchasePrice: decimalString,
  marketValue,
  profitLoss,
  dailyProfitLoss,
  cost: z.object({
    commission: nullableDecimal,
    tax: nullableDecimal,
  }),
});

export const TossHoldingsResponseSchema = z.object({
  result: z.object({
    totalPurchaseAmount: priceByCurrency,
    marketValue: z.object({
      amount: priceByCurrency,
      amountAfterCost: priceByCurrency,
    }),
    profitLoss: z.object({
      amount: priceByCurrency,
      amountAfterCost: priceByCurrency,
      rate: decimalString,
      rateAfterCost: decimalString,
    }),
    dailyProfitLoss: z.object({
      amount: priceByCurrency,
      rate: decimalString,
    }),
    items: z.array(TossHoldingItemSchema),
  }),
});

export const TossExchangeRateResponseSchema = z.object({
  result: z.object({
    baseCurrency: z.string().min(1),
    quoteCurrency: z.string().min(1),
    rate: decimalString,
    midRate: decimalString,
    basisPoint: decimalString,
    rateChangeType: z.string().min(1),
    validFrom: z.iso.datetime({ offset: true }),
    validUntil: z.iso.datetime({ offset: true }),
  }),
});

export const TossBuyingPowerResponseSchema = z.object({
  result: z.object({
    currency: z.enum(["KRW", "USD"]),
    cashBuyingPower: nonNegativeDecimalString,
  }),
});

export const TossStockInfoSchema = z.object({
  symbol: z.string().regex(/^[A-Za-z0-9.-]+$/),
  name: z.string().min(1),
  englishName: z.string().min(1),
  isinCode: z.string().min(1),
  market: z.enum(["KOSPI", "KOSDAQ", "NYSE", "NASDAQ", "AMEX", "KR_ETC", "US_ETC"]),
  securityType: z.enum([
    "STOCK",
    "FOREIGN_STOCK",
    "DEPOSITARY_RECEIPT",
    "INFRASTRUCTURE_FUND",
    "REIT",
    "ETF",
    "FOREIGN_ETF",
    "ETN",
    "STOCK_WARRANTS",
  ]),
  isCommonShare: z.boolean(),
  status: z.enum(["SCHEDULED", "ACTIVE", "DELISTED"]),
  currency: z.enum(["KRW", "USD"]),
  listDate: z.iso.date().nullable().optional(),
  delistDate: z.iso.date().nullable().optional(),
  sharesOutstanding: nonNegativeDecimalString,
  leverageFactor: decimalString.nullable().optional(),
  koreanMarketDetail: z
    .object({
      liquidationTrading: z.boolean(),
      nxtSupported: z.boolean(),
      krxTradingSuspended: z.boolean(),
      nxtTradingSuspended: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const TossStocksResponseSchema = z.object({
  result: z.array(TossStockInfoSchema).max(200),
});

export const TossStockWarningSchema = z.object({
  warningType: z.string().min(1),
  exchange: z.string().min(1).nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
});

export const TossStockWarningsResponseSchema = z.object({
  result: z.array(TossStockWarningSchema),
});

export type TossAccount = z.infer<typeof TossAccountSchema>;
export type TossHoldingItem = z.infer<typeof TossHoldingItemSchema>;
export type TossHoldingsResponse = z.infer<typeof TossHoldingsResponseSchema>;
export type TossExchangeRateResponse = z.infer<typeof TossExchangeRateResponseSchema>;
export type TossBuyingPowerResponse = z.infer<typeof TossBuyingPowerResponseSchema>;
export type TossStockInfo = z.infer<typeof TossStockInfoSchema>;
export type TossStocksResponse = z.infer<typeof TossStocksResponseSchema>;
export type TossStockWarning = z.infer<typeof TossStockWarningSchema>;
export type TossStockWarningsResponse = z.infer<typeof TossStockWarningsResponseSchema>;
