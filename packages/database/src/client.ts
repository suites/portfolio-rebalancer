import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/client/client";

export function createDatabaseClient(databaseUrl: string): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL이 없어 PostgreSQL에 연결할 수 없습니다.");
  }
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    },
    { schema: "public" },
  );
  return new PrismaClient({ adapter });
}

export type DatabaseClient = PrismaClient;
