import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { findLeadIdsByContactEmailsPostgres } from "@/lib/db/list-crm-postgres";
import { normalizeWorkspaceEmail } from "@/lib/crm-dedupe";

/**
 * Phase 4 — resolve lead id(s) from email(s) without a full workspace snapshot.
 * POST { emails: string[] } → { byEmail: Record<string, string> }
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let body: { emails?: unknown };
  try {
    body = (await req.json()) as { emails?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emails = Array.isArray(body.emails)
    ? body.emails
        .filter((e): e is string => typeof e === "string")
        .map(normalizeWorkspaceEmail)
        .filter(Boolean)
        .slice(0, 100)
    : [];

  if (emails.length === 0) {
    return NextResponse.json({ error: "emails required" }, { status: 400 });
  }

  const map = await findLeadIdsByContactEmailsPostgres(
    g.ctx.session.organizationId,
    emails,
  );
  const byEmail: Record<string, string> = {};
  for (const [k, v] of map) byEmail[k] = v;
  return NextResponse.json({ ok: true, byEmail });
}
