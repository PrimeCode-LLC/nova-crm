import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import {
  archiveOrganizationServer,
  getOrganizationServer,
  sanitizeOrganizationForApi,
  updateOrganizationServer,
} from "@/lib/platform/organizations-server";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  slug: z.string().min(1).max(80).optional(),
  status: z.enum(["trial", "active", "suspended", "archived"]).optional(),
  planId: z.enum(["free", "pro", "enterprise"]).optional(),
  maxUsers: z.number().int().positive().max(100_000).nullable().optional(),
  settings: z
    .object({
      billingEmail: z.string().email().optional().or(z.literal("")),
      operatorNotes: z.string().max(5000).optional(),
      /** Empty string clears the per-tenant webhook secret. */
      inboundWebhookSecret: z.string().max(500).optional().or(z.literal("")),
    })
    .optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const { orgId } = await ctx.params;
  const org = await getOrganizationServer(orgId);
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ organization: sanitizeOrganizationForApi(org) });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const { orgId } = await ctx.params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { settings: s, ...rest } = parsed.data;
  const patch = { ...rest } as Parameters<typeof updateOrganizationServer>[1];
  if (s !== undefined) {
    const next: Parameters<typeof updateOrganizationServer>[1]["settings"] = {};
    if ("billingEmail" in s) {
      next.billingEmail = s.billingEmail === "" ? undefined : s.billingEmail;
    }
    if ("operatorNotes" in s) {
      next.operatorNotes =
        s.operatorNotes === "" ? undefined : s.operatorNotes;
    }
    if ("inboundWebhookSecret" in s) {
      // Empty string clears the secret in `updateOrganizationServer` merge logic.
      next.inboundWebhookSecret =
        s.inboundWebhookSecret === "" ? "" : s.inboundWebhookSecret;
    }
    patch.settings = next;
  }

  const result = await updateOrganizationServer(orgId, patch);
  if ("error" in result) {
    const status = result.error === "Organization not found" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const auditEvent =
    parsed.data.status === "suspended"
      ? "org.suspended"
      : parsed.data.status === "archived"
        ? "org.archived"
        : parsed.data.status === "active" || parsed.data.status === "trial"
          ? "org.restored"
          : "org.updated";

  await recordPlatformAudit({
    event: auditEvent,
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetOrgId: orgId,
    summary: `Organization updated${parsed.data.status ? ` → ${parsed.data.status}` : ""}`,
    metadata: { patch: parsed.data },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const { orgId } = await ctx.params;

  const org = await getOrganizationServer(orgId);
  if (!org) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = await archiveOrganizationServer(orgId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPlatformAudit({
    event: "org.archived",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetOrgId: orgId,
    summary: `Archived organization ${org.name || org.slug}`,
  });

  return NextResponse.json({ ok: true, archived: true });
}
