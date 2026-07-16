import type { Currency } from "@portfolio-rebalancer/domain";

import type {
  AccountId,
  BrokerAccount,
  BrokerConditionalOrderSummary,
  BrokerInstrument,
  BrokerOrderSummary,
  BrokerReadResult,
  BuyingPowerQuote,
  CommissionRateSchedule,
  HoldingPosition,
  InstrumentIdentifier,
  IsoDate,
  MarketCalendar,
  MarketCountry,
  OrderBookSnapshot,
  PriceLimitQuote,
  PriceQuote,
  SellableQuantityQuote,
} from "./models";

export interface AccountReader {
  listAccounts(): Promise<BrokerReadResult<readonly BrokerAccount[]>>;
}

export interface HoldingsReader {
  getHoldings(accountId: AccountId): Promise<BrokerReadResult<readonly HoldingPosition[]>>;
}

export interface QuoteReader {
  getQuotes(
    instruments: readonly InstrumentIdentifier[],
  ): Promise<BrokerReadResult<readonly PriceQuote[]>>;
}

export interface OrderBookReader {
  getOrderBook(instrument: InstrumentIdentifier): Promise<BrokerReadResult<OrderBookSnapshot>>;
}

export interface PriceLimitReader {
  getPriceLimit(instrument: InstrumentIdentifier): Promise<BrokerReadResult<PriceLimitQuote>>;
}

export interface InstrumentReader {
  getInstruments(
    instruments: readonly InstrumentIdentifier[],
  ): Promise<BrokerReadResult<readonly BrokerInstrument[]>>;
}

export interface MarketCalendarReader {
  getMarketCalendar(
    marketCountry: MarketCountry,
    date?: IsoDate,
  ): Promise<BrokerReadResult<MarketCalendar>>;
}

export interface OrderReader {
  listOpenOrders(accountId: AccountId): Promise<BrokerReadResult<readonly BrokerOrderSummary[]>>;
}

export interface ConditionalOrderReader {
  listConditionalOrders(
    accountId: AccountId,
  ): Promise<BrokerReadResult<readonly BrokerConditionalOrderSummary[]>>;
}

export interface BuyingPowerReader {
  getBuyingPower(
    accountId: AccountId,
    currency: Currency,
  ): Promise<BrokerReadResult<BuyingPowerQuote>>;
}

export interface SellableQuantityReader {
  getSellableQuantity(
    accountId: AccountId,
    instrument: InstrumentIdentifier,
  ): Promise<BrokerReadResult<SellableQuantityQuote>>;
}

export interface CommissionReader {
  getCommissionSchedule(accountId: AccountId): Promise<BrokerReadResult<CommissionRateSchedule>>;
}

export interface BrokerReadPorts {
  readonly accounts: AccountReader;
  readonly holdings: HoldingsReader;
  readonly quotes: QuoteReader;
  readonly orderBook: OrderBookReader;
  readonly priceLimits: PriceLimitReader;
  readonly instruments: InstrumentReader;
  readonly marketCalendar: MarketCalendarReader;
  readonly orders: OrderReader;
  readonly conditionalOrders: ConditionalOrderReader;
  readonly buyingPower: BuyingPowerReader;
  readonly sellableQuantity: SellableQuantityReader;
  readonly commissions: CommissionReader;
}
