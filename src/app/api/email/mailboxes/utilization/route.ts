import { NextResponse } from "next/server";
import { guardTenantApi, roleAtLeast } from "@/lib/platform/tenant-api-guard";
import { buildOrgMailboxUtilizationServer } from "@/lib/email/mailbox-utilization-server";
import {
  filterMailboxUtilizationForViewer,
  summarizeMailboxUtilization,
  type MailboxUtilizationRow,
} from "@/lib/email/mailbox-utilization";

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
 * Inbox capacity utilization.
 * - Managers / admins / owners: org-wide rows
 * - Members (salespeople): only mailboxes they own or are assigned to
 *
 * Powers the dashboard "Inbox utilization" card + detail dialog.
 */
export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  try {
    const orgId = g.ctx.session.organizationId;
    const viewerUid = g.ctx.session.uid;
    const canViewOrgWide = roleAtLeast(g.ctx.role, "manager");

    const hit = utilizationCache.get(orgId);
    let rows: MailboxUtilizationRow[];
    let generatedAt: string;
    let cached: boolean;

    if (hit && hit.expiresAt > Date.now()) {
      rows = hit.rows;
      generatedAt = new Date(hit.expiresAt - UTILIZATION_CACHE_TTL_MS).toISOString();
      cached = true;
    } else {
      rows = await buildOrgMailboxUtilizationServer({
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
      generatedAt = new Date().toISOString();
      cached = false;
    }

    const scopedRows = canViewOrgWide
      ? rows
      : filterMailboxUtilizationForViewer(rows, viewerUid);
    const summary = summarizeMailboxUtilization(scopedRows);

    return NextResponse.json({
      ok: true,
      scope: canViewOrgWide ? "org" : "mine",
      rows: scopedRows,
      summary,
      generatedAt,
      cached,
    });
  } catch (err) {
    console.error("[mailboxes/utilization]", err);
    return NextResponse.json(
      { ok: false, error: "Could not load mailbox utilization" },
      { status: 500 },
    );
  }
}
