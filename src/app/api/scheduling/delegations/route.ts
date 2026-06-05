import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import {
  createDelegationServer,
  deleteDelegationServer,
  listDelegationsForHostServer,
} from "@/lib/scheduling/calendar-delegation-server";
import { listDelegatedHostsForViewerServer } from "@/lib/scheduling/calendar-delegation-server";

const createSchema = z.object({
  hostId: z.string().optional(),
  granteeType: z.enum(["user", "role", "department", "org", "reports"]),
  granteeIds: z.array(z.string()).default([]),
  permissions: z
    .array(z.enum(["view_availability", "book", "manage_links", "cancel"]))
    .default(["view_availability", "book"]),
  schedulingLinkIds: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  if (mode === "bookable_hosts") {
    const hosts = await listDelegatedHostsForViewerServer({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      action: "book",
    });
    return NextResponse.json({ ok: true, hosts });
  }
  const hostId = url.searchParams.get("hostId")?.trim() || g.ctx.session.uid;
  const items = await listDelegationsForHostServer({
    organizationId: g.ctx.session.organizationId,
    hostId,
  });
  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }
  const hostId = parsed.data.hostId?.trim() || g.ctx.session.uid;
  if (hostId !== g.ctx.session.uid) {
    return NextResponse.json(
      { ok: false, error: "You can only manage delegations for your own calendar" },
      { status: 403 },
    );
  }
  const r = await createDelegationServer({
    organizationId: g.ctx.session.organizationId,
    hostId,
    hostName: g.ctx.session.name,
    granteeType: parsed.data.granteeType,
    granteeIds: parsed.data.granteeIds,
    permissions: parsed.data.permissions,
    schedulingLinkIds: parsed.data.schedulingLinkIds,
    createdBy: g.ctx.session.uid,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, item: r.delegation }, { status: 201 });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const id = new URL(req.url).searchParams.get("id")?.trim();
  const hostId = new URL(req.url).searchParams.get("hostId")?.trim() || g.ctx.session.uid;
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  if (hostId !== g.ctx.session.uid) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const r = await deleteDelegationServer({
    organizationId: g.ctx.session.organizationId,
    id,
    hostId,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
