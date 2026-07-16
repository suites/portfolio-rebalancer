import { describe, expect, it, vi } from "vitest";

import { OperationalConfigError } from "../domain/operational-config.error";
import type { PrismaOperationalConfigRepository } from "../infrastructure/persistence/prisma-operational-config.repository";
import { liveConfig } from "../testing/operational-config.fixture";
import { OperationalConfigService, presentSnapshot } from "./operational-config.service";

const VERSION_ID = "10000000-0000-4000-8000-000000000003";
const ACCOUNT_HMAC = "a".repeat(64);

describe("OperationalConfigService", () => {
  it("active LIVE, account allowlist, kill DISENGAGED와 같은 version의 GRANTED를 모두 확인한다", () => {
    expect(
      presentSnapshot({
        account: {
          id: "10000000-0000-4000-8000-000000000001",
          externalRefHmac: ACCOUNT_HMAC,
        },
        activeVersion: storedVersion(VERSION_ID),
        draftVersion: null,
        killSwitch: "DISENGAGED",
        livePromotion: "GRANTED",
        livePromotionConfigVersionId: VERSION_ID,
      }),
    ).toMatchObject({ state: "READY", liveOrdersEnabled: true });
  });

  it("승격이 이전 config version에 묶였으면 상태가 GRANTED여도 live 주문을 차단한다", () => {
    expect(
      presentSnapshot({
        account: {
          id: "10000000-0000-4000-8000-000000000001",
          externalRefHmac: ACCOUNT_HMAC,
        },
        activeVersion: storedVersion(VERSION_ID),
        draftVersion: null,
        killSwitch: "DISENGAGED",
        livePromotion: "GRANTED",
        livePromotionConfigVersionId: "10000000-0000-4000-8000-000000000099",
      }).liveOrdersEnabled,
    ).toBe(false);
  });

  it("원장 조회 실패는 부분 설정을 추정하지 않고 UNAVAILABLE snapshot으로 닫는다", async () => {
    const service = serviceWithRepository({
      currentState: vi.fn().mockRejectedValue(new Error("db offline")),
    });

    await expect(service.current()).resolves.toEqual({
      state: "UNAVAILABLE",
      activeVersion: null,
      draftVersion: null,
      killSwitch: "UNKNOWN",
      livePromotion: "UNKNOWN",
      liveOrdersEnabled: false,
    });
  });

  it("계좌가 없으면 draft 저장을 한국어 typed conflict로 거부한다", async () => {
    const service = serviceWithRepository({
      saveDraft: vi.fn().mockResolvedValue({ status: "NO_ACCOUNT" }),
    });

    const error = await rejectedError(service.saveDraft(liveConfig()));
    expect(error).toBeInstanceOf(OperationalConfigError);
    expect(error).toMatchObject({
      name: "OperationalConfigError",
      code: "OPERATIONAL_CONFIG_ACCOUNT_MISSING",
      kind: "CONFLICT",
    });
    expect(error.message).toContain("포트폴리오를 새로고침");
  });

  it("웹 입력의 계좌 HMAC을 신뢰하지 않고 현재 수집 계좌만 allowlist에 봉인한다", async () => {
    const currentState = vi.fn().mockResolvedValue({
      account: {
        id: "10000000-0000-4000-8000-000000000001",
        externalRefHmac: ACCOUNT_HMAC,
      },
      activeVersion: null,
      draftVersion: null,
      killSwitch: "DISENGAGED",
      livePromotion: "REVOKED",
      livePromotionConfigVersionId: null,
    });
    const saveDraft = vi.fn().mockResolvedValue({ status: "SAVED" });
    const service = serviceWithRepository({ currentState, saveDraft });
    const untrusted = {
      ...liveConfig(),
      live: {
        ...liveConfig().live,
        accountAllowlistHmacs: ["f".repeat(64)],
      },
    };

    await service.saveCurrentAccountDraft({
      accountScope: "CURRENT_ACCOUNT",
      config: untrusted,
    });

    const savedInput: unknown = saveDraft.mock.calls[0]?.[0];
    if (
      savedInput === null ||
      typeof savedInput !== "object" ||
      !("canonicalContent" in savedInput) ||
      typeof savedInput.canonicalContent !== "string"
    ) {
      throw new Error("canonical operational config가 저장되어야 합니다.");
    }
    expect(savedInput.canonicalContent).toContain(`"accountAllowlistHmacs":["${ACCOUNT_HMAC}"]`);
    expect(savedInput.canonicalContent).not.toContain("f".repeat(64));
  });

  it("activation hash 불일치와 확인되지 않은 kill switch를 별도 코드로 보존한다", async () => {
    const activation = serviceWithRepository({
      activateDraft: vi.fn().mockResolvedValue({ status: "HASH_MISMATCH" }),
    });
    const promotion = serviceWithRepository({
      saveLivePromotion: vi.fn().mockResolvedValue({ status: "KILL_SWITCH_BLOCKED" }),
    });

    await expect(
      activation.activateDraft({
        version: 2,
        contentHash: "b".repeat(64),
        confirmation: "운영 설정을 적용합니다",
      }),
    ).rejects.toMatchObject({ code: "OPERATIONAL_CONFIG_HASH_MISMATCH" });
    await expect(
      promotion.saveLivePromotion({
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        confirmation: "극소액 Live 승격",
      }),
    ).rejects.toMatchObject({ code: "LIVE_PROMOTION_KILL_SWITCH_BLOCKED" });
  });

  it("repository 예외는 안전한 store unavailable 오류로 마스킹한다", async () => {
    const service = serviceWithRepository({
      saveDraft: vi.fn().mockRejectedValue(new Error("sensitive database detail")),
    });

    const error = await rejectedError(service.saveDraft(liveConfig()));
    expect(error).toBeInstanceOf(OperationalConfigError);
    expect(error).toMatchObject({
      code: "OPERATIONAL_CONFIG_STORE_UNAVAILABLE",
      kind: "UNAVAILABLE",
    });
    expect(error.message).not.toContain("sensitive");
  });
});

function serviceWithRepository(
  overrides: Partial<Record<keyof PrismaOperationalConfigRepository, ReturnType<typeof vi.fn>>>,
): OperationalConfigService {
  return new OperationalConfigService({
    currentState: vi.fn(),
    saveDraft: vi.fn(),
    activateDraft: vi.fn(),
    saveLivePromotion: vi.fn(),
    ...overrides,
  } as unknown as PrismaOperationalConfigRepository);
}

function storedVersion(id: string) {
  return {
    id,
    version: 1,
    contentHash: "c".repeat(64),
    payload: liveConfig(),
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
  };
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("오류가 발생해야 합니다.");
}
