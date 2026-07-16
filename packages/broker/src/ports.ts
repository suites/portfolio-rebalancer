import type {
  AccountId,
  BrokerConditionalOrderSummary,
  BrokerAccount,
  BrokerInstrument,
  BrokerOrderSummary,
  BuyingPowerQuote,
  CommissionQuote,
  HoldingPosition,
  MarketSession,
  OrderBookSnapshot,
  PriceQuote,
  SellableQuantityQuote,
  SymbolCode,
} from "./models";
import type { Currency } from "@portfolio-rebalancer/domain";

export interface AccountReader {
  listAccounts(): Promise<readonly BrokerAccount[]>;
}

export interface HoldingsReader {
  getHoldings(accountId: AccountId): Promise<readonly HoldingPosition[]>;
}

export interface QuoteReader {
  getQuotes(symbols: readonly SymbolCode[]): Promise<readonly PriceQuote[]>;
}

export interface OrderBookReader {
  getOrderBook(symbol: SymbolCode): Promise<OrderBookSnapshot>;
}

export interface InstrumentReader {
  getInstruments(symbols: readonly SymbolCode[]): Promise<readonly BrokerInstrument[]>;
}

export interface MarketCalendarReader {
  getMarketSession(marketCountry: "KR" | "US"): Promise<MarketSession>;
}

export interface OrderReader {
  listOpenOrders(accountId: AccountId): Promise<readonly BrokerOrderSummary[]>;
}

export interface ConditionalOrderReader {
  listConditionalOrders(accountId: AccountId): Promise<readonly BrokerConditionalOrderSummary[]>;
}

export interface PreTradeReader {
  getBuyingPower(accountId: AccountId, currency: Currency): Promise<BuyingPowerQuote>;
  getSellableQuantity(accountId: AccountId, symbol: SymbolCode): Promise<SellableQuantityQuote>;
  getCommission(accountId: AccountId, symbol: SymbolCode): Promise<CommissionQuote>;
}

export interface BrokerReadPorts {
  readonly accounts: AccountReader;
  readonly holdings: HoldingsReader;
  readonly quotes: QuoteReader;
  readonly orderBook: OrderBookReader;
  readonly instruments: InstrumentReader;
  readonly marketCalendar: MarketCalendarReader;
  readonly orders: OrderReader;
  readonly conditionalOrders: ConditionalOrderReader;
  readonly preTrade: PreTradeReader;
}
