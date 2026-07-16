const LOCAL_MIGRATION_DATABASE_URL =
  "postgresql://portfolio:portfolio_local@127.0.0.1:15432/portfolio_rebalancer";
const LOCAL_RUNTIME_DATABASE_URL =
  "postgresql://portfolio_runtime:portfolio_runtime_local@127.0.0.1:15432/portfolio_rebalancer";

export function resolveMigrationDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return (
    environment.DATABASE_URL ??
    environment.POSTGRES_URL_NON_POOLING ??
    environment.DATABASE_DIRECT_URL ??
    LOCAL_MIGRATION_DATABASE_URL
  );
}

export function resolveRuntimeDatabaseUrl(environment: NodeJS.ProcessEnv): string | undefined {
  return (
    environment.DATABASE_RUNTIME_URL ??
    (environment.VERCEL === "1" ? undefined : LOCAL_RUNTIME_DATABASE_URL)
  );
}

export function databaseRoleName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const username = decodeURIComponent(parsed.username);
  if (!username) {
    throw new Error("데이터베이스 URL에 역할 이름이 없습니다.");
  }
  return username.split(".", 1)[0]!;
}

export function assertSeparatedDatabaseRoles(
  migrationDatabaseUrl: string,
  runtimeDatabaseUrl: string,
): void {
  const migrationRole = databaseRoleName(migrationDatabaseUrl);
  const runtimeRole = databaseRoleName(runtimeDatabaseUrl);
  if (migrationRole === runtimeRole) {
    throw new Error("DATABASE_RUNTIME_URL은 migration 역할과 다른 제한 역할이어야 합니다.");
  }
}
