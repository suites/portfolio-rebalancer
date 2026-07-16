import { describe, expect, it, vi } from "vitest";

import type { DatabaseClient } from "@portfolio-rebalancer/database";

import { liveConfig } from "../../testing/operational-config.fixture";
import { PrismaOperationalConfigRepository } from "./prisma-operational-config.repository";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";
const CONFIG_ID = "10000000-0000-4000-8000-000000000002";
const VERSION_ID = "10000000-0000-4000-8000-000000000003";
const ACCOUNT_HMAC = "a".repeat(64);

describe("PrismaOperationalConfigRepository", () => {
  it("current account의 latest version, activation, kill switch와 promotion을 한 snapshot으로 읽는다", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{ id: CONFIG_ID }])
      .mockResolvedValueOnce([{ state: "DISENGAGED" }])
      .mockResolvedValueOnce([
        {
          id: "10000000-0000-4000-8000-000000000004",
          version: 2,
          state: "GRANTED",
          operational_config_version_id: VERSION_ID,
        },
      ])
      .mockResolvedValueOnce([versionRow(VERSION_ID, 2)])
      .mockResolvedValueOnce([{ ...versionRow(VERSION_ID, 2), activation_version: 1 }]);
    const repository = repositoryWithQuery(query);

    await expect(repository.currentState()).resolves.toEqual({
      account: { id: ACCOUNT_ID, externalRefHmac: ACCOUNT_HMAC },
      activeVersion: {
        id: VERSION_ID,
        version: 2,
        contentHash: "c".repeat(64),
        payload: liveConfig(),
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
      },
      draftVersion: null,
      killSwitch: "DISENGAGED",
      livePromotion: "GRANTED",
      livePromotionConfigVersionId: VERSION_ID,
    });
  });

  it("draft를 계좌 잠금 아래 연속 version과 canonical payload로 추가한다", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{ id: CONFIG_ID }])
      .mockResolvedValueOnce([versionRow(VERSION_ID, 1)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "10000000-0000-4000-8000-000000000005" }]);
    const repository = repositoryWithQuery(query);
    const canonicalContent = JSON.stringify(liveConfig());

    await expect(
      repository.saveDraft({
        schemaVersion: "OPERATIONAL_CONFIG_V1",
        canonicalContent,
        contentHash: "d".repeat(64),
      }),
    ).resolves.toEqual({ status: "SAVED" });
    expect(query).toHaveBeenCalledTimes(5);
    expect(rawValues(query, 4)).toEqual([
      CONFIG_ID,
      2,
      "OPERATIONAL_CONFIG_V1",
      canonicalContent,
      "d".repeat(64),
      canonicalContent,
    ]);
  });

  it("activation 요청의 version과 hash가 latest draft에 정확히 일치할 때만 append한다", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{ id: CONFIG_ID }])
      .mockResolvedValueOnce([versionRow(VERSION_ID, 2)])
      .mockResolvedValueOnce([
        { ...versionRow("10000000-0000-4000-8000-000000000006", 1), activation_version: 1 },
      ])
      .mockResolvedValueOnce([{ version: 1 }])
      .mockResolvedValueOnce([{ id: "10000000-0000-4000-8000-000000000007" }]);
    const repository = repositoryWithQuery(query);

    await expect(
      repository.activateDraft({
        version: 2,
        contentHash: "c".repeat(64),
        actor: "engine-service-api",
      }),
    ).resolves.toEqual({ status: "ACTIVATED" });
    expect(rawValues(query, 5)).toEqual([CONFIG_ID, 2, VERSION_ID, "engine-service-api"]);
  });

  it("최초 GRANTED는 REVOKED 안전 기준점을 먼저 남기고 exact account/limits로 승격한다", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{ id: CONFIG_ID }])
      .mockResolvedValueOnce([{ ...versionRow(VERSION_ID, 1), activation_version: 1 }])
      .mockResolvedValueOnce([{ state: "DISENGAGED" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "10000000-0000-4000-8000-000000000008" }])
      .mockResolvedValueOnce([{ id: "10000000-0000-4000-8000-000000000009" }]);
    const repository = repositoryWithQuery(query);

    await expect(
      repository.saveLivePromotion({
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        actor: "engine-service-api",
      }),
    ).resolves.toEqual({ status: "SAVED" });
    expect(rawValues(query, 5)).toEqual([
      ACCOUNT_ID,
      1,
      "REVOKED",
      "c".repeat(64),
      VERSION_ID,
      ACCOUNT_HMAC,
      100_000n,
      300_000n,
      50_000n,
      "engine-safety-bootstrap",
      "초기 Live 권한을 안전하게 회수한 상태로 설정합니다.",
    ]);
    expect(rawValues(query, 6)).toEqual([
      ACCOUNT_ID,
      2,
      "GRANTED",
      "c".repeat(64),
      VERSION_ID,
      ACCOUNT_HMAC,
      100_000n,
      300_000n,
      50_000n,
      "engine-service-api",
      "Paper 검증과 현재 계좌를 다시 확인했습니다.",
    ]);
  });

  it("킬 스위치가 확인되지 않으면 GRANTED event를 만들지 않는다", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([accountRow()])
      .mockResolvedValueOnce([{ id: CONFIG_ID }])
      .mockResolvedValueOnce([{ ...versionRow(VERSION_ID, 1), activation_version: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const repository = repositoryWithQuery(query);

    await expect(
      repository.saveLivePromotion({
        state: "GRANTED",
        reason: "Paper 검증과 현재 계좌를 다시 확인했습니다.",
        actor: "engine-service-api",
      }),
    ).resolves.toEqual({ status: "KILL_SWITCH_BLOCKED" });
    expect(query).toHaveBeenCalledTimes(5);
  });
});

function repositoryWithQuery(query: ReturnType<typeof vi.fn>): PrismaOperationalConfigRepository {
  type TransactionCallback = (transaction: { $queryRaw: typeof query }) => unknown;
  const transaction = { $queryRaw: query };
  const database = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: TransactionCallback) =>
        Promise.resolve(callback(transaction)),
      ),
  } as unknown as DatabaseClient;
  return new PrismaOperationalConfigRepository(database);
}

function rawValues(query: ReturnType<typeof vi.fn>, call: number): unknown[] {
  return query.mock.calls[call]?.slice(1) ?? [];
}

function accountRow() {
  return { id: ACCOUNT_ID, external_ref_hmac: ACCOUNT_HMAC };
}

function versionRow(id: string, version: number) {
  return {
    id,
    version,
    content_hash: "c".repeat(64),
    payload: liveConfig(),
    created_at: new Date("2026-07-17T00:00:00.000Z"),
  };
}
