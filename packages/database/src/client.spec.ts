import { describe, expect, it, vi } from "vitest";

import {
  assertRestrictedRuntimeDatabaseRole,
  type RuntimeDatabaseRoleInspectableClient,
} from "./client";

describe("runtime database role verification", () => {
  it("제한 runtime group만 상속하고 객체를 소유하지 않는 역할을 허용한다", async () => {
    const client = inspectableClient({
      roleName: "portfolio_runtime",
      sessionRoleName: "portfolio_runtime",
      isSuperuser: false,
      canCreateDatabase: false,
      canCreateRole: false,
      canReplicate: false,
      canBypassRowSecurity: false,
      inheritsPrivileges: true,
      isRuntimeMember: true,
      hasUnexpectedRoleMembership: false,
      ownsOrInheritsApplicationObjects: false,
      canCreateInPublic: false,
      canCreateTemporaryObjects: false,
      canUpdateUnapprovedTables: false,
      canUpdateBrokerAccountIdentity: false,
      canDeleteProtectedTables: false,
      canTruncateApplicationTables: false,
      canAccessMigrationLedger: false,
    });

    await expect(assertRestrictedRuntimeDatabaseRole(client)).resolves.toBeUndefined();
  });

  it.each([
    ["owner session으로 SET ROLE만 한 연결", { sessionRoleName: "portfolio" }],
    ["superuser", { isSuperuser: true }],
    ["role 생성 권한", { canCreateRole: true }],
    ["예상하지 않은 role 상속", { hasUnexpectedRoleMembership: true }],
    ["application object 소유권", { ownsOrInheritsApplicationObjects: true }],
    ["public schema CREATE", { canCreateInPublic: true }],
    ["allowlist 밖 UPDATE", { canUpdateUnapprovedTables: true }],
    ["broker account identity UPDATE", { canUpdateBrokerAccountIdentity: true }],
    ["보호 테이블 DELETE", { canDeleteProtectedTables: true }],
    ["TRUNCATE 권한", { canTruncateApplicationTables: true }],
    ["Prisma migration ledger 접근", { canAccessMigrationLedger: true }],
  ])("%s을 fail closed로 거부한다", async (_name, override) => {
    const client = inspectableClient({
      roleName: "portfolio_runtime",
      sessionRoleName: "portfolio_runtime",
      isSuperuser: false,
      canCreateDatabase: false,
      canCreateRole: false,
      canReplicate: false,
      canBypassRowSecurity: false,
      inheritsPrivileges: true,
      isRuntimeMember: true,
      hasUnexpectedRoleMembership: false,
      ownsOrInheritsApplicationObjects: false,
      canCreateInPublic: false,
      canCreateTemporaryObjects: false,
      canUpdateUnapprovedTables: false,
      canUpdateBrokerAccountIdentity: false,
      canDeleteProtectedTables: false,
      canTruncateApplicationTables: false,
      canAccessMigrationLedger: false,
      ...override,
    });

    await expect(assertRestrictedRuntimeDatabaseRole(client)).rejects.toThrow(
      "DATABASE_RUNTIME_ROLE_UNSAFE",
    );
  });
});

function inspectableClient(
  row: Record<string, boolean | string>,
): RuntimeDatabaseRoleInspectableClient {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([row]),
  };
}
