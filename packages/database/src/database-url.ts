const LOCAL_DATABASE_URL =
  "postgresql://portfolio:portfolio_local@127.0.0.1:15432/portfolio_rebalancer";

export function resolveMigrationDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return (
    environment.POSTGRES_URL_NON_POOLING ??
    environment.DATABASE_DIRECT_URL ??
    environment.POSTGRES_PRISMA_URL ??
    environment.DATABASE_URL ??
    LOCAL_DATABASE_URL
  );
}
