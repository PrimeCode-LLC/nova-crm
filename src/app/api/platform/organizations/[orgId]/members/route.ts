import { NextResponse } from "next/server";
import { z } from "zod";
import { guardPlatformApi } from "@/lib/platform/platform-api-guard";
import { listMembersServer, setMemberStatusServer } from "@/lib/platform/members-server";
import { recordPlatformAudit } from "@/lib/platform/platform-audit-server";

const patchSchema = z.object({
  uid: z.string().min(1),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orgId: string }> },
) {
  const g = await guardPlatformApi();
  if (!g.ok) return g.response;
  const { orgId } = await ctx.params;
  const members = await listMembersServer(orgId);
  return NextResponse.json({ members });
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

  if (!parsed.data.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const result = await setMemberStatusServer(orgId, parsed.data.uid, parsed.data.status);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await recordPlatformAudit({
    event: parsed.data.status === "disabled" ? "member.disabled" : "member.enabled",
    actorUid: g.ctx.session.uid,
    actorEmail: g.ctx.session.email,
    targetOrgId: orgId,
    targetUid: parsed.data.uid,
    summary: `Member ${parsed.data.uid} set to ${parsed.data.status}`,
  });

  return NextResponse.json({ ok: true });
}
