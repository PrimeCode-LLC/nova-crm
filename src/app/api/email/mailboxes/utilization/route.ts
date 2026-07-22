import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { buildOrgMailboxUtilizationServer } from "@/lib/email/mailbox-utilization-server";
import { summarizeMailboxUtilization } from "@/lib/email/mailbox-utilization";
import type { MailboxUtilizationRow } from "@/lib/email/mailbox-utilization";

const UTILIZATION_CACHE_TTL_MS = 60_000;
const utilizationCache = new Map<
  string,
  {
    expiresAt: number;
    rows: MailboxUtilizationRow[];
    summary: ReturnType<typeof summarizeMailboxUtilization>;
  }
>();

/**
 * Org-wide inbox capacity utilization (owners / admins / managers).
 * Powers the dashboard "Inbox utilization" card + detail dialog.
 */
export async function GET() {
  const g = await guardTenantApi({ minRole: "manager" });
  if (!g.ok) return g.response;

  try {
    const orgId = g.ctx.session.organizationId;
    const hit = utilizationCache.get(orgId);
    if (hit && hit.expiresAt > Date.now()) {
      return NextResponse.json({
        ok: true,
        rows: hit.rows,
        summary: hit.summary,
        generatedAt: new Date(hit.expiresAt - UTILIZATION_CACHE_TTL_MS).toISOString(),
        cached: true,
      });
    }

    const rows = await buildOrgMailboxUtilizationServer({
      organizationId: orgId,
    });
    const summary = summarizeMailboxUtilization(rows);
    utilizationCache.set(orgId, {
      expiresAt: Date.now() + UTILIZATION_CACHE_TTL_MS,
      rows,
      summary,
    });
    if (utilizationCache.size > 100) {
      const now = Date.now();
      for (const [k, v] of utilizationCache) {
        if (v.expiresAt <= now) utilizationCache.delete(k);
      }
    }

    return NextResponse.json({
      ok: true,
      rows,
      summary,
      generatedAt: new Date().toISOString(),
      cached: false,
    });
  } catch (err) {
    console.error("[mailboxes/utilization]", err);
    return NextResponse.json(
      { ok: false, error: "Could not load mailbox utilization" },
      { status: 500 },
    );
  }
}
