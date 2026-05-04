import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  createInviteServer,
  listInvitesServer,
  revokeInviteServer,
} from "@/lib/platform/invites-server";
import { hasSeatAvailableServer } from "@/lib/platform/members-server";
import { getRequestOrigin, inviteAcceptUrl } from "@/lib/invite-link";
import { renderInviteEmail } from "@/lib/email/invite-email";
import {
  sendSystemEmail,
  systemEmailConfigHint,
} from "@/lib/email/send-system-email";
import { recordAudit } from "@/lib/firestore/audit";
import { getOrganizationServer } from "@/lib/platform/organizations-server";

const postSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin", "manager", "member"]).default("member"),
});

export async function GET() {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const invites = await listInvitesServer(g.ctx.session.organizationId);
  return NextResponse.json({ invites });
}

export async function POST(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Only owners may invite owners or admins.
  if (
    (parsed.data.role === "owner" || parsed.data.role === "admin") &&
    g.ctx.role !== "owner"
  ) {
    return NextResponse.json(
      { error: "Only the owner can invite admins or owners." },
      { status: 403 },
    );
  }

  const seat = await hasSeatAvailableServer(g.ctx.session.organizationId);
  if ("error" in seat) {
    return NextResponse.json({ error: seat.error }, { status: 400 });
  }

  const result = await createInviteServer({
    organizationId: g.ctx.session.organizationId,
    email: parsed.data.email,
    role: parsed.data.role,
    createdByUid: g.ctx.session.uid,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const origin = await getRequestOrigin();
  const acceptUrl = inviteAcceptUrl(origin, result.token);
  const org = await getOrganizationServer(g.ctx.session.organizationId);
  const email = renderInviteEmail({
    organizationName: org?.name ?? "Workspace",
    inviterName: g.ctx.session.name,
    recipientEmail: result.invite.email,
    role: result.invite.role,
    acceptUrl,
    expiresAt: result.invite.expiresAt,
  });

  const send = await sendSystemEmail({
    to: result.invite.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "member.invited",
    meta: { email: result.invite.email, role: result.invite.role, delivered: send.ok },
  });

  return NextResponse.json({
    invite: result.invite,
    acceptUrl,
    emailDelivered: send.ok,
    deliveryNote:
      send.ok === false && send.reason === "not_configured"
        ? `${systemEmailConfigHint()} Copy the accept link below to share manually.`
        : send.ok === false
          ? send.error
          : undefined,
  });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const r = await revokeInviteServer(g.ctx.session.organizationId, id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "invite.revoked",
    meta: { inviteId: id },
  });
  return NextResponse.json({ ok: true });
}
