import type { Currency, DecimalString } from "@portfolio-rebalancer/domain";

export type BrokerId = string & { readonly __brokerId: unique symbol };
export type AccountId = string & { readonly __accountId: unique symbol };
export type SymbolCode = string & { readonly __symbolCode: unique symbol };
export type IsoDate = string & { readonly __isoDate: unique symbol };
export type IsoDateTime = string & { readonly __isoDateTime: unique symbol };
export type MarketCountry = "KR" | "US";

/**
 * A broker-neutral instrument is identified by market country and symbol together.
 * Listing venues such as KOSPI or NASDAQ are metadata and are not part of this key.
 */
export interface InstrumentIdentifier {
  readonly marketCountry: MarketCountry;
  readonly symbol: SymbolCode;
}

export interface BrokerObservationMetadata {
  readonly brokerId: BrokerId;
  readonly operationId: string;
  readonly requestId: string | null;
  readonly httpStatus: number;
  readonly rateLimitGroup: string | null;
  readonly receivedAt: IsoDateTime;
  readonly auditReference?: string | null;
}

export interface BrokerReadResult<Value> {
  readonly value: Value;
  readonly metadata: BrokerObservationMetadata;
}

export interface BrokerAccount {
  readonly id: AccountId;
  readonly displayName: string;
  readonly maskedNumber: string;
}

export interface PriceQuote extends InstrumentIdentifier {
  readonly price: DecimalString;
  readonly currency: Currency;
  readonly observedAt: IsoDateTime | null;
}

export interface OrderBookLevel {
  readonly price: DecimalString;
  readonly quantity: DecimalString;
}

export interface OrderBookSnapshot extends InstrumentIdentifier {
  readonly currency: Currency;
  readonly bids: readonly OrderBookLevel[];
  readonly asks: readonly OrderBookLevel[];
  readonly observedAt: IsoDateTime | null;
}

export interface PriceLimitQuote extends InstrumentIdentifier {
  readonly currency: Currency;
  readonly upperLimitPrice: DecimalString | null;
  readonly lowerLimitPrice: DecimalString | null;
  readonly observedAt: IsoDateTime;
}

export interface BrokerInstrument extends InstrumentIdentifier {
  readonly name: string;
  readonly currency: Currency;
}

export interface HoldingPosition extends InstrumentIdentifier {
  readonly quantity: DecimalString;
  readonly averagePrice: DecimalString;
  readonly currency: Currency;
}

export type MarketSessionKind = "DAY_MARKET" | "PRE_MARKET" | "REGULAR_MARKET" | "AFTER_MARKET";

/**
 * A tradable interval exactly preserves the session and any auction boundary the
 * broker exposes. A missing boundary is represented as null rather than inferred.
 */
export interface MarketSessionInterval {
  readonly kind: MarketSessionKind;
  readonly startAt: IsoDateTime;
  readonly endAt: IsoDateTime;
  readonly auctionStartAt: IsoDateTime | null;
  readonly auctionEndAt: IsoDateTime | null;
}

export interface MarketCalendarDay {
  readonly date: IsoDate;
  readonly sessions: readonly MarketSessionInterval[];
}

export interface MarketCalendar {
  readonly marketCountry: MarketCountry;
  readonly today: MarketCalendarDay;
  readonly previousBusinessDay: MarketCalendarDay;
  readonly nextBusinessDay: MarketCalendarDay;
}

export interface BrokerOrderSummary extends InstrumentIdentifier {
  readonly brokerOrderId: string;
  readonly side: "BUY" | "SELL";
  readonly status: string;
  readonly quantity: DecimalString;
}

export interface BrokerConditionalOrderSummary extends InstrumentIdentifier {
  readonly brokerConditionalOrderId: string;
  readonly status: string;
  readonly quantity: DecimalString;
}

export interface BuyingPowerQuote {
  readonly accountId: AccountId;
  readonly currency: Currency;
  readonly cashBuyingPower: DecimalString;
}

export interface SellableQuantityQuote extends InstrumentIdentifier {
  readonly accountId: AccountId;
  readonly quantity: DecimalString;
}

export interface CommissionRatePeriod {
  readonly marketCountry: MarketCountry;
  /** Percentage points, for example 0.015 means 0.015%. */
  readonly commissionRatePercent: DecimalString;
  readonly startDate: IsoDate | null;
  readonly endDate: IsoDate | null;
}

/** Account-level commission schedules returned by the broker. */
export interface CommissionRateSchedule {
  readonly accountId: AccountId;
  readonly periods: readonly CommissionRatePeriod[];
}
