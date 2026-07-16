import type { BrokerCapability, BrokerDescriptor } from "@portfolio-rebalancer/broker";

const TOSS_READ_CAPABILITIES: readonly BrokerCapability[] = [
  "accounts.read",
  "holdings.read",
  "market.quotes",
  "market.orderbook",
  "market.trades",
  "market.price-limits",
  "market.candles",
  "market.calendar",
  "instruments.read",
  "instruments.warnings",
  "fx.rates",
  "orders.read",
  "orders.conditional.read",
  "pretrade.buying-power",
  "pretrade.sellable-quantity",
  "pretrade.commissions",
  "rankings.read",
  "indicators.read",
];

export const TOSS_TRANSPORT_DESCRIPTOR: BrokerDescriptor = {
  id: "toss",
  displayName: "토스증권",
  capabilities: new Set(TOSS_READ_CAPABILITIES),
};

/** Capability descriptor for the separately instantiated, authorization-gated adapter. */
export const TOSS_AUTHORIZED_LIVE_ORDER_DESCRIPTOR: BrokerDescriptor = {
  id: "toss",
  displayName: "토스증권 제한형 Live 주문",
  capabilities: new Set<BrokerCapability>(["orders.read", "orders.write"]),
};
