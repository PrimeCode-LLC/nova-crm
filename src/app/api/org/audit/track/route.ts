import { NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { recordAudit, type AuditEvent } from "@/lib/firestore/audit";
import {
  CLIENT_TRACKABLE_AUDIT_EVENTS,
  featureLabelForPath,
} from "@/lib/firestore/audit-events";
import { withAuditActor } from "@/lib/firestore/audit-helpers";

const bodySchema = z.object({
  event: z.enum(CLIENT_TRACKABLE_AUDIT_EVENTS),
  meta: z
    .object({
      path: z.string().max(500).optional(),
      feature: z.string().max(120).optional(),
      label: z.string().max(200).optional(),
      leadId: z.string().max(120).optional(),
      leadName: z.string().max(200).optional(),
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

  const path = typeof safeMeta.path === "string" ? safeMeta.path : undefined;
  const feature =
    typeof safeMeta.feature === "string"
      ? safeMeta.feature
      : path
        ? featureLabelForPath(path)
        : undefined;
  const leadName = typeof safeMeta.leadName === "string" ? safeMeta.leadName : undefined;
  const displayTarget = leadName ?? feature ?? path ?? "page";

  const organizationId = g.ctx.session.organizationId;
  const session = g.ctx.session;
  const event = parsed.data.event as AuditEvent;

  after(() => {
    void recordAudit(
      withAuditActor(session, {
        organizationId,
        actorUid: session.uid,
        event,
        operation: "view",
        tableName: "pages",
        fieldName: leadName ? "lead" : "path",
        message:
          event === "feature.outreach_view"
            ? `Opened email outreach${path ? ` (${displayTarget})` : ""}`
            : `Visited ${displayTarget}`,
        updatedValue: leadName ?? path ?? null,
        meta: safeMeta,
      }),
    ).catch(() => {
      /* best-effort audit */
    });
  });

  return NextResponse.json({ ok: true });
}
