import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit, type AuditEvent } from "@/lib/firestore/audit";
import {
  CLIENT_TRACKABLE_AUDIT_EVENTS,
  featureLabelForPath,
} from "@/lib/firestore/audit-events";

const bodySchema = z.object({
  event: z.enum(CLIENT_TRACKABLE_AUDIT_EVENTS),
  meta: z
    .object({
      path: z.string().max(500).optional(),
      feature: z.string().max(120).optional(),
      label: z.string().max(200).optional(),
    })
    .passthrough()
    .optional(),
});

export async function POST(req: Request) {
  const g = await guardTenantApi();
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const meta: Record<string, unknown> = { ...(parsed.data.meta ?? {}) };
  if (parsed.data.event === "feature.page_view" && typeof meta.path === "string") {
    const path = meta.path.split("?")[0] ?? meta.path;
    meta.path = path;
    if (!meta.feature) {
      meta.feature = featureLabelForPath(path) ?? path;
    }
    if (!meta.label) {
      meta.label = meta.feature;
    }
  }

  const safeMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      safeMeta[k] = v;
    }
  }

  await recordAudit({
    organizationId: g.ctx.session.organizationId,
    actorUid: g.ctx.session.uid,
    event: parsed.data.event as AuditEvent,
    meta: safeMeta,
  });

  return NextResponse.json({ ok: true });
}
