import { Inject, Injectable } from "@nestjs/common";

import type { TossResponseMetadata } from "@portfolio-rebalancer/broker-toss";

import { ENGINE_CONFIG } from "../../../../config/engine-config.token";
import type { EngineConfig } from "../../../../config/engine.config";
import { CollectionError } from "../../domain/collection.error";
import {
  createTossReadSource,
  type TossPretradeReadSource,
  type TossResponseValidationEvent,
} from "./toss-read-source.adapter";
import { TossRequestAuditContext } from "./toss-request-audit.context";
import {
  PrismaPortfolioRepository,
  type StoredBrokerRequestAttemptInput,
} from "../persistence/prisma-portfolio.repository";

export interface TossRuntime {
  readonly source: TossPretradeReadSource;
  readonly accountReferenceKey: string;
  readonly requestAuditContext: TossRequestAuditContext;
}

@Injectable()
export class TossRuntimeService {
  private runtime: TossRuntime | undefined;
  private readonly requestAuditContext = new TossRequestAuditContext();

  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
    @Inject(PrismaPortfolioRepository)
    private readonly repository: PrismaPortfolioRepository,
  ) {}

  get(): TossRuntime {
    this.runtime ??= this.createRuntime();
    return this.runtime;
  }

  private createRuntime(): TossRuntime {
    if (!this.config.TOSSINVEST_CLIENT_ID || !this.config.TOSSINVEST_CLIENT_SECRET) {
      throw new CollectionError(
        "CREDENTIALS_MISSING",
        "토스증권 API 자격증명이 설정되지 않았습니다.",
        "engine 프로젝트의 환경변수에 토스증권 자격증명을 설정하세요.",
      );
    }
    return {
      source: createTossReadSource({
        clientId: this.config.TOSSINVEST_CLIENT_ID,
        clientSecret: this.config.TOSSINVEST_CLIENT_SECRET,
        onResponseMetadata: (metadata) => this.appendRequestAttempt(metadata),
        onResponseValidation: (event) => this.appendResponseValidation(event),
      }),
      accountReferenceKey:
        this.config.ACCOUNT_REFERENCE_KEY ?? this.config.TOSSINVEST_CLIENT_SECRET,
      requestAuditContext: this.requestAuditContext,
    };
  }

  private async appendRequestAttempt(metadata: TossResponseMetadata): Promise<string> {
    const audit = this.requestAuditContext.resolve(metadata);
    const attempt = await this.repository.appendBrokerRequestAttempt(
      toStoredAttempt(audit, metadata),
    );
    return attempt.id;
  }

  private async appendResponseValidation(event: TossResponseValidationEvent): Promise<string> {
    const validatedAt = new Date(event.validatedAt);
    if (!Number.isFinite(validatedAt.getTime())) {
      throw new Error("토스증권 응답 검증 감사 시각이 올바르지 않습니다.");
    }
    const validation = await this.repository.appendBrokerResponseValidation({
      ...event,
      validatedAt,
    });
    return validation.id;
  }
}

function toStoredAttempt(
  audit: NonNullable<ReturnType<TossRequestAuditContext["resolve"]>>,
  metadata: TossResponseMetadata,
): StoredBrokerRequestAttemptInput {
  const common = {
    workflowType: audit.workflowType,
    correlationId: audit.correlationId,
    collectionRunId: audit.collectionRunId,
    operationId: metadata.operationId,
    ordinal: audit.ordinal,
    attempt: metadata.attempt,
    rateLimitGroup: requiredRateLimitGroup(metadata),
    startedAt: new Date(metadata.startedAt),
    completedAt: new Date(metadata.receivedAt),
    requestId: metadata.requestId,
    rateLimitLimit: metadata.rateLimitLimit,
    rateLimitRemaining: metadata.rateLimitRemaining,
    rateLimitResetSeconds: metadata.rateLimitResetSeconds,
    retryAfterSeconds: metadata.retryAfterSeconds,
    redactedRequestSummary: audit.redactedRequestSummary,
  } as const;

  switch (metadata.outcome) {
    case "SUCCESS":
      return {
        ...common,
        outcome: "SUCCEEDED",
        httpStatus: requiredHttpStatus(metadata),
        safeErrorCode: null,
      };
    case "HTTP_ERROR":
      return {
        ...common,
        outcome: "HTTP_ERROR",
        httpStatus: requiredHttpStatus(metadata),
        safeErrorCode: "TOSS_API_RESPONSE_ERROR",
      };
    case "TIMEOUT":
      return {
        ...common,
        outcome: "TIMEOUT",
        httpStatus: null,
        safeErrorCode: "TOSS_API_TIMEOUT",
      };
    case "NETWORK_ERROR":
      return {
        ...common,
        outcome: "NETWORK_ERROR",
        httpStatus: null,
        safeErrorCode: "TOSS_API_NETWORK_FAILED",
      };
  }
}

function requiredHttpStatus(metadata: TossResponseMetadata): number {
  if (metadata.httpStatus === null) {
    throw new Error(`${metadata.outcome} 토스증권 요청 감사 메타데이터에 HTTP status가 없습니다.`);
  }
  return metadata.httpStatus;
}

function requiredRateLimitGroup(
  metadata: TossResponseMetadata,
): NonNullable<TossResponseMetadata["staticRateLimitGroup"]> {
  if (metadata.staticRateLimitGroup === null) {
    throw new Error(`${metadata.operationId} 토스증권 요청의 정적 rate-limit group이 없습니다.`);
  }
  return metadata.staticRateLimitGroup;
}
