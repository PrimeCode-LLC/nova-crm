/**
 * Safety gate for prospect imports in development.
 *
 * Postgres is the DB of record. Local Compose Postgres is fine.
 * Block only when development points at a remote DATABASE_URL
 * (accidental staging/prod credentials on a laptop).
 */

function isLocalDatabaseHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    // Compose service name when the app runs on the docker network
    host === "postgres"
  );
}

export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  const raw = databaseUrl.trim();
  if (!raw) return false;
  try {
    const normalized = raw.replace(/^postgresql:/i, "postgres:");
    const url = new URL(normalized);
    return isLocalDatabaseHost(url.hostname);
  } catch {
    return /@(localhost|127\.0\.0\.1|\[::1\]|postgres)[:/]/i.test(raw);
  }
}

export function getUnsafeLocalImportError(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.ALLOW_LIVE_IMPORTS_IN_DEVELOPMENT === "true") return null;

  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.trim()) {
    return "DATABASE_URL is not configured. Start Compose Postgres (`docker compose up -d postgres redis`) and set DATABASE_URL (see .env.example).";
  }

  if (isLocalDatabaseUrl(databaseUrl)) return null;

  return "Imports are disabled against a remote database during local development. Point DATABASE_URL at local Compose Postgres (localhost), or set ALLOW_LIVE_IMPORTS_IN_DEVELOPMENT=true only if you intentionally accept that risk.";
}
