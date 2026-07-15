export type BrokerCapability =
  | "accounts.read"
  | "holdings.read"
  | "market.quotes"
  | "market.orderbook"
  | "market.trades"
  | "market.price-limits"
  | "market.candles"
  | "market.calendar"
  | "instruments.read"
  | "instruments.warnings"
  | "fx.rates"
  | "orders.read"
  | "orders.write"
  | "orders.conditional.read"
  | "orders.conditional.write"
  | "pretrade.buying-power"
  | "pretrade.sellable-quantity"
  | "pretrade.commissions"
  | "rankings.read"
  | "indicators.read";

export interface BrokerDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<BrokerCapability>;
}

export function requireCapability(broker: BrokerDescriptor, capability: BrokerCapability): void {
  if (!broker.capabilities.has(capability)) {
    throw new BrokerCapabilityUnavailableError(broker.id, capability);
  }
}

export class BrokerCapabilityUnavailableError extends Error {
  readonly code = "BROKER_CAPABILITY_UNAVAILABLE";

  constructor(
    readonly brokerId: string,
    readonly capability: BrokerCapability,
  ) {
    super(`${brokerId} 증권사는 ${capability} 기능을 지원하지 않습니다.`);
  }
}
