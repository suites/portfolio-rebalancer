import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

import { resolveMigrationDatabaseUrl } from "./src/database-url";

loadDotenv({ path: fileURLToPath(new URL(".env.local", import.meta.url)) });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveMigrationDatabaseUrl(process.env),
  },
});
