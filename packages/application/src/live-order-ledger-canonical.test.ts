import { describe, expect, it } from "vitest";

import {
  ORDER_CANCEL_DISPATCH_CLAIM_VERSION,
  ORDER_DISPATCH_CLAIM_VERSION,
  ORDER_SUBMISSION_AUTHORIZATION_VERSION,
  createOrderCancelDispatchClaimCanonical,
  createOrderDispatchClaimCanonical,
  createOrderSubmissionAuthorizationCanonical,
} from "./live-order-ledger-canonical";

const common = {
  planId: "11111111-1111-4111-8111-111111111111",
  planVersion: 1,
  planOrderId: "22222222-2222-4222-8222-222222222222",
  logicalOrderId: "33333333-3333-4333-8333-333333333333",
  accountId: "44444444-4444-4444-8444-444444444444",
  clientOrderId: `pr1_${"a".repeat(32)}`,
  canonicalIntentSha256: "b".repeat(64),
  authorizedRequestDigest: "c".repeat(64),
  brokerAccountReferenceHmac: "d".repeat(64),
  executionRiskEvidenceId: "55555555-5555-4555-8555-555555555555",
  preSubmitEvidenceId: "66666666-6666-4666-8666-666666666666",
  reservationId: "77777777-7777-4777-8777-777777777777",
  approvalId: "88888888-8888-4888-8888-888888888888",
};

describe("Live order ledger canonical envelopes", () => {
  it("DB A단계 trigger와 같은 제출 준비 payload와 digest를 만든다", () => {
    const result = createOrderSubmissionAuthorizationCanonical({
      ...common,
      submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
      expiresAt: new Date("2026-07-17T00:00:25.000Z"),
    });

    expect(result.canonicalPreparation).toBe(
      JSON.stringify({
        version: ORDER_SUBMISSION_AUTHORIZATION_VERSION,
        submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
        planId: common.planId,
        planVersion: 1,
        planOrderId: common.planOrderId,
        logicalOrderId: common.logicalOrderId,
        accountId: common.accountId,
        clientOrderId: common.clientOrderId,
        canonicalIntentSha256: common.canonicalIntentSha256,
        authorizedRequestDigest: common.authorizedRequestDigest,
        brokerAccountReferenceHmac: common.brokerAccountReferenceHmac,
        executionRiskEvidenceId: common.executionRiskEvidenceId,
        preSubmitEvidenceId: common.preSubmitEvidenceId,
        reservationId: common.reservationId,
        approvalId: common.approvalId,
        expiresAt: "2026-07-17T00:00:25.000Z",
      }),
    );
    expect(result.canonicalPreparationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("DB B단계 trigger와 같은 일회성 dispatch payload와 digest를 만든다", () => {
    const result = createOrderDispatchClaimCanonical({
      ...common,
      dispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
      authorizationId: "live-authorization-1",
      authorizationIssuedAt: new Date("2026-07-17T00:00:10.000Z"),
      authorizationExpiresAt: new Date("2026-07-17T00:00:25.000Z"),
    });

    expect(result.canonicalRequest).toBe(
      JSON.stringify({
        version: ORDER_DISPATCH_CLAIM_VERSION,
        dispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
        authorizationId: "live-authorization-1",
        planId: common.planId,
        planVersion: 1,
        planOrderId: common.planOrderId,
        logicalOrderId: common.logicalOrderId,
        accountId: common.accountId,
        clientOrderId: common.clientOrderId,
        canonicalIntentSha256: common.canonicalIntentSha256,
        authorizedRequestDigest: common.authorizedRequestDigest,
        brokerAccountReferenceHmac: common.brokerAccountReferenceHmac,
        executionRiskEvidenceId: common.executionRiskEvidenceId,
        preSubmitEvidenceId: common.preSubmitEvidenceId,
        reservationId: common.reservationId,
        approvalId: common.approvalId,
        authorizationIssuedAt: "2026-07-17T00:00:10.000Z",
        authorizationExpiresAt: "2026-07-17T00:00:25.000Z",
      }),
    );
    expect(result.claimEnvelopeDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("취소 HTTP 직전 원 주문과 운영자 승인을 묶은 일회성 claim을 만든다", () => {
    const result = createOrderCancelDispatchClaimCanonical({
      cancelDispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cancelOperatorAuthorizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      authorizationId: "cancel-authorization-1",
      planId: common.planId,
      planVersion: common.planVersion,
      planOrderId: common.planOrderId,
      logicalOrderId: common.logicalOrderId,
      accountId: common.accountId,
      clientOrderId: common.clientOrderId,
      canonicalIntentSha256: common.canonicalIntentSha256,
      authorizedRequestDigest: common.authorizedRequestDigest,
      brokerAccountReferenceHmac: common.brokerAccountReferenceHmac,
      brokerOrderId: "broker-order-1",
      ledgerState: "PARTIAL_FILLED",
      operatorAuthorizationDigest: "e".repeat(64),
      authorizationIssuedAt: new Date("2026-07-17T00:00:10.000Z"),
      authorizationExpiresAt: new Date("2026-07-17T00:00:25.000Z"),
    });

    expect(result.canonicalRequest).toBe(
      JSON.stringify({
        version: ORDER_CANCEL_DISPATCH_CLAIM_VERSION,
        cancelDispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cancelOperatorAuthorizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        authorizationId: "cancel-authorization-1",
        planId: common.planId,
        planVersion: common.planVersion,
        planOrderId: common.planOrderId,
        logicalOrderId: common.logicalOrderId,
        accountId: common.accountId,
        clientOrderId: common.clientOrderId,
        canonicalIntentSha256: common.canonicalIntentSha256,
        authorizedRequestDigest: common.authorizedRequestDigest,
        brokerAccountReferenceHmac: common.brokerAccountReferenceHmac,
        brokerOrderId: "broker-order-1",
        ledgerState: "PARTIAL_FILLED",
        operatorAuthorizationDigest: "e".repeat(64),
        authorizationIssuedAt: "2026-07-17T00:00:10.000Z",
        authorizationExpiresAt: "2026-07-17T00:00:25.000Z",
      }),
    );
    expect(result.claimEnvelopeDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("브로커 권한 digest와 DB 증거 참조가 바뀌면 봉투 digest도 바뀐다", () => {
    const base = {
      ...common,
      submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
      expiresAt: new Date("2026-07-17T00:00:25.000Z"),
    };
    const original = createOrderSubmissionAuthorizationCanonical(base);

    expect(
      createOrderSubmissionAuthorizationCanonical({
        ...base,
        authorizedRequestDigest: "e".repeat(64),
      }).canonicalPreparationDigest,
    ).not.toBe(original.canonicalPreparationDigest);
    expect(
      createOrderSubmissionAuthorizationCanonical({
        ...base,
        approvalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }).canonicalPreparationDigest,
    ).not.toBe(original.canonicalPreparationDigest);
  });

  it("잘못된 UUID·digest·clientOrderId·30초 초과 권한을 차단한다", () => {
    expect(() =>
      createOrderSubmissionAuthorizationCanonical({
        ...common,
        submissionAuthorizationId: "not-a-uuid",
        expiresAt: new Date("2026-07-17T00:00:25.000Z"),
      }),
    ).toThrow("UUID");
    expect(() =>
      createOrderSubmissionAuthorizationCanonical({
        ...common,
        authorizedRequestDigest: "invalid",
        submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
        expiresAt: new Date("2026-07-17T00:00:25.000Z"),
      }),
    ).toThrow("SHA-256");
    expect(() =>
      createOrderDispatchClaimCanonical({
        ...common,
        clientOrderId: "invalid",
        dispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
        authorizationId: "live-authorization-1",
        authorizationIssuedAt: new Date("2026-07-17T00:00:10.000Z"),
        authorizationExpiresAt: new Date("2026-07-17T00:00:25.000Z"),
      }),
    ).toThrow("clientOrderId");
    expect(() =>
      createOrderDispatchClaimCanonical({
        ...common,
        dispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        submissionAuthorizationId: "99999999-9999-4999-8999-999999999999",
        authorizationId: "live-authorization-1",
        authorizationIssuedAt: new Date("2026-07-17T00:00:10.000Z"),
        authorizationExpiresAt: new Date("2026-07-17T00:00:40.001Z"),
      }),
    ).toThrow("30초");
    expect(() =>
      createOrderCancelDispatchClaimCanonical({
        cancelDispatchClaimId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        cancelOperatorAuthorizationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        authorizationId: "cancel-authorization-1",
        planId: common.planId,
        planVersion: common.planVersion,
        planOrderId: common.planOrderId,
        logicalOrderId: common.logicalOrderId,
        accountId: common.accountId,
        clientOrderId: common.clientOrderId,
        canonicalIntentSha256: common.canonicalIntentSha256,
        authorizedRequestDigest: common.authorizedRequestDigest,
        brokerAccountReferenceHmac: common.brokerAccountReferenceHmac,
        brokerOrderId: "broker-order-1",
        ledgerState: "PENDING",
        operatorAuthorizationDigest: "e".repeat(64),
        authorizationIssuedAt: new Date("2026-07-17T00:00:10.000Z"),
        authorizationExpiresAt: new Date("2026-07-17T00:00:40.001Z"),
      }),
    ).toThrow("30초");
  });
});
