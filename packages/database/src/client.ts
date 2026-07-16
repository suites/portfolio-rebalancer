import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/client/client";

export function createDatabaseClient(runtimeDatabaseUrl: string): PrismaClient {
  if (!runtimeDatabaseUrl) {
    throw new Error("DATABASE_RUNTIME_URL이 없어 PostgreSQL에 연결할 수 없습니다.");
  }
  const adapter = new PrismaPg(
    {
      connectionString: runtimeDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    },
    { schema: "public" },
  );
  return new PrismaClient({ adapter });
}

export type DatabaseClient = PrismaClient;

interface RuntimeDatabaseRoleRow {
  readonly roleName: string;
  readonly sessionRoleName: string;
  readonly isSuperuser: boolean;
  readonly canCreateDatabase: boolean;
  readonly canCreateRole: boolean;
  readonly canReplicate: boolean;
  readonly canBypassRowSecurity: boolean;
  readonly inheritsPrivileges: boolean;
  readonly isRuntimeMember: boolean;
  readonly hasUnexpectedRoleMembership: boolean;
  readonly ownsOrInheritsApplicationObjects: boolean;
  readonly canCreateInPublic: boolean;
  readonly canCreateTemporaryObjects: boolean;
  readonly canUpdateUnapprovedTables: boolean;
  readonly canUpdateBrokerAccountIdentity: boolean;
  readonly canDeleteProtectedTables: boolean;
  readonly canTruncateApplicationTables: boolean;
  readonly canAccessMigrationLedger: boolean;
}

export interface RuntimeDatabaseRoleInspectableClient {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

export async function assertRestrictedRuntimeDatabaseRole(
  database: RuntimeDatabaseRoleInspectableClient,
): Promise<void> {
  const rows = await database.$queryRawUnsafe<readonly RuntimeDatabaseRoleRow[]>(`
    WITH expected_access_role AS (
      SELECT pg_catalog.format(
        'portfolio_rebalancer_runtime_%s',
        pg_catalog.substr(
          pg_catalog.md5(pg_catalog.current_database()),
          1,
          16
        )
      ) AS "roleName"
    )
    SELECT
      CURRENT_USER AS "roleName",
      SESSION_USER AS "sessionRoleName",
      role."rolsuper" AS "isSuperuser",
      role."rolcreatedb" AS "canCreateDatabase",
      role."rolcreaterole" AS "canCreateRole",
      role."rolreplication" AS "canReplicate",
      role."rolbypassrls" AS "canBypassRowSecurity",
      role."rolinherit" AS "inheritsPrivileges",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS access_role
        WHERE access_role."rolname" = expected_access_role."roleName"
          AND pg_catalog.pg_has_role(
            CURRENT_USER,
            access_role."oid",
            'MEMBER'
          )
      ) AS "isRuntimeMember",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS inherited_role
        WHERE inherited_role."rolname" <> CURRENT_USER
          AND inherited_role."rolname" <> expected_access_role."roleName"
          AND pg_catalog.pg_has_role(
            CURRENT_USER,
            inherited_role."oid",
            'MEMBER'
          )
      ) AS "hasUnexpectedRoleMembership",
      (
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS object
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace."oid" = object."relnamespace"
          WHERE namespace."nspname" = 'public'
            AND object."relkind" IN ('r', 'p', 'v', 'm', 'S')
            AND pg_catalog.pg_has_role(
              CURRENT_USER,
              object."relowner",
              'MEMBER'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS function
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace."oid" = function."pronamespace"
          WHERE namespace."nspname" = 'public'
            AND pg_catalog.pg_has_role(
              CURRENT_USER,
              function."proowner",
              'MEMBER'
            )
        )
      ) AS "ownsOrInheritsApplicationObjects",
      pg_catalog.has_schema_privilege(
        CURRENT_USER,
        'public',
        'CREATE'
      ) AS "canCreateInPublic",
      pg_catalog.has_database_privilege(
        CURRENT_USER,
        pg_catalog.current_database(),
        'TEMPORARY'
      ) AS "canCreateTemporaryObjects",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace."oid" = object."relnamespace"
        WHERE namespace."nspname" = 'public'
          AND object."relkind" IN ('r', 'p')
          AND object."relname" NOT IN (
            'broker_account',
            'collection_run',
            'runtime_lease',
            'instrument_catalog',
            'target_config_version',
            'rebalance_run',
            'order_ledger',
            'daily_trade_limit',
            'manual_order_approval',
            'daily_trade_reservation',
            'order_submission_authorization',
            'cancel_operator_authorization',
            'operational_config'
          )
          AND pg_catalog.has_table_privilege(
            CURRENT_USER,
            object."oid",
            'UPDATE'
          )
      ) AS "canUpdateUnapprovedTables",
      (
        pg_catalog.has_table_privilege(
          CURRENT_USER,
          'public.broker_account',
          'UPDATE'
        )
        OR pg_catalog.has_column_privilege(
          CURRENT_USER,
          'public.broker_account',
          'id',
          'UPDATE'
        )
        OR pg_catalog.has_column_privilege(
          CURRENT_USER,
          'public.broker_account',
          'broker',
          'UPDATE'
        )
        OR pg_catalog.has_column_privilege(
          CURRENT_USER,
          'public.broker_account',
          'external_ref_hmac',
          'UPDATE'
        )
        OR pg_catalog.has_column_privilege(
          CURRENT_USER,
          'public.broker_account',
          'first_seen_at',
          'UPDATE'
        )
      ) AS "canUpdateBrokerAccountIdentity",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace."oid" = object."relnamespace"
        WHERE namespace."nspname" = 'public'
          AND object."relkind" IN ('r', 'p')
          AND object."relname" <> 'runtime_lease'
          AND pg_catalog.has_table_privilege(
            CURRENT_USER,
            object."oid",
            'DELETE'
          )
      ) AS "canDeleteProtectedTables",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS object
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace."oid" = object."relnamespace"
        WHERE namespace."nspname" = 'public'
          AND object."relkind" IN ('r', 'p')
          AND pg_catalog.has_table_privilege(
            CURRENT_USER,
            object."oid",
            'TRUNCATE'
          )
      ) AS "canTruncateApplicationTables",
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS migration
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace."oid" = migration."relnamespace"
        WHERE namespace."nspname" = 'public'
          AND migration."relname" = '_prisma_migrations'
          AND (
            pg_catalog.has_table_privilege(
              CURRENT_USER,
              migration."oid",
              'SELECT'
            )
            OR pg_catalog.has_table_privilege(
              CURRENT_USER,
              migration."oid",
              'INSERT'
            )
            OR pg_catalog.has_table_privilege(
              CURRENT_USER,
              migration."oid",
              'UPDATE'
            )
            OR pg_catalog.has_table_privilege(
              CURRENT_USER,
              migration."oid",
              'DELETE'
            )
            OR pg_catalog.has_table_privilege(
              CURRENT_USER,
              migration."oid",
              'TRUNCATE'
            )
          )
      ) AS "canAccessMigrationLedger"
    FROM pg_catalog.pg_roles AS role
    CROSS JOIN expected_access_role
    WHERE role."rolname" = CURRENT_USER
  `);
  const role = rows[0];
  if (!role) {
    throw new Error("DATABASE_RUNTIME_ROLE_UNSAFE:ROLE_NOT_FOUND");
  }

  const unsafeReasons = [
    role.roleName !== role.sessionRoleName ? "SESSION_ROLE_CAN_RESET" : null,
    role.isSuperuser ? "SUPERUSER" : null,
    role.canCreateDatabase ? "CREATEDB" : null,
    role.canCreateRole ? "CREATEROLE" : null,
    role.canReplicate ? "REPLICATION" : null,
    role.canBypassRowSecurity ? "BYPASSRLS" : null,
    !role.inheritsPrivileges ? "NOINHERIT" : null,
    !role.isRuntimeMember ? "RUNTIME_MEMBERSHIP_MISSING" : null,
    role.hasUnexpectedRoleMembership ? "UNEXPECTED_ROLE_MEMBERSHIP" : null,
    role.ownsOrInheritsApplicationObjects ? "OWNS_APPLICATION_OBJECTS" : null,
    role.canCreateInPublic ? "PUBLIC_SCHEMA_CREATE" : null,
    role.canCreateTemporaryObjects ? "TEMPORARY_OBJECTS" : null,
    role.canUpdateUnapprovedTables ? "UNAPPROVED_UPDATE" : null,
    role.canUpdateBrokerAccountIdentity ? "BROKER_ACCOUNT_IDENTITY_UPDATE" : null,
    role.canDeleteProtectedTables ? "PROTECTED_DELETE" : null,
    role.canTruncateApplicationTables ? "TRUNCATE" : null,
    role.canAccessMigrationLedger ? "MIGRATION_LEDGER_ACCESS" : null,
  ].filter((reason): reason is string => reason !== null);

  if (unsafeReasons.length > 0) {
    throw new Error(`DATABASE_RUNTIME_ROLE_UNSAFE:${unsafeReasons.join(",")}`);
  }
}
