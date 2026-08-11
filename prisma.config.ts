/**
 * Prisma CLI config (Prisma 7+).
 * Datasource URL lives here — not in schema.prisma.
 * Loads `.env` then `.env.local` (Next convention; local overrides).
 */
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv();
loadEnv({ path: ".env.local", override: true });

/**
 * Real `DATABASE_URL` is required for migrate/deploy and runtime.
 * `prisma generate` (postinstall / CI without env files) only needs a syntactically
 * valid URL — it does not open a connection. Placeholder keeps generate green.
 */
const databaseUrl =
  process.env.DATABASE_URL?.trim() ||
  "postgresql://prisma:prisma@127.0.0.1:5432/prisma_generate_placeholder?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
