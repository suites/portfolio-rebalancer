import type { DatabaseClient } from "@portfolio-rebalancer/database";
import {
  OperationalConfigSchema,
  type OperationalConfigContract,
} from "@portfolio-rebalancer/contracts";

type TransactionClient = Parameters<Parameters<DatabaseClient["$transaction"]>[0]>[0];

interface AccountRow {
  readonly id: string;
  readonly external_ref_hmac: string;
}

interface ConfigIdentityRow {
  readonly id: string;
}

interface ConfigVersionRow {
  readonly id: string;
  readonly version: number;
  readonly content_hash: string;
  readonly payload: unknown;
  readonly created_at: Date;
}

interface ActivationRow extends ConfigVersionRow {
  readonly activation_version: number;
}

interface KillSwitchRow {
  readonly state: "ENGAGED" | "DISENGAGED";
}

interface LivePromotionRow {
  readonly id: string;
  readonly version: number;
  readonly state: "GRANTED" | "REVOKED";
  readonly operational_config_version_id: string | null;
}

export interface StoredOperationalConfigVersion {
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
  readonly payload: unknown;
  readonly createdAt: Date;
}

export interface StoredOperationalConfigState {
  readonly account: { readonly id: string; readonly externalRefHmac: string } | null;
  readonly activeVersion: StoredOperationalConfigVersion | null;
  readonly draftVersion: StoredOperationalConfigVersion | null;
  readonly killSwitch: "ENGAGED" | "DISENGAGED" | "UNKNOWN";
  readonly livePromotion: "GRANTED" | "REVOKED" | "UNKNOWN";
  readonly livePromotionConfigVersionId: string | null;
}

export type SaveDraftResult =
  { readonly status: "SAVED" | "UNCHANGED" } | { readonly status: "NO_ACCOUNT" | "CONTENT_REUSED" };

export type ActivateDraftResult =
  | { readonly status: "ACTIVATED" | "ALREADY_ACTIVE" }
  | {
      readonly status: "NO_ACCOUNT" | "DRAFT_NOT_FOUND" | "DRAFT_STALE" | "HASH_MISMATCH";
    };

export type SaveLivePromotionResult =
  | { readonly status: "SAVED" | "UNCHANGED" }
  | {
      readonly status:
        | "NO_ACCOUNT"
        | "ACTIVE_REQUIRED"
        | "INTEGRITY_BLOCKED"
        | "POLICY_BLOCKED"
        | "KILL_SWITCH_BLOCKED"
        | "REVOKE_REQUIRED";
    };

export interface SaveDraftInput {
  readonly schemaVersion: "OPERATIONAL_CONFIG_V1";
  readonly canonicalContent: string;
  readonly contentHash: string;
}

export interface ActivateDraftInput {
  readonly version: number;
  readonly contentHash: string;
  readonly actor: string;
}

export interface SaveLivePromotionInput {
  readonly state: "GRANTED" | "REVOKED";
  readonly reason: string;
  readonly actor: string;
}

export class PrismaOperationalConfigRepository {
  constructor(private readonly database: DatabaseClient) {}

  currentState(): Promise<StoredOperationalConfigState> {
    return this.database.$transaction((transaction) => this.readCurrentState(transaction, false), {
      isolationLevel: "Serializable",
    });
  }

  saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
    return this.database.$transaction(
      async (transaction) => {
        const account = await this.currentAccount(transaction, true);
        if (!account) return { status: "NO_ACCOUNT" } as const;

        const configId = await this.ensureConfigIdentity(transaction, account.id);
        const [latest] = await transaction.$queryRaw<ConfigVersionRow[]>`
          SELECT "id", "version", "content_hash", "payload", "created_at"
          FROM public."operational_config_version"
          WHERE "config_id" = ${configId}::uuid
          ORDER BY "version" DESC
          LIMIT 1
        `;
        if (latest?.content_hash === input.contentHash) {
          return { status: "UNCHANGED" } as const;
        }
        const [reused] = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM public."operational_config_version"
          WHERE "config_id" = ${configId}::uuid
            AND "content_hash" = ${input.contentHash}
          LIMIT 1
        `;
        if (reused) return { status: "CONTENT_REUSED" } as const;

        await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public."operational_config_version" (
            "config_id", "version", "schema_version", "canonical_content",
            "content_hash", "payload"
          ) VALUES (
            ${configId}::uuid,
            ${(latest?.version ?? 0) + 1},
            ${input.schemaVersion},
            ${input.canonicalContent},
            ${input.contentHash},
            ${input.canonicalContent}::jsonb
          )
          RETURNING "id"
        `;
        return { status: "SAVED" } as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  activateDraft(input: ActivateDraftInput): Promise<ActivateDraftResult> {
    return this.database.$transaction(
      async (transaction) => {
        const account = await this.currentAccount(transaction, true);
        if (!account) return { status: "NO_ACCOUNT" } as const;
        const [config] = await transaction.$queryRaw<ConfigIdentityRow[]>`
          SELECT "id"
          FROM public."operational_config"
          WHERE "account_id" = ${account.id}::uuid
          LIMIT 1
        `;
        if (!config) return { status: "DRAFT_NOT_FOUND" } as const;

        const [latest] = await transaction.$queryRaw<ConfigVersionRow[]>`
          SELECT "id", "version", "content_hash", "payload", "created_at"
          FROM public."operational_config_version"
          WHERE "config_id" = ${config.id}::uuid
          ORDER BY "version" DESC
          LIMIT 1
        `;
        if (!latest) return { status: "DRAFT_NOT_FOUND" } as const;
        const [active] = await this.activeVersion(transaction, config.id);
        if (active?.id === latest.id) {
          if (latest.version === input.version && latest.content_hash === input.contentHash) {
            return { status: "ALREADY_ACTIVE" } as const;
          }
          return { status: "DRAFT_NOT_FOUND" } as const;
        }
        if (latest.version !== input.version) return { status: "DRAFT_STALE" } as const;
        if (latest.content_hash !== input.contentHash) {
          return { status: "HASH_MISMATCH" } as const;
        }

        const [activationVersion] = await transaction.$queryRaw<Array<{ version: number }>>`
          SELECT "version"
          FROM public."operational_config_activation"
          WHERE "config_id" = ${config.id}::uuid
          ORDER BY "version" DESC
          LIMIT 1
        `;
        await transaction.$queryRaw<Array<{ id: string }>>`
          INSERT INTO public."operational_config_activation" (
            "config_id", "version", "operational_config_version_id", "actor",
            "confirmation_version"
          ) VALUES (
            ${config.id}::uuid,
            ${(activationVersion?.version ?? 0) + 1},
            ${latest.id}::uuid,
            ${input.actor},
            'OPERATIONAL_CONFIG_ACTIVATION_V1'
          )
          RETURNING "id"
        `;
        return { status: "ACTIVATED" } as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  saveLivePromotion(input: SaveLivePromotionInput): Promise<SaveLivePromotionResult> {
    return this.database.$transaction(
      async (transaction) => {
        const account = await this.currentAccount(transaction, true);
        if (!account) return { status: "NO_ACCOUNT" } as const;
        const [config] = await transaction.$queryRaw<ConfigIdentityRow[]>`
          SELECT "id"
          FROM public."operational_config"
          WHERE "account_id" = ${account.id}::uuid
          LIMIT 1
        `;
        if (!config) return { status: "ACTIVE_REQUIRED" } as const;
        const [active] = await this.activeVersion(transaction, config.id);
        if (!active) return { status: "ACTIVE_REQUIRED" } as const;

        const parsed = OperationalConfigSchema.safeParse(active.payload);
        if (!parsed.success) return { status: "INTEGRITY_BLOCKED" } as const;
        const policy = parsed.data;
        const [killSwitch] = await transaction.$queryRaw<KillSwitchRow[]>`
          SELECT "state"::text AS "state"
          FROM public."kill_switch_event"
          WHERE "account_id" = ${account.id}::uuid
          ORDER BY "version" DESC
          LIMIT 1
        `;
        const [promotion] = await transaction.$queryRaw<LivePromotionRow[]>`
          SELECT "id", "version", "state"::text AS "state",
            "operational_config_version_id"
          FROM public."live_promotion_event"
          WHERE "account_id" = ${account.id}::uuid
          ORDER BY "version" DESC
          LIMIT 1
        `;

        if (input.state === "GRANTED") {
          if (
            policy.mode !== "LIVE" ||
            !policy.live.enabled ||
            policy.killSwitch ||
            !policy.live.manualApprovalRequired ||
            !policy.live.accountAllowlistHmacs.includes(account.external_ref_hmac)
          ) {
            return { status: "POLICY_BLOCKED" } as const;
          }
          if (killSwitch?.state !== "DISENGAGED") {
            return { status: "KILL_SWITCH_BLOCKED" } as const;
          }
          if (promotion?.state === "GRANTED") {
            return {
              status:
                promotion.operational_config_version_id === active.id
                  ? "UNCHANGED"
                  : "REVOKE_REQUIRED",
            } as const;
          }
        } else if (promotion?.state === "REVOKED") {
          return { status: "UNCHANGED" } as const;
        }

        let nextVersion = (promotion?.version ?? 0) + 1;
        if (!promotion && input.state === "GRANTED") {
          await this.insertPromotion(transaction, {
            account,
            active,
            policy,
            version: nextVersion,
            state: "REVOKED",
            actor: "engine-safety-bootstrap",
            reason: "초기 Live 권한을 안전하게 회수한 상태로 설정합니다.",
          });
          nextVersion += 1;
        }
        await this.insertPromotion(transaction, {
          account,
          active,
          policy,
          version: nextVersion,
          state: input.state,
          actor: input.actor,
          reason: input.reason,
        });
        return { status: "SAVED" } as const;
      },
      { isolationLevel: "Serializable" },
    );
  }

  private async readCurrentState(
    transaction: TransactionClient,
    lockAccount: boolean,
  ): Promise<StoredOperationalConfigState> {
    const account = await this.currentAccount(transaction, lockAccount);
    if (!account) return emptyStoredState();
    const [config] = await transaction.$queryRaw<ConfigIdentityRow[]>`
      SELECT "id"
      FROM public."operational_config"
      WHERE "account_id" = ${account.id}::uuid
      LIMIT 1
    `;
    const [killSwitch] = await transaction.$queryRaw<KillSwitchRow[]>`
      SELECT "state"::text AS "state"
      FROM public."kill_switch_event"
      WHERE "account_id" = ${account.id}::uuid
      ORDER BY "version" DESC
      LIMIT 1
    `;
    const [promotion] = await transaction.$queryRaw<LivePromotionRow[]>`
      SELECT "id", "version", "state"::text AS "state",
        "operational_config_version_id"
      FROM public."live_promotion_event"
      WHERE "account_id" = ${account.id}::uuid
      ORDER BY "version" DESC
      LIMIT 1
    `;
    if (!config) {
      return {
        account: { id: account.id, externalRefHmac: account.external_ref_hmac },
        activeVersion: null,
        draftVersion: null,
        killSwitch: killSwitch?.state ?? "UNKNOWN",
        livePromotion: promotion?.state ?? "UNKNOWN",
        livePromotionConfigVersionId: promotion?.operational_config_version_id ?? null,
      };
    }
    const [[latest], [active]] = await Promise.all([
      transaction.$queryRaw<ConfigVersionRow[]>`
        SELECT "id", "version", "content_hash", "payload", "created_at"
        FROM public."operational_config_version"
        WHERE "config_id" = ${config.id}::uuid
        ORDER BY "version" DESC
        LIMIT 1
      `,
      this.activeVersion(transaction, config.id),
    ]);
    return {
      account: { id: account.id, externalRefHmac: account.external_ref_hmac },
      activeVersion: active ? storedVersion(active) : null,
      draftVersion: latest && latest.id !== active?.id ? storedVersion(latest) : null,
      killSwitch: killSwitch?.state ?? "UNKNOWN",
      livePromotion: promotion?.state ?? "UNKNOWN",
      livePromotionConfigVersionId: promotion?.operational_config_version_id ?? null,
    };
  }

  private currentAccount(
    transaction: TransactionClient,
    lock: boolean,
  ): Promise<AccountRow | null> {
    return this.queryCurrentAccount(transaction, lock).then(([account]) => account ?? null);
  }

  private queryCurrentAccount(
    transaction: TransactionClient,
    lock: boolean,
  ): Promise<AccountRow[]> {
    if (lock) {
      return transaction.$queryRaw<AccountRow[]>`
        SELECT account."id", account."external_ref_hmac"
        FROM public."collection_run" AS collection
        JOIN public."broker_account" AS account ON account."id" = collection."account_id"
        ORDER BY collection."started_at" DESC, collection."id" DESC
        LIMIT 1
        FOR UPDATE OF account
      `;
    }
    return transaction.$queryRaw<AccountRow[]>`
      SELECT account."id", account."external_ref_hmac"
      FROM public."collection_run" AS collection
      JOIN public."broker_account" AS account ON account."id" = collection."account_id"
      ORDER BY collection."started_at" DESC, collection."id" DESC
      LIMIT 1
    `;
  }

  private async ensureConfigIdentity(
    transaction: TransactionClient,
    accountId: string,
  ): Promise<string> {
    const [existing] = await transaction.$queryRaw<ConfigIdentityRow[]>`
      SELECT "id"
      FROM public."operational_config"
      WHERE "account_id" = ${accountId}::uuid
      LIMIT 1
    `;
    if (existing) return existing.id;
    const [created] = await transaction.$queryRaw<ConfigIdentityRow[]>`
      INSERT INTO public."operational_config" ("account_id")
      VALUES (${accountId}::uuid)
      RETURNING "id"
    `;
    if (!created) throw new Error("OPERATIONAL_CONFIG_IDENTITY_NOT_CREATED");
    return created.id;
  }

  private activeVersion(
    transaction: TransactionClient,
    configId: string,
  ): Promise<ActivationRow[]> {
    return transaction.$queryRaw<ActivationRow[]>`
      SELECT version."id", version."version", version."content_hash", version."payload",
        version."created_at", activation."version" AS "activation_version"
      FROM public."operational_config_activation" AS activation
      JOIN public."operational_config_version" AS version
        ON version."id" = activation."operational_config_version_id"
      WHERE activation."config_id" = ${configId}::uuid
      ORDER BY activation."version" DESC
      LIMIT 1
    `;
  }

  private insertPromotion(
    transaction: TransactionClient,
    input: {
      readonly account: AccountRow;
      readonly active: ConfigVersionRow;
      readonly policy: OperationalConfigContract;
      readonly version: number;
      readonly state: "GRANTED" | "REVOKED";
      readonly actor: string;
      readonly reason: string;
    },
  ): Promise<Array<{ id: string }>> {
    return transaction.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public."live_promotion_event" (
        "account_id", "version", "state", "operational_config_sha256",
        "operational_config_version_id", "account_allowlist_hmac",
        "max_single_order_gross_minor", "max_daily_gross_minor",
        "tiny_live_max_gross_minor", "actor", "reason"
      ) VALUES (
        ${input.account.id}::uuid,
        ${input.version},
        ${input.state}::public."LivePromotionState",
        ${input.active.content_hash},
        ${input.active.id}::uuid,
        ${input.account.external_ref_hmac},
        ${BigInt(input.policy.live.maxSingleOrderGrossMinor)},
        ${BigInt(input.policy.live.maxDailyGrossMinor)},
        ${BigInt(input.policy.live.tinyLiveMaxGrossMinor)},
        ${input.actor},
        ${input.reason}
      )
      RETURNING "id"
    `;
  }
}

function storedVersion(row: ConfigVersionRow): StoredOperationalConfigVersion {
  return {
    id: row.id,
    version: row.version,
    contentHash: row.content_hash,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

function emptyStoredState(): StoredOperationalConfigState {
  return {
    account: null,
    activeVersion: null,
    draftVersion: null,
    killSwitch: "UNKNOWN",
    livePromotion: "UNKNOWN",
    livePromotionConfigVersionId: null,
  };
}
