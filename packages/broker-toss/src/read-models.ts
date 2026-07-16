import { z } from "zod";

const decimalString = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
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

export type TossAccount = z.infer<typeof TossAccountSchema>;
export type TossHoldingItem = z.infer<typeof TossHoldingItemSchema>;
export type TossHoldingsResponse = z.infer<typeof TossHoldingsResponseSchema>;
export type TossExchangeRateResponse = z.infer<typeof TossExchangeRateResponseSchema>;
