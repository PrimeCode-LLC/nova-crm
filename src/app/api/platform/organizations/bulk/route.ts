import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  bulkUpdateOrganizationsServer,
  findUnnamedOrganizationIds,
} from "@/lib/platform/organizations-server";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";

const bulkSchema = z.object({
  action: z.enum(["suspend_unnamed", "archive_unnamed"]),
});

export async function POST(req: Request) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bulkSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const orgIds = await findUnnamedOrganizationIds();
  if (orgIds.length === 0) {
    return NextResponse.json({ updated: 0, orgIds: [], message: "No unnamed workspaces found." });
  }

  const status = parsed.data.action === "archive_unnamed" ? "archived" : "suspended";
  const result = await bulkUpdateOrganizationsServer({ orgIds, status });

  await recordPlatformAudit({
    event: "bulk.action",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    summary: `${parsed.data.action}: ${result.updated} organization(s) set to ${status}`,
    metadata: { action: parsed.data.action, orgIds, errors: result.errors },
  });

  return NextResponse.json({
    updated: result.updated,
    orgIds,
    errors: result.errors,
    status,
  });
}
