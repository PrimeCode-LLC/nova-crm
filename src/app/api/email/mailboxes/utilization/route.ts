import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { buildOrgMailboxUtilizationServer } from "@/lib/email/mailbox-utilization-server";
import { summarizeMailboxUtilization } from "@/lib/email/mailbox-utilization";

/**
 * Org-wide inbox capacity utilization (owners / admins / managers).
 * Powers the dashboard "Inbox utilization" card + detail dialog.
 */
export async function GET() {
  const g = await guardTenantApi({ minRole: "manager" });
  if (!g.ok) return g.response;

  try {
    const rows = await buildOrgMailboxUtilizationServer({
      organizationId: g.ctx.session.organizationId,
    });
    return NextResponse.json({
      ok: true,
      rows,
      summary: summarizeMailboxUtilization(rows),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[mailboxes/utilization]", err);
    return NextResponse.json(
      { ok: false, error: "Could not load mailbox utilization" },
      { status: 500 },
    );
  }
}
