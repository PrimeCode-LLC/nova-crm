import { NextResponse } from "next/server";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import {
  generateOpenJoinSecret,
  hashOpenJoinSecret,
  packOpenJoinToken,
  setOrganizationOpenJoinHashServer,
} from "@/lib/platform/open-join-server";
import { recordAudit } from "@/lib/documents/audit";
import { openJoinAcceptUrl } from "@/lib/invite-link";

function originFromRequest(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/** Owners and admins can create, read (masked), rotate, or clear the org-wide join link. */
export async function GET(req: Request) {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;
  const org = await getOrganizationServer(g.ctx.session.organizationId);
  return NextResponse.json({
    configured: Boolean(org?.openJoinTokenHash),
  });
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
  const action =
    typeof json === "object" &&
    json !== null &&
    typeof (json as { action?: unknown }).action === "string"
      ? (json as { action: string }).action
      : "rotate";

  if (action !== "rotate" && action !== "create") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const orgId = g.ctx.session.organizationId;
  const secret = generateOpenJoinSecret();
  const hash = hashOpenJoinSecret(secret);
  const r = await setOrganizationOpenJoinHashServer(orgId, hash);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }

  const token = packOpenJoinToken(orgId, secret);
  const base = originFromRequest(req);
  const signupUrl = openJoinAcceptUrl(base, token);

  await recordAudit({
    organizationId: orgId,
    actorUid: g.ctx.session.uid,
    event: "org.open_join_link_rotated",
    meta: {},
  });

  return NextResponse.json({ signupUrl, token });
}

export async function DELETE() {
  const g = await guardTenantApi({ minRole: "admin" });
  if (!g.ok) return g.response;
  const r = await setOrganizationOpenJoinHashServer(g.ctx.session.organizationId, null);
  if ("error" in r) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: "org.open_join_link_cleared",
    meta: {},
  });
  return NextResponse.json({ ok: true });
}
