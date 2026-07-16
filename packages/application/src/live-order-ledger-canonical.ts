import { createHash } from "node:crypto";

export const ORDER_SUBMISSION_AUTHORIZATION_VERSION = "ORDER_SUBMISSION_AUTHORIZATION_V1" as const;
export const ORDER_DISPATCH_CLAIM_VERSION = "ORDER_DISPATCH_CLAIM_V1" as const;

interface LiveOrderLedgerBinding {
  readonly planId: string;
  readonly planVersion: number;
  readonly planOrderId: string;
  readonly logicalOrderId: string;
  readonly accountId: string;
  readonly clientOrderId: string;
  readonly canonicalIntentSha256: string;
  readonly authorizedRequestDigest: string;
  readonly brokerAccountReferenceHmac: string;
  readonly executionRiskEvidenceId: string;
  readonly preSubmitEvidenceId: string;
  readonly reservationId: string;
  readonly approvalId: string;
}

export interface OrderSubmissionAuthorizationCanonicalInput extends LiveOrderLedgerBinding {
  readonly submissionAuthorizationId: string;
  readonly expiresAt: Date;
}

export interface OrderDispatchClaimCanonicalInput extends LiveOrderLedgerBinding {
  readonly dispatchClaimId: string;
  readonly submissionAuthorizationId: string;
  readonly authorizationId: string;
  readonly authorizationIssuedAt: Date;
  readonly authorizationExpiresAt: Date;
}

export interface OrderSubmissionAuthorizationCanonical {
  readonly canonicalPreparation: string;
  readonly canonicalPreparationDigest: string;
}

export interface OrderDispatchClaimCanonical {
  readonly canonicalRequest: string;
  readonly claimEnvelopeDigest: string;
}

export function createOrderSubmissionAuthorizationCanonical(
  input: OrderSubmissionAuthorizationCanonicalInput,
): OrderSubmissionAuthorizationCanonical {
  validateCommon(input);
  assertUuid(input.submissionAuthorizationId, "submissionAuthorizationId");
  assertFiniteDate(input.expiresAt, "expiresAt");
  const canonicalPreparation = JSON.stringify({
    version: ORDER_SUBMISSION_AUTHORIZATION_VERSION,
    submissionAuthorizationId: input.submissionAuthorizationId,
    planId: input.planId,
    planVersion: input.planVersion,
    planOrderId: input.planOrderId,
    logicalOrderId: input.logicalOrderId,
    accountId: input.accountId,
    clientOrderId: input.clientOrderId,
    canonicalIntentSha256: input.canonicalIntentSha256,
    authorizedRequestDigest: input.authorizedRequestDigest,
    brokerAccountReferenceHmac: input.brokerAccountReferenceHmac,
    executionRiskEvidenceId: input.executionRiskEvidenceId,
    preSubmitEvidenceId: input.preSubmitEvidenceId,
    reservationId: input.reservationId,
    approvalId: input.approvalId,
    expiresAt: input.expiresAt.toISOString(),
  });
  return {
    canonicalPreparation,
    canonicalPreparationDigest: sha256(canonicalPreparation),
  };
}

export function createOrderDispatchClaimCanonical(
  input: OrderDispatchClaimCanonicalInput,
): OrderDispatchClaimCanonical {
  validateCommon(input);
  assertUuid(input.dispatchClaimId, "dispatchClaimId");
  assertUuid(input.submissionAuthorizationId, "submissionAuthorizationId");
  if (input.authorizationId.trim().length === 0 || input.authorizationId.length > 200) {
    throw new Error("authorizationId가 Live dispatch claim 규칙을 만족하지 않습니다.");
  }
  const issuedAtMs = assertFiniteDate(input.authorizationIssuedAt, "authorizationIssuedAt");
  const expiresAtMs = assertFiniteDate(input.authorizationExpiresAt, "authorizationExpiresAt");
  if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > 30_000) {
    throw new Error("Live dispatch 권한 만료시간은 발급 후 30초 이하여야 합니다.");
  }
  const canonicalRequest = JSON.stringify({
    version: ORDER_DISPATCH_CLAIM_VERSION,
    dispatchClaimId: input.dispatchClaimId,
    submissionAuthorizationId: input.submissionAuthorizationId,
    authorizationId: input.authorizationId,
    planId: input.planId,
    planVersion: input.planVersion,
    planOrderId: input.planOrderId,
    logicalOrderId: input.logicalOrderId,
    accountId: input.accountId,
    clientOrderId: input.clientOrderId,
    canonicalIntentSha256: input.canonicalIntentSha256,
    authorizedRequestDigest: input.authorizedRequestDigest,
    brokerAccountReferenceHmac: input.brokerAccountReferenceHmac,
    executionRiskEvidenceId: input.executionRiskEvidenceId,
    preSubmitEvidenceId: input.preSubmitEvidenceId,
    reservationId: input.reservationId,
    approvalId: input.approvalId,
    authorizationIssuedAt: input.authorizationIssuedAt.toISOString(),
    authorizationExpiresAt: input.authorizationExpiresAt.toISOString(),
  });
  return {
    canonicalRequest,
    claimEnvelopeDigest: sha256(canonicalRequest),
  };
}

function validateCommon(input: LiveOrderLedgerBinding): void {
  const uuidFields: readonly (readonly [string, string])[] = [
    ["planId", input.planId],
    ["planOrderId", input.planOrderId],
    ["logicalOrderId", input.logicalOrderId],
    ["accountId", input.accountId],
    ["executionRiskEvidenceId", input.executionRiskEvidenceId],
    ["preSubmitEvidenceId", input.preSubmitEvidenceId],
    ["reservationId", input.reservationId],
    ["approvalId", input.approvalId],
  ];
  uuidFields.forEach(([name, value]) => assertUuid(value, name));
  if (!Number.isSafeInteger(input.planVersion) || input.planVersion < 1) {
    throw new Error("planVersion이 Live 원장 canonical 규칙을 만족하지 않습니다.");
  }
  if (!/^pr1_[A-Za-z0-9_-]{32}$/.test(input.clientOrderId)) {
    throw new Error("clientOrderId가 Live 원장 canonical 규칙을 만족하지 않습니다.");
  }
  const digestFields: readonly (readonly [string, string])[] = [
    ["canonicalIntentSha256", input.canonicalIntentSha256],
    ["authorizedRequestDigest", input.authorizedRequestDigest],
    ["brokerAccountReferenceHmac", input.brokerAccountReferenceHmac],
  ];
  digestFields.forEach(([name, value]) => assertSha256(value, name));
}

function assertUuid(value: string, name: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name}이(가) Live 원장 UUID 규칙을 만족하지 않습니다.`);
  }
}

function assertSha256(value: string, name: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name}이(가) SHA-256 규칙을 만족하지 않습니다.`);
  }
}

function assertFiniteDate(value: Date, name: string): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${name}이(가) 유효한 시각이 아닙니다.`);
  }
  return milliseconds;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
