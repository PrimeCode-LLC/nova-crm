import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPermissionAction } from "@/lib/platform/guard-admin-feature";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { isDatabaseConfigured } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/documents/audit";

export const runtime = "nodejs";

const bodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const g = await guardPermissionAction("outreach_lab.start_experiment", {
    orAdminFeature: "outreach_lab",
  });
  if (!g.ok) return g.response;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id: experimentId } = await ctx.params;
  let json: unknown = {};
  try {
    json = await req.json();
  } catch {
    /* empty ok */
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const reason = parsed.data.reason ?? "stopped_from_lab";

  const updated = await withOrganizationScope(orgId, async (tx) => {
    const exp = await tx.experiment.findFirst({
      where: { id: experimentId, organizationId: orgId },
    });
    if (!exp) return null;
    if (exp.status !== "running" && exp.status !== "draft") {
      return { already: true as const, status: exp.status };
    }
    await tx.experiment.update({
      where: { id: experimentId },
      data: {
        status: "stopped",
        stoppedAt: new Date(),
        stopReason: reason,
      },
    });
    return { already: false as const, status: "stopped" as const };
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  void recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "outreach.experiment_stopped",
    meta: { experimentId, reason },
  });

  return NextResponse.json({ ok: true, ...updated });
}
