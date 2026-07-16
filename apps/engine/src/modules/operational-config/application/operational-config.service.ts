import { Inject, Injectable } from "@nestjs/common";

import {
  ActivateOperationalConfigDraftInputSchema,
  LivePromotionCommandSchema,
  OperationalConfigSchema,
  OperationalConfigSnapshotSchema,
  SaveOperationalConfigDraftInputSchema,
  SaveCurrentAccountOperationalConfigDraftInputSchema,
  type ActivateOperationalConfigDraftInputContract,
  type LivePromotionCommandContract,
  type OperationalConfigSnapshotContract,
  type OperationalConfigVersionContract,
  type SaveCurrentAccountOperationalConfigDraftInputContract,
  type SaveOperationalConfigDraftInputContract,
} from "@portfolio-rebalancer/contracts";

import { OperationalConfigError } from "../domain/operational-config.error";
import {
  PrismaOperationalConfigRepository,
  type StoredOperationalConfigState,
  type StoredOperationalConfigVersion,
} from "../infrastructure/persistence/prisma-operational-config.repository";
import { canonicalizeOperationalConfig } from "./operational-config-canonical";

const SERVICE_ACTOR = "engine-service-api";

@Injectable()
export class OperationalConfigService {
  constructor(
    @Inject(PrismaOperationalConfigRepository)
    private readonly repository: PrismaOperationalConfigRepository,
  ) {}

  async current(): Promise<OperationalConfigSnapshotContract> {
    try {
      return presentSnapshot(await this.repository.currentState());
    } catch {
      return unavailableSnapshot();
    }
  }

  async saveDraft(
    input: SaveOperationalConfigDraftInputContract,
  ): Promise<OperationalConfigSnapshotContract> {
    const parsed = SaveOperationalConfigDraftInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OperationalConfigError(
        "OPERATIONAL_CONFIG_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "운영 설정 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const canonical = canonicalizeOperationalConfig(parsed.data);
    const result = await this.storeCall(() =>
      this.repository.saveDraft({
        schemaVersion: canonical.config.schemaVersion,
        canonicalContent: canonical.canonicalContent,
        contentHash: canonical.contentHash,
      }),
    );
    if (result.status === "NO_ACCOUNT") {
      throw accountMissingError();
    }
    if (result.status === "CONTENT_REUSED") {
      throw new OperationalConfigError(
        "OPERATIONAL_CONFIG_CONTENT_REUSED",
        "동일한 운영 설정이 이전 버전에 이미 봉인되어 있습니다. 기존 버전을 덮어쓰지 않았습니다.",
        "CONFLICT",
      );
    }
    return this.currentAfterWrite();
  }

  async saveCurrentAccountDraft(
    input: SaveCurrentAccountOperationalConfigDraftInputContract,
  ): Promise<OperationalConfigSnapshotContract> {
    const parsed = SaveCurrentAccountOperationalConfigDraftInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OperationalConfigError(
        "OPERATIONAL_CONFIG_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "현재 계좌 운영 설정 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const state = await this.storeCall(() => this.repository.currentState());
    if (!state.account) throw accountMissingError();
    const config = currentAccountConfig(parsed.data.config, state.account.externalRefHmac);
    return this.saveDraft(config);
  }

  async activateDraft(
    input: ActivateOperationalConfigDraftInputContract,
  ): Promise<OperationalConfigSnapshotContract> {
    const parsed = ActivateOperationalConfigDraftInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new OperationalConfigError(
        "OPERATIONAL_CONFIG_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "적용할 운영 설정 버전과 해시를 확인하세요.",
        "BAD_REQUEST",
      );
    }
    const result = await this.storeCall(() =>
      this.repository.activateDraft({
        version: parsed.data.version,
        contentHash: parsed.data.contentHash,
        actor: SERVICE_ACTOR,
      }),
    );
    switch (result.status) {
      case "ACTIVATED":
      case "ALREADY_ACTIVE":
        return this.currentAfterWrite();
      case "NO_ACCOUNT":
        throw accountMissingError();
      case "DRAFT_NOT_FOUND":
        throw new OperationalConfigError(
          "OPERATIONAL_CONFIG_DRAFT_NOT_FOUND",
          "적용할 최신 운영 설정 초안을 찾지 못했습니다. 설정과 주문 상태는 변경되지 않았습니다.",
          "CONFLICT",
        );
      case "DRAFT_STALE":
        throw new OperationalConfigError(
          "OPERATIONAL_CONFIG_DRAFT_STALE",
          "요청한 뒤 더 최신 운영 설정 초안이 저장되었습니다. 최신 버전을 다시 확인하세요.",
          "CONFLICT",
        );
      case "HASH_MISMATCH":
        throw new OperationalConfigError(
          "OPERATIONAL_CONFIG_HASH_MISMATCH",
          "확인한 운영 설정 해시가 저장된 최신 초안과 일치하지 않아 적용을 차단했습니다.",
          "CONFLICT",
        );
    }
  }

  async saveLivePromotion(
    input: LivePromotionCommandContract,
    actor: string = SERVICE_ACTOR,
  ): Promise<OperationalConfigSnapshotContract> {
    const parsed = LivePromotionCommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new OperationalConfigError(
        "OPERATIONAL_CONFIG_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "Live 승격 입력이 올바르지 않습니다.",
        "BAD_REQUEST",
      );
    }
    const result = await this.storeCall(() =>
      this.repository.saveLivePromotion({
        state: parsed.data.state,
        reason: parsed.data.reason,
        actor,
      }),
    );
    switch (result.status) {
      case "SAVED":
      case "UNCHANGED":
        return this.currentAfterWrite();
      case "NO_ACCOUNT":
        throw accountMissingError();
      case "ACTIVE_REQUIRED":
        throw new OperationalConfigError(
          "OPERATIONAL_CONFIG_ACTIVE_REQUIRED",
          "Live 권한을 변경하려면 먼저 최신 운영 설정 초안을 활성화해야 합니다.",
          "CONFLICT",
        );
      case "INTEGRITY_BLOCKED":
        throw new OperationalConfigError(
          "OPERATIONAL_CONFIG_INTEGRITY_BLOCKED",
          "활성 운영 설정을 계약대로 검증하지 못해 Live 권한 변경을 차단했습니다.",
          "UNAVAILABLE",
        );
      case "POLICY_BLOCKED":
        throw new OperationalConfigError(
          "LIVE_PROMOTION_POLICY_BLOCKED",
          "현재 활성 설정이 LIVE 모드, 수동 승인, 계좌 허용 목록과 극소액 한도를 모두 만족하지 않습니다.",
          "CONFLICT",
        );
      case "KILL_SWITCH_BLOCKED":
        throw new OperationalConfigError(
          "LIVE_PROMOTION_KILL_SWITCH_BLOCKED",
          "현재 킬 스위치가 명시적으로 해제된 상태가 아니므로 Live 승격을 차단했습니다.",
          "CONFLICT",
        );
      case "REVOKE_REQUIRED":
        throw new OperationalConfigError(
          "LIVE_PROMOTION_REVOKE_REQUIRED",
          "이전 운영 설정의 Live 승격이 남아 있습니다. 먼저 Live 권한을 회수한 뒤 새 설정을 승격하세요.",
          "CONFLICT",
        );
    }
  }

  private async currentAfterWrite(): Promise<OperationalConfigSnapshotContract> {
    const snapshot = await this.current();
    if (snapshot.state === "UNAVAILABLE") {
      throw storeUnavailableError();
    }
    return snapshot;
  }

  private async storeCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof OperationalConfigError) throw error;
      throw storeUnavailableError();
    }
  }
}

export function presentSnapshot(
  state: StoredOperationalConfigState,
): OperationalConfigSnapshotContract {
  if (!state.account) {
    return OperationalConfigSnapshotSchema.parse({
      state: "EMPTY",
      activeVersion: null,
      draftVersion: null,
      killSwitch: "UNKNOWN",
      livePromotion: "UNKNOWN",
      liveOrdersEnabled: false,
    });
  }
  const activeVersion = state.activeVersion ? presentVersion(state.activeVersion, "ACTIVE") : null;
  const draftVersion = state.draftVersion ? presentVersion(state.draftVersion, "DRAFT") : null;
  const activeConfig = activeVersion?.config;
  const liveOrdersEnabled = Boolean(
    activeVersion &&
    activeConfig?.mode === "LIVE" &&
    activeConfig.live.enabled &&
    activeConfig.live.accountAllowlistHmacs.includes(state.account.externalRefHmac) &&
    state.killSwitch === "DISENGAGED" &&
    state.livePromotion === "GRANTED" &&
    state.livePromotionConfigVersionId === activeVersion.id,
  );
  return OperationalConfigSnapshotSchema.parse({
    state: activeVersion ? "READY" : "EMPTY",
    activeVersion,
    draftVersion,
    killSwitch: state.killSwitch,
    livePromotion: state.livePromotion,
    liveOrdersEnabled,
  });
}

function presentVersion(
  version: StoredOperationalConfigVersion,
  status: "ACTIVE" | "DRAFT",
): OperationalConfigVersionContract {
  return {
    id: version.id,
    version: version.version,
    status,
    contentHash: version.contentHash,
    createdAt: version.createdAt.toISOString(),
    config: OperationalConfigSchema.parse(version.payload),
  };
}

function unavailableSnapshot(): OperationalConfigSnapshotContract {
  return OperationalConfigSnapshotSchema.parse({
    state: "UNAVAILABLE",
    activeVersion: null,
    draftVersion: null,
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    liveOrdersEnabled: false,
  });
}

function accountMissingError(): OperationalConfigError {
  return new OperationalConfigError(
    "OPERATIONAL_CONFIG_ACCOUNT_MISSING",
    "운영 설정을 저장할 계좌가 없습니다. 먼저 포트폴리오를 새로고침해 계좌 스냅샷을 수집하세요.",
    "CONFLICT",
  );
}

function storeUnavailableError(): OperationalConfigError {
  return new OperationalConfigError(
    "OPERATIONAL_CONFIG_STORE_UNAVAILABLE",
    "운영 설정 원장을 안전하게 확인하지 못했습니다. 설정과 Live 권한은 변경하지 않았습니다.",
    "UNAVAILABLE",
  );
}

function currentAccountConfig(
  input: unknown,
  accountExternalRefHmac: string,
): SaveOperationalConfigDraftInputContract {
  const config = plainRecord(input);
  const live = plainRecord(config.live);
  const shouldAllowCurrentAccount = live.enabled === true || config.mode === "LIVE";
  const parsed = OperationalConfigSchema.safeParse({
    ...config,
    live: {
      ...live,
      accountAllowlistHmacs: shouldAllowCurrentAccount ? [accountExternalRefHmac] : [],
    },
  });
  if (!parsed.success) {
    throw new OperationalConfigError(
      "OPERATIONAL_CONFIG_INPUT_INVALID",
      parsed.error.issues[0]?.message ?? "운영 설정 입력이 올바르지 않습니다.",
      "BAD_REQUEST",
    );
  }
  return parsed.data;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new OperationalConfigError(
      "OPERATIONAL_CONFIG_INPUT_INVALID",
      "운영 설정 구조가 올바르지 않습니다.",
      "BAD_REQUEST",
    );
  }
  return value as Record<string, unknown>;
}
