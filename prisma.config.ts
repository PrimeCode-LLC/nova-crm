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
 * Migrations need a role that can DDL (local Compose: `nova` superuser).
 * Runtime app queries must use `nova_app` (no BYPASSRLS) so FORCE RLS applies —
 * see `DATABASE_URL` vs `MIGRATE_DATABASE_URL` in docs/ENVIRONMENTS.md.
 *
 * `prisma generate` may run without env files — placeholder is non-connecting.
 */
const databaseUrl =
  process.env.MIGRATE_DATABASE_URL?.trim() ||
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
