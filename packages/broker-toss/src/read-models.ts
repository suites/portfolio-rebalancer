import { z } from "zod";

const decimalString = z
  .string()
  .max(30)
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nonNegativeDecimalString = z
  .string()
  .max(30)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const nullableDecimal = decimalString.nullable();
const isoOffsetDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const currency = z.enum(["KRW", "USD"]);
const marketCountry = z.enum(["KR", "US"]);
const symbol = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9.-]+$/);

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
    validFrom: isoOffsetDateTime,
    validUntil: isoOffsetDateTime,
  }),
});

export const TossBuyingPowerResponseSchema = z.object({
  result: z.object({
    currency,
    cashBuyingPower: nonNegativeDecimalString,
  }),
});

export const TossPriceSchema = z.object({
  symbol,
  timestamp: isoOffsetDateTime.nullable().optional(),
  lastPrice: decimalString,
  currency,
});

export const TossPricesResponseSchema = z.object({
  result: z.array(TossPriceSchema).max(200),
});

export const TossOrderbookEntrySchema = z.object({
  price: decimalString,
  volume: decimalString,
});

export const TossOrderbookResponseSchema = z.object({
  result: z.object({
    timestamp: isoOffsetDateTime.nullable().optional(),
    currency,
    asks: z.array(TossOrderbookEntrySchema),
    bids: z.array(TossOrderbookEntrySchema),
  }),
});

export const TossPriceLimitResponseSchema = z.object({
  result: z.object({
    timestamp: isoOffsetDateTime,
    upperLimitPrice: decimalString.nullable().optional(),
    lowerLimitPrice: decimalString.nullable().optional(),
    currency,
  }),
});

const tossSessionIntervalSchema = z.object({
  startTime: isoOffsetDateTime,
  endTime: isoOffsetDateTime,
});

export const TossKrPreMarketSessionSchema = tossSessionIntervalSchema.extend({
  singlePriceAuctionStartTime: isoOffsetDateTime.nullable().optional(),
});

export const TossKrRegularMarketSessionSchema = tossSessionIntervalSchema.extend({
  singlePriceAuctionStartTime: isoOffsetDateTime.nullable().optional(),
});

export const TossKrAfterMarketSessionSchema = tossSessionIntervalSchema.extend({
  singlePriceAuctionEndTime: isoOffsetDateTime.nullable().optional(),
});

export const TossKrMarketDaySchema = z.object({
  date: isoDate,
  integrated: z
    .object({
      preMarket: TossKrPreMarketSessionSchema.nullable().optional(),
      regularMarket: TossKrRegularMarketSessionSchema.nullable().optional(),
      afterMarket: TossKrAfterMarketSessionSchema.nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const TossKrMarketCalendarResponseSchema = z.object({
  result: z.object({
    today: TossKrMarketDaySchema,
    previousBusinessDay: TossKrMarketDaySchema,
    nextBusinessDay: TossKrMarketDaySchema,
  }),
});

export const TossUsMarketSessionSchema = tossSessionIntervalSchema;

export const TossUsMarketDaySchema = z.object({
  date: isoDate,
  dayMarket: TossUsMarketSessionSchema.nullable().optional(),
  preMarket: TossUsMarketSessionSchema.nullable().optional(),
  regularMarket: TossUsMarketSessionSchema.nullable().optional(),
  afterMarket: TossUsMarketSessionSchema.nullable().optional(),
});

export const TossUsMarketCalendarResponseSchema = z.object({
  result: z.object({
    today: TossUsMarketDaySchema,
    previousBusinessDay: TossUsMarketDaySchema,
    nextBusinessDay: TossUsMarketDaySchema,
  }),
});

export const TossSellableQuantityResponseSchema = z.object({
  result: z.object({
    sellableQuantity: decimalString,
  }),
});

export const TossCommissionSchema = z.object({
  marketCountry,
  commissionRate: decimalString,
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
});

export const TossCommissionsResponseSchema = z.object({
  result: z.array(TossCommissionSchema),
});

export const TossStockInfoSchema = z.object({
  symbol,
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
  listDate: isoDate.nullable().optional(),
  delistDate: isoDate.nullable().optional(),
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
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
});

export const TossStockWarningsResponseSchema = z.object({
  result: z.array(TossStockWarningSchema),
});

export type TossAccount = z.infer<typeof TossAccountSchema>;
export type TossHoldingItem = z.infer<typeof TossHoldingItemSchema>;
export type TossHoldingsResponse = z.infer<typeof TossHoldingsResponseSchema>;
export type TossExchangeRateResponse = z.infer<typeof TossExchangeRateResponseSchema>;
export type TossBuyingPowerResponse = z.infer<typeof TossBuyingPowerResponseSchema>;
export type TossPrice = z.infer<typeof TossPriceSchema>;
export type TossPricesResponse = z.infer<typeof TossPricesResponseSchema>;
export type TossOrderbookEntry = z.infer<typeof TossOrderbookEntrySchema>;
export type TossOrderbookResponse = z.infer<typeof TossOrderbookResponseSchema>;
export type TossPriceLimitResponse = z.infer<typeof TossPriceLimitResponseSchema>;
export type TossKrPreMarketSession = z.infer<typeof TossKrPreMarketSessionSchema>;
export type TossKrRegularMarketSession = z.infer<typeof TossKrRegularMarketSessionSchema>;
export type TossKrAfterMarketSession = z.infer<typeof TossKrAfterMarketSessionSchema>;
export type TossKrMarketDay = z.infer<typeof TossKrMarketDaySchema>;
export type TossKrMarketCalendarResponse = z.infer<typeof TossKrMarketCalendarResponseSchema>;
export type TossUsMarketSession = z.infer<typeof TossUsMarketSessionSchema>;
export type TossUsMarketDay = z.infer<typeof TossUsMarketDaySchema>;
export type TossUsMarketCalendarResponse = z.infer<typeof TossUsMarketCalendarResponseSchema>;
export type TossSellableQuantityResponse = z.infer<typeof TossSellableQuantityResponseSchema>;
export type TossCommission = z.infer<typeof TossCommissionSchema>;
export type TossCommissionsResponse = z.infer<typeof TossCommissionsResponseSchema>;
export type TossStockInfo = z.infer<typeof TossStockInfoSchema>;
export type TossStocksResponse = z.infer<typeof TossStocksResponseSchema>;
export type TossStockWarning = z.infer<typeof TossStockWarningSchema>;
export type TossStockWarningsResponse = z.infer<typeof TossStockWarningsResponseSchema>;
