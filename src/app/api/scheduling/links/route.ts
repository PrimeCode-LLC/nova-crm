import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getOrganizationServer } from "@/lib/platform/organizations-server";
import {
  createSchedulingLinkServer,
  deleteSchedulingLinkServer,
  listSchedulingLinksServer,
  updateSchedulingLinkServer,
} from "@/lib/scheduling/scheduling-server";

const createSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  bufferBeforeMin: z.number().int().min(0).max(120).optional(),
  bufferAfterMin: z.number().int().min(0).max(120).optional(),
  locationType: z
    .enum(["google_meet", "zoom", "teams", "phone", "in_person", "custom"])
    .optional(),
  locationDetails: z.string().max(500).optional(),
  linkType: z.enum(["personal", "team", "event"]).optional(),
  color: z.string().max(20).optional(),
  hostId: z.string().optional(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  bufferBeforeMin: z.number().int().min(0).max(120).optional(),
  bufferAfterMin: z.number().int().min(0).max(120).optional(),
  locationType: z
    .enum(["google_meet", "zoom", "teams", "phone", "in_person", "custom"])
    .optional(),
  locationDetails: z.string().max(500).optional(),
  color: z.string().max(20).optional(),
  active: z.boolean().optional(),
});

export async function GET(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const hostId = new URL(req.url).searchParams.get("hostId")?.trim() || undefined;
  const [items, org] = await Promise.all([
    listSchedulingLinksServer({
      organizationId: g.ctx.session.organizationId,
      viewerUid: g.ctx.session.uid,
      hostId,
    }),
    getOrganizationServer(g.ctx.session.organizationId),
  ]);
  return NextResponse.json({
    ok: true,
    items,
    orgSlug: org?.slug ?? "org",
    orgName: org?.name ?? "Organization",
  });
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
  const r = await createSchedulingLinkServer({
    organizationId: g.ctx.session.organizationId,
    hostId,
    hostName: g.ctx.session.name,
    title: parsed.data.title,
    description: parsed.data.description,
    durationMin: parsed.data.durationMin,
    bufferBeforeMin: parsed.data.bufferBeforeMin,
    bufferAfterMin: parsed.data.bufferAfterMin,
    locationType: parsed.data.locationType,
    locationDetails: parsed.data.locationDetails,
    linkType: parsed.data.linkType,
    color: parsed.data.color,
  });
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, item: r.link }, { status: 201 });
}

export async function PATCH(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
  }
  const { id, ...patch } = parsed.data;
  const r = await updateSchedulingLinkServer({
    organizationId: g.ctx.session.organizationId,
    id,
    actorUid: g.ctx.session.uid,
    patch,
  });
  if ("error" in r) {
    const status = r.error === "Forbidden" ? 403 : 400;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({ ok: true, item: r.link });
}

export async function DELETE(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const r = await deleteSchedulingLinkServer({
    organizationId: g.ctx.session.organizationId,
    id,
    actorUid: g.ctx.session.uid,
  });
  if ("error" in r) {
    const status = r.error === "Forbidden" ? 403 : 400;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
