import type { Currency, DecimalString } from "@portfolio-rebalancer/domain";

export type BrokerId = string & { readonly __brokerId: unique symbol };
export type AccountId = string & { readonly __accountId: unique symbol };
export type SymbolCode = string & { readonly __symbolCode: unique symbol };
export type IsoDateTime = string & { readonly __isoDateTime: unique symbol };

export interface BrokerAccount {
  readonly id: AccountId;
  readonly displayName: string;
  readonly maskedNumber: string;
}

export interface PriceQuote {
  readonly symbol: SymbolCode;
  readonly price: DecimalString;
  readonly currency: Currency;
  readonly observedAt: IsoDateTime;
}

export interface OrderBookLevel {
  readonly price: DecimalString;
  readonly quantity: DecimalString;
}

export interface OrderBookSnapshot {
  readonly symbol: SymbolCode;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly observedAt: IsoDateTime;
}

export interface BrokerInstrument {
  readonly symbol: SymbolCode;
  readonly name: string;
  readonly marketCountry: "KR" | "US";
  readonly currency: Currency;
}

export interface HoldingPosition {
  readonly symbol: SymbolCode;
  readonly quantity: DecimalString;
  readonly averagePrice: DecimalString;
  readonly currency: Currency;
}

export interface MarketSession {
  readonly marketCountry: "KR" | "US";
  readonly status: "OPEN" | "CLOSED" | "UNKNOWN";
  readonly observedAt: IsoDateTime;
}

export interface BrokerOrderSummary {
  readonly brokerOrderId: string;
  readonly symbol: SymbolCode;
  readonly side: "BUY" | "SELL";
  readonly status: string;
  readonly quantity: DecimalString;
}

export interface BrokerConditionalOrderSummary {
  readonly brokerConditionalOrderId: string;
  readonly symbol: SymbolCode;
  readonly status: string;
  readonly quantity: DecimalString;
}

export interface BuyingPowerQuote {
  readonly accountId: AccountId;
  readonly currency: Currency;
  readonly amount: DecimalString;
  readonly observedAt: IsoDateTime;
}

export interface SellableQuantityQuote {
  readonly accountId: AccountId;
  readonly symbol: SymbolCode;
  readonly quantity: DecimalString;
  readonly observedAt: IsoDateTime;
}

export interface CommissionQuote {
  readonly accountId: AccountId;
  readonly symbol: SymbolCode;
  readonly currency: Currency;
  readonly amount: DecimalString;
  readonly observedAt: IsoDateTime;
}
