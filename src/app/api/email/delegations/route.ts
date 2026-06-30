import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  getDelegationForHostServer,
  listAccessibleHostsForGranteeServer,
  removeGranteeFromHostServer,
  upsertDelegationForHostServer,
} from "@/lib/email/mailbox-delegation-server";

const upsertSchema = z.object({
  granteeUserIds: z.array(z.string()).default([]),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (mode === "accessible_hosts") {
    const hostIds = await listAccessibleHostsForGranteeServer({
      organizationId: g.ctx.session.organizationId,
      granteeUid: g.ctx.session.uid,
    });
    return NextResponse.json({ ok: true, hostIds });
  }

  const hostId = url.searchParams.get("hostId")?.trim() || g.ctx.session.uid;
  if (hostId !== g.ctx.session.uid) {
    return NextResponse.json(
      { ok: false, error: "You can only view delegations for your own mailbox." },
      { status: 403 },
    );
  }

  const delegation = await getDelegationForHostServer({
    organizationId: g.ctx.session.organizationId,
    hostId,
  });

  return NextResponse.json({
    ok: true,
    item: delegation ?? {
      id: "",
      organizationId: g.ctx.session.organizationId,
      hostId,
      granteeUserIds: [],
      permissions: ["view", "send"] as const,
      createdBy: g.ctx.session.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function PUT(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }

  const hostId = g.ctx.session.uid;
  const r = await upsertDelegationForHostServer({
    organizationId: g.ctx.session.organizationId,
    hostId,
    granteeUserIds: parsed.data.granteeUserIds,
    createdBy: g.ctx.session.uid,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, item: r.delegation });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  const granteeUid = new URL(req.url).searchParams.get("granteeUid")?.trim();
  if (!granteeUid) {
    return NextResponse.json({ ok: false, error: "granteeUid required" }, { status: 400 });
  }

  const r = await removeGranteeFromHostServer({
    organizationId: g.ctx.session.organizationId,
    hostId: g.ctx.session.uid,
    granteeUid,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
