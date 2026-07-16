import createClient, {
  type FetchOptions,
  type Middleware,
  type PathBasedClient,
  wrapAsPathBasedClient,
} from "openapi-fetch";

import {
  TOSS_OPENAPI_ORIGIN,
  TossTokenProvider,
  type TossCredentials,
} from "./auth/token-provider";
import { TOSS_OPENAPI_VERSION, TOSS_OPERATIONS } from "./generated/operations";
import type { operations, paths } from "./generated/schema";
import {
  assertTossResponse,
  createTimedFetch,
  createTossManagedFetch,
  type TossManagedFetchOptions,
} from "./transport";

type Options<OperationId extends keyof operations> = FetchOptions<operations[OperationId]>;

export interface TossOpenApiOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
  readonly now?: TossManagedFetchOptions["now"];
  readonly sleep?: TossManagedFetchOptions["sleep"];
  readonly random?: TossManagedFetchOptions["random"];
  readonly maxRetryAfterMs?: TossManagedFetchOptions["maxRetryAfterMs"];
  readonly retryJitterMaxMs?: TossManagedFetchOptions["retryJitterMaxMs"];
  readonly onResponseMetadata?: TossManagedFetchOptions["onResponseMetadata"];
}

export class TossOpenApiClient {
  readonly version = TOSS_OPENAPI_VERSION;
  readonly operations = TOSS_OPERATIONS;
  readonly read: TossReadApi;
  readonly trading: TossTradingApi;

  constructor(credentials: TossCredentials, options: TossOpenApiOptions = {}) {
    const timedFetch = createTimedFetch(
      options.fetch ?? globalThis.fetch,
      options.requestTimeoutMs ?? 10_000,
    );
    const fetchImplementation = createTossManagedFetch(timedFetch, {
      ...(options.now ? { now: options.now } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.random ? { random: options.random } : {}),
      ...(options.maxRetryAfterMs !== undefined
        ? { maxRetryAfterMs: options.maxRetryAfterMs }
        : {}),
      ...(options.retryJitterMaxMs !== undefined
        ? { retryJitterMaxMs: options.retryJitterMaxMs }
        : {}),
      ...(options.onResponseMetadata ? { onResponseMetadata: options.onResponseMetadata } : {}),
    });
    const tokenProvider = new TossTokenProvider(credentials, {
      fetch: fetchImplementation,
      ...(options.now ? { now: options.now } : {}),
    });
    const client = createClient<paths>({
      baseUrl: TOSS_OPENAPI_ORIGIN,
      fetch: fetchImplementation,
    });
    const authMiddleware: Middleware = {
      async onRequest({ request, schemaPath }) {
        if (schemaPath === "/oauth2/token") return request;
        const token = await tokenProvider.getAccessToken();
        request.headers.set("authorization", `Bearer ${token}`);
        return request;
      },
    };
    const responseMiddleware: Middleware = {
      onResponse({ response }) {
        if (response.status === 401) tokenProvider.invalidate();
        assertTossResponse(response);
      },
    };
    client.use(authMiddleware, responseMiddleware);
    const pathClient = wrapAsPathBasedClient(client);
    this.read = new TossReadApi(pathClient);
    this.trading = new TossTradingApi(pathClient);
  }
}

export class TossReadApi {
  constructor(private readonly client: PathBasedClient<paths>) {}

  getOrderbook(options: Options<"getOrderbook">) {
    return this.client["/api/v1/orderbook"].GET(options);
  }
  getPrices(options: Options<"getPrices">) {
    return this.client["/api/v1/prices"].GET(options);
  }
  getTrades(options: Options<"getTrades">) {
    return this.client["/api/v1/trades"].GET(options);
  }
  getPriceLimit(options: Options<"getPriceLimit">) {
    return this.client["/api/v1/price-limits"].GET(options);
  }
  getCandles(options: Options<"getCandles">) {
    return this.client["/api/v1/candles"].GET(options);
  }
  getStocks(options: Options<"getStocks">) {
    return this.client["/api/v1/stocks"].GET(options);
  }
  getStockWarnings(options: Options<"getStockWarnings">) {
    return this.client["/api/v1/stocks/{symbol}/warnings"].GET(options);
  }
  getExchangeRate(options: Options<"getExchangeRate">) {
    return this.client["/api/v1/exchange-rate"].GET(options);
  }
  getKrMarketCalendar(options: Options<"getKrMarketCalendar">) {
    return this.client["/api/v1/market-calendar/KR"].GET(options);
  }
  getUsMarketCalendar(options: Options<"getUsMarketCalendar">) {
    return this.client["/api/v1/market-calendar/US"].GET(options);
  }
  getRankings(options: Options<"getRankings">) {
    return this.client["/api/v1/rankings"].GET(options);
  }
  getMarketIndicatorPrices(options: Options<"getMarketIndicatorPrices">) {
    return this.client["/api/v1/market-indicators/prices"].GET(options);
  }
  getMarketIndicatorCandles(options: Options<"getMarketIndicatorCandles">) {
    return this.client["/api/v1/market-indicators/{symbol}/candles"].GET(options);
  }
  getMarketIndicatorInvestorTrading(options: Options<"getMarketIndicatorInvestorTrading">) {
    return this.client["/api/v1/market-indicators/{symbol}/investor-trading"].GET(options);
  }
  getAccounts(options?: Options<"getAccounts">) {
    return this.client["/api/v1/accounts"].GET(options);
  }
  getHoldings(options: Options<"getHoldings">) {
    return this.client["/api/v1/holdings"].GET(options);
  }
  getOrders(options: Options<"getOrders">) {
    return this.client["/api/v1/orders"].GET(options);
  }
  getOrder(options: Options<"getOrder">) {
    return this.client["/api/v1/orders/{orderId}"].GET(options);
  }
  getConditionalOrders(options: Options<"getConditionalOrders">) {
    return this.client["/api/v1/conditional-orders"].GET(options);
  }
  getConditionalOrder(options: Options<"getConditionalOrder">) {
    return this.client["/api/v1/conditional-orders/{conditionalOrderId}"].GET(options);
  }
  getBuyingPower(options: Options<"getBuyingPower">) {
    return this.client["/api/v1/buying-power"].GET(options);
  }
  getSellableQuantity(options: Options<"getSellableQuantity">) {
    return this.client["/api/v1/sellable-quantity"].GET(options);
  }
  getCommissions(options: Options<"getCommissions">) {
    return this.client["/api/v1/commissions"].GET(options);
  }
}

export class TossTradingApi {
  readonly #client: PathBasedClient<paths>;

  constructor(client: PathBasedClient<paths>) {
    this.#client = client;
  }

  createOrder(options: Options<"createOrder">) {
    return this.#block(() => this.#client["/api/v1/orders"].POST(options));
  }

  modifyOrder(options: Options<"modifyOrder">) {
    return this.#block(() => this.#client["/api/v1/orders/{orderId}/modify"].POST(options));
  }

  cancelOrder(options: Options<"cancelOrder">) {
    return this.#block(() => this.#client["/api/v1/orders/{orderId}/cancel"].POST(options));
  }

  createConditionalOrder(options: Options<"createConditionalOrder">) {
    return this.#block(() => this.#client["/api/v1/conditional-orders"].POST(options));
  }

  modifyConditionalOrder(options: Options<"modifyConditionalOrder">) {
    return this.#block(() =>
      this.#client["/api/v1/conditional-orders/{conditionalOrderId}/modify"].POST(options),
    );
  }

  cancelConditionalOrder(options: Options<"cancelConditionalOrder">) {
    return this.#block(() =>
      this.#client["/api/v1/conditional-orders/{conditionalOrderId}"].DELETE(options),
    );
  }

  #block<T>(_request: () => Promise<T>): Promise<T> {
    return Promise.reject(new TossLiveTradingDisabledError());
  }
}

export class TossLiveTradingDisabledError extends Error {
  readonly code = "TOSS_LIVE_TRADING_DISABLED";

  constructor() {
    super(
      "실거래 주문 기능이 비활성화되어 있습니다. 주문 원장과 멱등성 검증이 연결되기 전에는 활성화할 수 없습니다.",
    );
  }
}
