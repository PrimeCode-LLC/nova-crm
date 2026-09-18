import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import {
  normalizeCompanyDomainKey,
  normalizeWorkspaceEmail,
} from "@/lib/crm-dedupe";
import { contactFromPostgresRow, accountFromPostgresRow } from "@/lib/db/list-crm-postgres";

/**
 * Phase 4 — server-side CRM dedupe (email / domain).
 * POST { email?: string, domain?: string }
 */
export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  let body: { email?: string; domain?: string };
  try {
    body = (await req.json()) as { email?: string; domain?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const email = typeof body.email === "string" ? normalizeWorkspaceEmail(body.email) : "";
  const domain =
    typeof body.domain === "string" ? normalizeCompanyDomainKey(body.domain) : "";

  if (!email && !domain) {
    return NextResponse.json({ error: "email or domain required" }, { status: 400 });
  }

  const result = await withOrganizationScope(orgId, async (tx) => {
    let contact = null;
    let account = null;
    if (email) {
      const row = await tx.contact.findFirst({
        where: {
          organizationId: orgId,
          email: { equals: email, mode: "insensitive" },
        },
      });
      if (row) contact = contactFromPostgresRow(row);
    }
    if (domain) {
      // `normalizeCompanyDomainKey` only strips a scheme, a path/query/fragment,
      // trailing dots, and any local part, so the normalized key is always a
      // substring of the stored value. `contains` is therefore a safe superset
      // prefilter — the exact match still happens via the normalizer below.
      const rows = await tx.account.findMany({
        where: {
          organizationId: orgId,
          domain: { contains: domain, mode: "insensitive" },
        },
        take: 200,
      });
      const match = rows.find(
        (r) => r.domain && normalizeCompanyDomainKey(r.domain) === domain,
      );
      if (match) account = accountFromPostgresRow(match);
    }
    return { contact, account };
  });

  return NextResponse.json({ ok: true, ...result });
}
