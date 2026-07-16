import {
  consumeLiveOrderAuthorization,
  type BrokerCancelLifecycle,
  type BrokerLiveOrderPort,
  type BrokerOpenOrdersQuery,
  type BrokerOrderAttemptMetadata,
  type BrokerOrderCancelRequest,
  type BrokerOrderCancellationResult,
  type BrokerOrderLookup,
  type BrokerOrderObservation,
  type BrokerOrderReadResult,
  type BrokerOrderSummary,
  type BrokerOrderSubmissionResult,
  type KrwLimitDayOrderRequest,
  type LiveOrderAuthorization,
  type LiveOrderCancelAuthorization,
  type LiveOrderSubmitAuthorization,
  TOSS_CANONICAL_CLIENT_ORDER_ID_PATTERN,
} from "@portfolio-rebalancer/broker";
import type { BrokerId, IsoDateTime, SymbolCode } from "@portfolio-rebalancer/broker";
import type { DecimalString } from "@portfolio-rebalancer/domain";
import type { PathBasedClient } from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/schema";
import {
  getTossResponseAuditReference,
  getTossResponseMetadata,
  TossApiResponseError,
  TossRequestAuditError,
  TossTransportError,
  type TossResponseMetadata,
} from "./transport";

const TOSS_BROKER_ID = "toss" as BrokerId;

const nonEmptyString = z.string().min(1);
const symbolString = nonEmptyString.max(32);
const nonNegativeIntegerString = z
  .string()
  .max(30)
  .regex(/^(?:0|[1-9]\d*)$/);
const positiveIntegerString = z
  .string()
  .max(30)
  .regex(/^[1-9]\d*$/);
const isoOffsetDateTime = z.iso.datetime({ offset: true });

export const TossOrderCreateResponseSchema = z
  .object({
    result: z
      .object({
        orderId: nonEmptyString,
        clientOrderId: nonEmptyString.nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export const TossOrderOperationResponseSchema = z
  .object({
    result: z.object({ orderId: nonEmptyString }).passthrough(),
  })
  .passthrough();

export const TossOrderErrorResponseSchema = z
  .object({
    error: z
      .object({
        requestId: nonEmptyString,
        code: nonEmptyString,
        message: z.string(),
        data: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const TossOrderSchema = z
  .object({
    orderId: nonEmptyString,
    symbol: symbolString,
    side: nonEmptyString,
    orderType: nonEmptyString,
    timeInForce: nonEmptyString,
    status: nonEmptyString,
    price: nonNegativeIntegerString.nullable().optional(),
    quantity: positiveIntegerString,
    currency: nonEmptyString,
    orderedAt: isoOffsetDateTime,
    canceledAt: isoOffsetDateTime.nullable().optional(),
    execution: z
      .object({
        filledQuantity: nonNegativeIntegerString,
        averageFilledPrice: nonNegativeIntegerString.nullable(),
        filledAmount: nonNegativeIntegerString.nullable(),
        commission: nonNegativeIntegerString.nullable(),
        tax: nonNegativeIntegerString.nullable(),
        filledAt: isoOffsetDateTime.nullable(),
        settlementDate: z.iso.date().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

export const TossOrderResponseSchema = z.object({ result: TossOrderSchema }).passthrough();

export const TossOpenOrdersResponseSchema = z
  .object({
    result: z
      .object({
        orders: z.array(TossOrderSchema),
        nextCursor: z.string().nullable(),
        hasNext: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();

export interface TossLiveOrderTransportResponse {
  readonly httpStatus: number;
  readonly rawPayload: unknown;
  readonly metadata: TossResponseMetadata | null;
  readonly auditReference: string | null;
}

export interface TossLiveOrderTransport {
  submitOrder(input: {
    readonly accountSeq: number;
    readonly symbol: string;
    readonly side: "BUY" | "SELL";
    readonly quantity: string;
    readonly price: string;
    readonly clientOrderId: string;
  }): Promise<TossLiveOrderTransportResponse>;

  getOrder(input: {
    readonly accountSeq: number;
    readonly brokerOrderId: string;
  }): Promise<TossLiveOrderTransportResponse>;

  listOpenOrders(input: { readonly accountSeq: number }): Promise<TossLiveOrderTransportResponse>;

  cancelOrder(input: {
    readonly accountSeq: number;
    readonly brokerOrderId: string;
  }): Promise<TossLiveOrderTransportResponse>;
}

export interface TossLiveOrderAdapterOptions {
  readonly now?: () => Date;
}

export class TossOpenOrdersNormalizationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TossOpenOrdersNormalizationError";
  }
}

export function normalizeTossOpenOrderSummaries(
  response: z.infer<typeof TossOpenOrdersResponseSchema>,
): readonly BrokerOrderSummary[] {
  if (response.result.hasNext || response.result.nextCursor !== null) {
    throw new TossOpenOrdersNormalizationError("TOSS_OPEN_ORDERS_PAGINATION_UNEXPECTED");
  }
  return response.result.orders.map((order) => {
    const semanticIssue = orderSemanticIssue(order);
    if (semanticIssue !== null) throw new TossOpenOrdersNormalizationError(semanticIssue);
    if (
      !/^\d{6}$/.test(order.symbol) ||
      order.currency !== "KRW" ||
      (order.side !== "BUY" && order.side !== "SELL")
    ) {
      throw new TossOpenOrdersNormalizationError("TOSS_OPEN_ORDER_IDENTITY_UNSUPPORTED");
    }
    return {
      brokerOrderId: order.orderId,
      marketCountry: "KR",
      symbol: order.symbol as SymbolCode,
      side: order.side,
      status: order.status,
      quantity: order.quantity as DecimalString,
    };
  });
}

export class TossLiveOrderAdapter implements BrokerLiveOrderPort {
  readonly #now: () => Date;

  constructor(
    private readonly transport: TossLiveOrderTransport,
    options: TossLiveOrderAdapterOptions = {},
  ) {
    this.#now = options.now ?? (() => new Date());
  }

  async submitOrder(
    authorization: LiveOrderSubmitAuthorization,
    request: KrwLimitDayOrderRequest,
  ): Promise<BrokerOrderSubmissionResult> {
    const now = this.#now();
    const authorizationResult = consumeLiveOrderAuthorization(
      authorization,
      submitBinding(request),
      now,
    );
    if (authorizationResult.status !== "AUTHORIZED") {
      return submissionIntegrityBlocked(
        request.clientOrderId,
        `LIVE_AUTHORIZATION_${authorizationResult.status}`,
        metadataWithoutResponse("createOrder", now),
      );
    }

    if (!isSupportedSubmitRequest(request)) {
      return submissionIntegrityBlocked(
        request.clientOrderId,
        "UNSUPPORTED_LIVE_ORDER_SHAPE",
        metadataWithoutResponse("createOrder", now),
      );
    }

    const accountSeq = parseAccountSeq(request.brokerAccountReference);
    if (accountSeq === null) {
      return submissionIntegrityBlocked(
        request.clientOrderId,
        "INVALID_TOSS_ACCOUNT_SEQ",
        metadataWithoutResponse("createOrder", now),
      );
    }

    const auditReference = await persistAuthorizedIntent(authorization);
    if (auditReference === null) {
      return submissionIntegrityBlocked(
        request.clientOrderId,
        "LIVE_ORDER_AUDIT_FAILED",
        metadataWithoutResponse("createOrder", now),
      );
    }

    try {
      const response = await this.transport.submitOrder({
        accountSeq,
        symbol: request.symbol,
        side: request.side,
        quantity: request.quantity.toString(),
        price: request.limitPriceMinor.toString(),
        clientOrderId: request.clientOrderId,
      });
      const metadata = toMetadata("createOrder", response, now, auditReference);
      return classifySubmitResponse(request.clientOrderId, response, metadata);
    } catch (error) {
      return await classifySubmitError(request.clientOrderId, error, now, auditReference);
    }
  }

  async getOrder(
    request: BrokerOrderLookup,
  ): Promise<BrokerOrderReadResult<BrokerOrderObservation>> {
    const now = this.#now();
    const accountSeq = parseAccountSeq(request.brokerAccountReference);
    if (accountSeq === null || request.brokerOrderId.trim().length === 0) {
      return readIntegrityBlocked("getOrder", "INVALID_TOSS_ORDER_LOOKUP", now);
    }

    try {
      const response = await this.transport.getOrder({
        accountSeq,
        brokerOrderId: request.brokerOrderId,
      });
      const metadata = toMetadata("getOrder", response, now, null);
      if (response.httpStatus !== 200) {
        return {
          outcome: "UNAVAILABLE",
          value: null,
          reasonCode: `TOSS_GET_ORDER_HTTP_${response.httpStatus}`,
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      const parsed = TossOrderResponseSchema.safeParse(response.rawPayload);
      if (!parsed.success) {
        return {
          outcome: "INTEGRITY_BLOCKED",
          value: null,
          reasonCode: "TOSS_GET_ORDER_SCHEMA_INVALID",
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      const semanticIssue = orderSemanticIssue(parsed.data.result);
      if (semanticIssue !== null) {
        return {
          outcome: "INTEGRITY_BLOCKED",
          value: null,
          reasonCode: semanticIssue,
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      return {
        outcome: "OBSERVED",
        value: normalizeOrder(parsed.data.result),
        reasonCode: "ORDER_OBSERVED",
        metadata,
        rawPayload: response.rawPayload,
      };
    } catch (error) {
      return readUnavailableFromError("getOrder", error, now);
    }
  }

  async listOpenOrders(
    request: BrokerOpenOrdersQuery,
  ): Promise<BrokerOrderReadResult<readonly BrokerOrderObservation[]>> {
    const now = this.#now();
    const accountSeq = parseAccountSeq(request.brokerAccountReference);
    if (accountSeq === null) {
      return readIntegrityBlocked("getOrders", "INVALID_TOSS_ACCOUNT_SEQ", now);
    }

    try {
      const response = await this.transport.listOpenOrders({ accountSeq });
      const metadata = toMetadata("getOrders", response, now, null);
      if (response.httpStatus !== 200) {
        return {
          outcome: "UNAVAILABLE",
          value: null,
          reasonCode: `TOSS_LIST_OPEN_ORDERS_HTTP_${response.httpStatus}`,
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      const parsed = TossOpenOrdersResponseSchema.safeParse(response.rawPayload);
      if (!parsed.success) {
        return {
          outcome: "INTEGRITY_BLOCKED",
          value: null,
          reasonCode: "TOSS_OPEN_ORDERS_SCHEMA_INVALID",
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      try {
        normalizeTossOpenOrderSummaries(parsed.data);
      } catch (error) {
        return {
          outcome: "INTEGRITY_BLOCKED",
          value: null,
          reasonCode:
            error instanceof TossOpenOrdersNormalizationError
              ? error.code
              : "TOSS_OPEN_ORDERS_NORMALIZATION_FAILED",
          metadata,
          rawPayload: response.rawPayload,
        };
      }
      return {
        outcome: "OBSERVED",
        value: parsed.data.result.orders.map(normalizeOrder),
        reasonCode: "ORDER_OBSERVED",
        metadata,
        rawPayload: response.rawPayload,
      };
    } catch (error) {
      return readUnavailableFromError("getOrders", error, now);
    }
  }

  async cancelOrder(
    authorization: LiveOrderCancelAuthorization,
    request: BrokerOrderCancelRequest,
  ): Promise<BrokerOrderCancellationResult> {
    const now = this.#now();
    const authorizationResult = consumeLiveOrderAuthorization(
      authorization,
      cancelBinding(request),
      now,
    );
    if (authorizationResult.status !== "AUTHORIZED") {
      return cancellationIntegrityBlocked(
        request.brokerOrderId,
        `LIVE_AUTHORIZATION_${authorizationResult.status}`,
        metadataWithoutResponse("cancelOrder", now),
      );
    }
    if (authorization.ledgerState !== request.primaryLedgerState) {
      return cancellationIntegrityBlocked(
        request.brokerOrderId,
        "CANCEL_PRIMARY_STATE_MISMATCH",
        metadataWithoutResponse("cancelOrder", now),
      );
    }

    const accountSeq = parseAccountSeq(request.brokerAccountReference);
    if (accountSeq === null || request.brokerOrderId.trim().length === 0) {
      return cancellationIntegrityBlocked(
        request.brokerOrderId,
        "INVALID_TOSS_CANCEL_REQUEST",
        metadataWithoutResponse("cancelOrder", now),
      );
    }

    const auditReference = await persistAuthorizedIntent(authorization);
    if (auditReference === null) {
      return cancellationIntegrityBlocked(
        request.brokerOrderId,
        "LIVE_ORDER_AUDIT_FAILED",
        metadataWithoutResponse("cancelOrder", now),
      );
    }

    try {
      const response = await this.transport.cancelOrder({
        accountSeq,
        brokerOrderId: request.brokerOrderId,
      });
      const metadata = toMetadata("cancelOrder", response, now, auditReference);
      return classifyCancelResponse(request, response, metadata);
    } catch (error) {
      return await classifyCancelError(request.brokerOrderId, error, now, auditReference);
    }
  }
}

export class TossLiveOrderHttpTransport implements TossLiveOrderTransport {
  constructor(private readonly client: PathBasedClient<paths>) {}

  async submitOrder(
    input: Parameters<TossLiveOrderTransport["submitOrder"]>[0],
  ): Promise<TossLiveOrderTransportResponse> {
    const result = await this.client["/api/v1/orders"].POST({
      params: { header: { "X-Tossinvest-Account": input.accountSeq } },
      body: {
        symbol: input.symbol,
        side: input.side,
        orderType: "LIMIT",
        timeInForce: "DAY",
        quantity: input.quantity,
        price: input.price,
        clientOrderId: input.clientOrderId,
        confirmHighValueOrder: false,
      },
    });
    return unwrapOpenApiResult(result);
  }

  async getOrder(
    input: Parameters<TossLiveOrderTransport["getOrder"]>[0],
  ): Promise<TossLiveOrderTransportResponse> {
    const result = await this.client["/api/v1/orders/{orderId}"].GET({
      params: {
        header: { "X-Tossinvest-Account": input.accountSeq },
        path: { orderId: input.brokerOrderId },
      },
    });
    return unwrapOpenApiResult(result);
  }

  async listOpenOrders(
    input: Parameters<TossLiveOrderTransport["listOpenOrders"]>[0],
  ): Promise<TossLiveOrderTransportResponse> {
    const result = await this.client["/api/v1/orders"].GET({
      params: {
        header: { "X-Tossinvest-Account": input.accountSeq },
        query: { status: "OPEN" },
      },
    });
    return unwrapOpenApiResult(result);
  }

  async cancelOrder(
    input: Parameters<TossLiveOrderTransport["cancelOrder"]>[0],
  ): Promise<TossLiveOrderTransportResponse> {
    const result = await this.client["/api/v1/orders/{orderId}/cancel"].POST({
      params: {
        header: { "X-Tossinvest-Account": input.accountSeq },
        path: { orderId: input.brokerOrderId },
      },
    });
    return unwrapOpenApiResult(result);
  }
}

interface OpenApiFetchResult {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response: Response;
}

function unwrapOpenApiResult(result: OpenApiFetchResult): TossLiveOrderTransportResponse {
  return {
    httpStatus: result.response.status,
    rawPayload: result.data ?? result.error ?? null,
    metadata: getTossResponseMetadata(result.response),
    auditReference: getTossResponseAuditReference(result.response),
  };
}

function submitBinding(request: KrwLimitDayOrderRequest) {
  return {
    action: "SUBMIT" as const,
    planId: request.planId,
    planOrderId: request.planOrderId,
    logicalOrderId: request.logicalOrderId,
    accountId: request.accountId,
    brokerAccountReference: request.brokerAccountReference,
    clientOrderId: request.clientOrderId,
    brokerOrderId: null,
    economicTerms: {
      marketCountry: request.marketCountry,
      currency: request.currency,
      symbol: request.symbol,
      side: request.side,
      orderType: request.orderType,
      timeInForce: request.timeInForce,
      quantity: request.quantity.toString(),
      limitPriceMinor: request.limitPriceMinor.toString(),
    },
  };
}

function cancelBinding(request: BrokerOrderCancelRequest) {
  return {
    action: "CANCEL" as const,
    planId: request.planId,
    planOrderId: request.planOrderId,
    logicalOrderId: request.logicalOrderId,
    accountId: request.accountId,
    brokerAccountReference: request.brokerAccountReference,
    clientOrderId: request.clientOrderId,
    brokerOrderId: request.brokerOrderId,
    economicTerms: null,
  };
}

function isSupportedSubmitRequest(request: KrwLimitDayOrderRequest): boolean {
  return (
    request.planId.trim().length > 0 &&
    request.planOrderId.trim().length > 0 &&
    request.logicalOrderId.trim().length > 0 &&
    request.accountId.trim().length > 0 &&
    request.marketCountry === "KR" &&
    request.currency === "KRW" &&
    request.orderType === "LIMIT" &&
    request.timeInForce === "DAY" &&
    /^\d{6}$/.test(request.symbol) &&
    TOSS_CANONICAL_CLIENT_ORDER_ID_PATTERN.test(request.clientOrderId) &&
    request.quantity > 0n &&
    request.limitPriceMinor > 0n
  );
}

function parseAccountSeq(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function persistAuthorizedIntent(
  authorization: LiveOrderAuthorization,
): Promise<string | null> {
  try {
    const reference = await authorization.audit({
      action: authorization.action,
      authorizationId: authorization.authorizationId,
      planId: authorization.planId,
      planOrderId: authorization.planOrderId,
      logicalOrderId: authorization.logicalOrderId,
      accountId: authorization.accountId,
      brokerAccountReference: authorization.brokerAccountReference,
      clientOrderId: authorization.clientOrderId,
      brokerOrderId: authorization.brokerOrderId,
      economicTerms: authorization.economicTerms,
      canonicalRequestDigest: authorization.riskDecision.canonicalRequestDigest,
      evidenceReferences: authorization.riskDecision.evidenceReferences,
      authorizedAt: authorization.issuedAt,
    });
    return reference.trim().length > 0 ? reference : null;
  } catch {
    return null;
  }
}

function classifySubmitResponse(
  clientOrderId: string,
  response: TossLiveOrderTransportResponse,
  metadata: BrokerOrderAttemptMetadata,
): BrokerOrderSubmissionResult {
  if (response.httpStatus === 200) {
    const parsed = TossOrderCreateResponseSchema.safeParse(response.rawPayload);
    if (!parsed.success) {
      const identity = TossOrderOperationResponseSchema.safeParse(response.rawPayload);
      return submissionAmbiguous(
        clientOrderId,
        "TOSS_CREATE_ORDER_200_INCOMPLETE",
        metadata,
        response.rawPayload,
        identity.success ? identity.data.result.orderId : null,
      );
    }
    if (parsed.data.result.clientOrderId !== clientOrderId) {
      return submissionAmbiguous(
        clientOrderId,
        "TOSS_CLIENT_ORDER_ID_MISMATCH",
        metadata,
        response.rawPayload,
        parsed.data.result.orderId,
      );
    }
    return {
      outcome: "ACKNOWLEDGED",
      normalizedState: "PENDING",
      brokerOrderId: parsed.data.result.orderId,
      clientOrderId,
      reasonCode: "TOSS_ORDER_REQUEST_ACKNOWLEDGED",
      metadata,
      rawPayload: response.rawPayload,
    };
  }

  const error = TossOrderErrorResponseSchema.safeParse(response.rawPayload);
  const responseMetadata = error.success
    ? metadataWithPayloadRequestId(metadata, error.data.error.requestId)
    : metadata;
  if (error.success && error.data.error.code === "idempotency-key-conflict") {
    return submissionIntegrityBlocked(
      clientOrderId,
      "TOSS_IDEMPOTENCY_KEY_CONFLICT",
      responseMetadata,
      response.rawPayload,
    );
  }
  if (error.success && error.data.error.code === "request-in-progress") {
    return submissionAmbiguous(
      clientOrderId,
      "TOSS_ORDER_REQUEST_IN_PROGRESS",
      responseMetadata,
      response.rawPayload,
    );
  }
  if (response.httpStatus === 409 && error.success) {
    return submissionAmbiguous(
      clientOrderId,
      "TOSS_CREATE_ORDER_409_AMBIGUOUS",
      responseMetadata,
      response.rawPayload,
    );
  }
  if ((response.httpStatus === 400 || response.httpStatus === 422) && error.success) {
    return {
      outcome: "REJECTED",
      normalizedState: "REJECTED",
      brokerOrderId: null,
      clientOrderId,
      reasonCode: `TOSS_ORDER_REJECTED_${normalizeCode(error.data.error.code)}`,
      metadata: responseMetadata,
      rawPayload: response.rawPayload,
    };
  }

  return submissionAmbiguous(
    clientOrderId,
    `TOSS_CREATE_ORDER_HTTP_${response.httpStatus}_AMBIGUOUS`,
    responseMetadata,
    response.rawPayload,
  );
}

async function classifySubmitError(
  clientOrderId: string,
  error: unknown,
  now: Date,
  auditReference: string,
): Promise<BrokerOrderSubmissionResult> {
  const metadata = metadataFromError("createOrder", error, now, auditReference);
  if (error instanceof TossRequestAuditError) {
    if (error.metadata?.operationId !== "createOrder") {
      return submissionIntegrityBlocked(
        clientOrderId,
        `TOSS_PRE_DISPATCH_AUDIT_FAILED_${normalizeCode(
          error.metadata?.operationId ?? "UNKNOWN_OPERATION",
        )}`,
        metadata,
      );
    }
    const rawPayload = await responsePayloadFromAuditError(error);
    const brokerOrderId = extractBrokerOrderId(rawPayload);
    return submissionIntegrityBlocked(
      clientOrderId,
      "TOSS_RESPONSE_AUDIT_FAILED",
      metadata,
      rawPayload,
      brokerOrderId,
    );
  }
  return submissionAmbiguous(
    clientOrderId,
    error instanceof TossTransportError
      ? error.code
      : error instanceof TossApiResponseError
        ? `TOSS_CREATE_ORDER_HTTP_${error.httpStatus}_AMBIGUOUS`
        : "TOSS_CREATE_ORDER_UNKNOWN_ERROR",
    metadata,
    null,
  );
}

function classifyCancelResponse(
  request: BrokerOrderCancelRequest,
  response: TossLiveOrderTransportResponse,
  metadata: BrokerOrderAttemptMetadata,
): BrokerOrderCancellationResult {
  if (response.httpStatus === 200) {
    const parsed = TossOrderOperationResponseSchema.safeParse(response.rawPayload);
    if (!parsed.success) {
      return cancellationAmbiguous(
        request.brokerOrderId,
        "TOSS_CANCEL_200_INCOMPLETE",
        metadata,
        response.rawPayload,
      );
    }
    return {
      outcome: "ACKNOWLEDGED",
      primaryState: request.primaryLedgerState,
      cancelLifecycle: "REQUEST_ACCEPTED",
      brokerOrderId: request.brokerOrderId,
      brokerActionOrderId: parsed.data.result.orderId,
      reasonCode: "TOSS_CANCEL_REQUEST_ACCEPTED_NOT_FINAL",
      metadata,
      rawPayload: response.rawPayload,
    };
  }

  const error = TossOrderErrorResponseSchema.safeParse(response.rawPayload);
  const responseMetadata = error.success
    ? metadataWithPayloadRequestId(metadata, error.data.error.requestId)
    : metadata;
  if ((response.httpStatus === 400 || response.httpStatus === 422) && error.success) {
    return {
      outcome: "REJECTED",
      primaryState: request.primaryLedgerState,
      cancelLifecycle: "REJECTED",
      brokerOrderId: request.brokerOrderId,
      brokerActionOrderId: null,
      reasonCode: `TOSS_CANCEL_REJECTED_${normalizeCode(error.data.error.code)}`,
      metadata: responseMetadata,
      rawPayload: response.rawPayload,
    };
  }
  return cancellationAmbiguous(
    request.brokerOrderId,
    `TOSS_CANCEL_HTTP_${response.httpStatus}_AMBIGUOUS`,
    responseMetadata,
    response.rawPayload,
  );
}

async function classifyCancelError(
  brokerOrderId: string,
  error: unknown,
  now: Date,
  auditReference: string,
): Promise<BrokerOrderCancellationResult> {
  const metadata = metadataFromError("cancelOrder", error, now, auditReference);
  if (error instanceof TossRequestAuditError) {
    if (error.metadata?.operationId !== "cancelOrder") {
      return cancellationIntegrityBlocked(
        brokerOrderId,
        `TOSS_PRE_DISPATCH_AUDIT_FAILED_${normalizeCode(
          error.metadata?.operationId ?? "UNKNOWN_OPERATION",
        )}`,
        metadata,
      );
    }
    const rawPayload = await responsePayloadFromAuditError(error);
    return cancellationIntegrityBlocked(
      brokerOrderId,
      "TOSS_RESPONSE_AUDIT_FAILED",
      metadata,
      rawPayload,
      extractBrokerOrderId(rawPayload),
    );
  }
  return cancellationAmbiguous(
    brokerOrderId,
    error instanceof TossTransportError ? error.code : "TOSS_CANCEL_UNKNOWN_ERROR",
    metadata,
    null,
  );
}

function normalizeOrder(order: z.infer<typeof TossOrderSchema>): BrokerOrderObservation {
  const auxiliaryStatus =
    order.status === "CANCEL_REJECTED" || order.status === "REPLACE_REJECTED" ? order.status : null;
  const shapeSupported =
    /^\d{6}$/.test(order.symbol) &&
    order.currency === "KRW" &&
    (order.side === "BUY" || order.side === "SELL") &&
    order.orderType === "LIMIT" &&
    order.timeInForce === "DAY" &&
    order.price !== null &&
    order.price !== undefined;

  const filledQuantity = BigInt(order.execution.filledQuantity);
  const normalized = normalizeStatus(order.status, shapeSupported, filledQuantity);
  return {
    brokerOrderId: order.orderId,
    marketCountry: /^\d{6}$/.test(order.symbol) && order.currency === "KRW" ? "KR" : "UNKNOWN",
    currency: order.currency,
    symbol: order.symbol as SymbolCode,
    side: order.side === "BUY" || order.side === "SELL" ? order.side : "UNKNOWN",
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    brokerStatusRaw: order.status,
    primaryState: auxiliaryStatus === null ? normalized.primaryState : null,
    cancelLifecycle: auxiliaryStatus === null ? normalized.cancelLifecycle : "REJECTED",
    auxiliaryStatus,
    mayOverwritePrimary: auxiliaryStatus === null,
    quantity: BigInt(order.quantity),
    limitPriceMinor: order.price === null || order.price === undefined ? null : BigInt(order.price),
    filledQuantity,
    averageFilledPriceMinor: nullableBigInt(order.execution.averageFilledPrice),
    filledGrossNotionalMinor: nullableBigInt(order.execution.filledAmount),
    feeMinor: nullableBigInt(order.execution.commission),
    taxMinor: nullableBigInt(order.execution.tax),
    orderedAt: order.orderedAt as IsoDateTime,
    canceledAt: (order.canceledAt ?? null) as IsoDateTime | null,
    filledAt: order.execution.filledAt as IsoDateTime | null,
  };
}

function normalizeStatus(
  status: string,
  shapeSupported: boolean,
  filledQuantity: bigint,
): {
  readonly primaryState: BrokerOrderObservation["primaryState"];
  readonly cancelLifecycle: BrokerCancelLifecycle;
} {
  if (!shapeSupported) {
    return { primaryState: "UNKNOWN_BLOCKED", cancelLifecycle: "UNSUPPORTED_BLOCKED" };
  }
  switch (status) {
    case "PENDING":
      return { primaryState: "PENDING", cancelLifecycle: "NONE" };
    case "PENDING_CANCEL":
      return {
        primaryState: filledQuantity > 0n ? "PARTIAL_FILLED" : "PENDING",
        cancelLifecycle: "PENDING",
      };
    case "PARTIAL_FILLED":
      return { primaryState: "PARTIAL_FILLED", cancelLifecycle: "NONE" };
    case "FILLED":
      return { primaryState: "FILLED", cancelLifecycle: "NONE" };
    case "CANCELED":
      return { primaryState: "CANCELED", cancelLifecycle: "NONE" };
    case "REJECTED":
      return { primaryState: "REJECTED", cancelLifecycle: "NONE" };
    case "PENDING_REPLACE":
    case "REPLACED":
      return { primaryState: "UNKNOWN_BLOCKED", cancelLifecycle: "UNSUPPORTED_BLOCKED" };
    case "CANCEL_REJECTED":
    case "REPLACE_REJECTED":
      return { primaryState: null, cancelLifecycle: "REJECTED" };
    default:
      return { primaryState: "UNKNOWN_BLOCKED", cancelLifecycle: "UNSUPPORTED_BLOCKED" };
  }
}

function nullableBigInt(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function submissionAmbiguous(
  clientOrderId: string,
  reasonCode: string,
  metadata: BrokerOrderAttemptMetadata,
  rawPayload: unknown,
  brokerOrderId: string | null = null,
): BrokerOrderSubmissionResult {
  return {
    outcome: "AMBIGUOUS",
    normalizedState: "UNKNOWN",
    brokerOrderId,
    clientOrderId,
    reasonCode,
    metadata,
    rawPayload,
  };
}

function submissionIntegrityBlocked(
  clientOrderId: string,
  reasonCode: string,
  metadata: BrokerOrderAttemptMetadata,
  rawPayload: unknown = null,
  brokerOrderId: string | null = null,
): BrokerOrderSubmissionResult {
  return {
    outcome: "INTEGRITY_BLOCKED",
    normalizedState: "UNKNOWN_BLOCKED",
    brokerOrderId,
    clientOrderId,
    reasonCode,
    metadata,
    rawPayload,
  };
}

function cancellationAmbiguous(
  brokerOrderId: string,
  reasonCode: string,
  metadata: BrokerOrderAttemptMetadata,
  rawPayload: unknown,
): BrokerOrderCancellationResult {
  return {
    outcome: "AMBIGUOUS",
    primaryState: "UNKNOWN",
    cancelLifecycle: "AMBIGUOUS",
    brokerOrderId,
    brokerActionOrderId: null,
    reasonCode,
    metadata,
    rawPayload,
  };
}

function cancellationIntegrityBlocked(
  brokerOrderId: string,
  reasonCode: string,
  metadata: BrokerOrderAttemptMetadata,
  rawPayload: unknown = null,
  brokerActionOrderId: string | null = null,
): BrokerOrderCancellationResult {
  return {
    outcome: "INTEGRITY_BLOCKED",
    primaryState: "UNKNOWN_BLOCKED",
    cancelLifecycle: "UNSUPPORTED_BLOCKED",
    brokerOrderId,
    brokerActionOrderId,
    reasonCode,
    metadata,
    rawPayload,
  };
}

function readIntegrityBlocked<OperationId extends "getOrder" | "getOrders">(
  operationId: OperationId,
  reasonCode: string,
  now: Date,
): BrokerOrderReadResult<never> {
  return {
    outcome: "INTEGRITY_BLOCKED",
    value: null,
    reasonCode,
    metadata: metadataWithoutResponse(operationId, now),
    rawPayload: null,
  };
}

function readUnavailableFromError<OperationId extends "getOrder" | "getOrders">(
  operationId: OperationId,
  error: unknown,
  now: Date,
): BrokerOrderReadResult<never> {
  return {
    outcome: "UNAVAILABLE",
    value: null,
    reasonCode:
      error instanceof TossTransportError
        ? error.code
        : error instanceof TossApiResponseError
          ? `TOSS_READ_HTTP_${error.httpStatus}`
          : "TOSS_ORDER_READ_UNKNOWN_ERROR",
    metadata: metadataFromError(operationId, error, now, null),
    rawPayload: null,
  };
}

function metadataWithoutResponse(
  operationId: BrokerOrderAttemptMetadata["operationId"],
  now: Date,
): BrokerOrderAttemptMetadata {
  return {
    brokerId: TOSS_BROKER_ID,
    operationId,
    requestId: null,
    httpStatus: null,
    rateLimitGroup: operationRateLimitGroup(operationId),
    receivedAt: now.toISOString() as IsoDateTime,
    dispatchStage: "PRE_DISPATCH",
    upstreamOperationId: null,
    auditReference: null,
    transportAuditReference: null,
  };
}

function toMetadata(
  operationId: BrokerOrderAttemptMetadata["operationId"],
  response: TossLiveOrderTransportResponse,
  now: Date,
  auditReference: string | null,
): BrokerOrderAttemptMetadata {
  return {
    brokerId: TOSS_BROKER_ID,
    operationId,
    requestId: response.metadata?.requestId ?? null,
    httpStatus: response.httpStatus,
    rateLimitGroup: response.metadata?.staticRateLimitGroup ?? operationRateLimitGroup(operationId),
    receivedAt: (response.metadata?.receivedAt ?? now.toISOString()) as IsoDateTime,
    dispatchStage: "BROKER_RESPONSE",
    upstreamOperationId: response.metadata?.operationId ?? operationId,
    auditReference,
    transportAuditReference: response.auditReference,
  };
}

function metadataFromError(
  operationId: BrokerOrderAttemptMetadata["operationId"],
  error: unknown,
  now: Date,
  auditReference: string | null,
): BrokerOrderAttemptMetadata {
  if (error instanceof TossRequestAuditError && error.metadata !== null) {
    const expectedOperationId = operationId;
    const reachedBrokerOperation = error.metadata.operationId === expectedOperationId;
    return {
      brokerId: TOSS_BROKER_ID,
      operationId,
      requestId: error.metadata.requestId,
      httpStatus: error.metadata.httpStatus,
      rateLimitGroup: error.metadata.staticRateLimitGroup ?? operationRateLimitGroup(operationId),
      receivedAt: error.metadata.receivedAt as IsoDateTime,
      dispatchStage: reachedBrokerOperation ? "BROKER_RESPONSE" : "PRE_DISPATCH",
      upstreamOperationId: error.metadata.operationId,
      auditReference,
      transportAuditReference: null,
    };
  }
  return {
    ...metadataWithoutResponse(operationId, now),
    requestId: error instanceof TossApiResponseError ? error.requestId : null,
    httpStatus: error instanceof TossApiResponseError ? error.httpStatus : null,
    rateLimitGroup:
      error instanceof TossApiResponseError
        ? (error.staticRateLimitGroup ?? error.rateLimitGroup)
        : operationRateLimitGroup(operationId),
    dispatchStage:
      error instanceof TossApiResponseError
        ? "BROKER_RESPONSE"
        : error instanceof TossTransportError
          ? "BROKER_OUTCOME_UNKNOWN"
          : "BROKER_OUTCOME_UNKNOWN",
    upstreamOperationId:
      error instanceof TossApiResponseError ? (error.operationId ?? operationId) : operationId,
    auditReference,
  };
}

async function responsePayloadFromAuditError(error: TossRequestAuditError): Promise<unknown> {
  if (error.response === null) return null;
  try {
    return await error.response.json();
  } catch {
    return null;
  }
}

function extractBrokerOrderId(rawPayload: unknown): string | null {
  const parsed = TossOrderOperationResponseSchema.safeParse(rawPayload);
  return parsed.success ? parsed.data.result.orderId : null;
}

function metadataWithPayloadRequestId(
  metadata: BrokerOrderAttemptMetadata,
  requestId: string,
): BrokerOrderAttemptMetadata {
  return metadata.requestId === null ? { ...metadata, requestId } : metadata;
}

function orderSemanticIssue(order: z.infer<typeof TossOrderSchema>): string | null {
  const quantity = BigInt(order.quantity);
  const filledQuantity = BigInt(order.execution.filledQuantity);
  if (order.price !== null && order.price !== undefined && BigInt(order.price) <= 0n) {
    return "TOSS_ORDER_LIMIT_PRICE_INVALID";
  }
  if (filledQuantity > quantity) return "TOSS_ORDER_FILLED_QUANTITY_EXCEEDS_ORDER_QUANTITY";

  const hasFill = filledQuantity > 0n;
  const completeFill = filledQuantity === quantity;
  if (
    hasFill &&
    (order.execution.averageFilledPrice === null ||
      BigInt(order.execution.averageFilledPrice) <= 0n ||
      order.execution.filledAmount === null ||
      BigInt(order.execution.filledAmount) <= 0n ||
      order.execution.filledAt === null)
  ) {
    return "TOSS_ORDER_FILL_EVIDENCE_INCOMPLETE";
  }
  if (!hasFill && order.execution.filledAt !== null) {
    return "TOSS_ORDER_ZERO_FILL_HAS_FILLED_TIME";
  }

  switch (order.status) {
    case "PENDING":
    case "REJECTED":
      return hasFill ? "TOSS_ORDER_STATUS_FILL_MISMATCH" : null;
    case "PENDING_CANCEL":
      return completeFill ? "TOSS_ORDER_PENDING_CANCEL_ALREADY_FILLED" : null;
    case "PARTIAL_FILLED":
      return !hasFill || completeFill ? "TOSS_ORDER_PARTIAL_FILL_INVALID" : null;
    case "FILLED":
      return completeFill ? null : "TOSS_ORDER_FILLED_QUANTITY_MISMATCH";
    case "CANCELED":
      return completeFill ? "TOSS_ORDER_CANCELED_AFTER_COMPLETE_FILL" : null;
    default:
      return null;
  }
}

function operationRateLimitGroup(operationId: BrokerOrderAttemptMetadata["operationId"]): string {
  return operationId === "getOrder" || operationId === "getOrders" ? "ORDER_HISTORY" : "ORDER";
}

function normalizeCode(code: string): string {
  return code
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
