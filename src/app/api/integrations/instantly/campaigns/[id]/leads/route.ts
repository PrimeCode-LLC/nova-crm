import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { addInstantlyLeadsBulk } from "@/lib/integrations/instantly/client";
import { leadSnapshotFromFirestore, mapNovaLeadToInstantly } from "@/lib/integrations/instantly/lead-mapper";
import { stampForUpdate } from "@/lib/firestore/tenant-write";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";
import { recordAudit } from "@/lib/firestore/audit";
const bodySchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(1000),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  const { id: campaignDocId } = await ctx.params;
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

  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const campSnap = await db.collection(COLLECTIONS.campaigns).doc(campaignDocId).get();
  if (!campSnap.exists) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const campRaw = campSnap.data() as Record<string, unknown>;
  if (campRaw.organizationId !== g.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const instantlyId = parseInstantlyId(
    campRaw.externalRef ? String(campRaw.externalRef) : undefined,
    campRaw.instantlyId ? String(campRaw.instantlyId) : undefined,
  );
  if (!instantlyId) {
    return NextResponse.json({ error: "Campaign is not linked to Instantly" }, { status: 400 });
  }

  const leadsToPush: import("@/lib/integrations/instantly/types").InstantlyLeadInput[] = [];
  const leadDocIds: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const leadId of parsed.data.leadIds) {
    const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
    if (!leadSnap.exists) {
      skipped.push({ id: leadId, reason: "not_found" });
      continue;
    }
    const raw = leadSnap.data() as Record<string, unknown>;
    if (raw.organizationId !== g.organizationId) {
      skipped.push({ id: leadId, reason: "forbidden" });
      continue;
    }
    const lead = leadSnapshotFromFirestore(leadId, raw);
    const mapped = mapNovaLeadToInstantly(lead);
    if (!mapped) {
      skipped.push({ id: leadId, reason: "missing_email" });
      continue;
    }
    leadsToPush.push(mapped);
    leadDocIds.push(leadId);
  }

  if (leadsToPush.length === 0) {
    return NextResponse.json(
      { error: "No valid leads to push", skipped },
      { status: 400 },
    );
  }

  try {
    const result = await addInstantlyLeadsBulk(g.apiKey, {
      campaign_id: instantlyId,
      leads: leadsToPush,
    });

    const batch = db.batch();
    for (const leadId of leadDocIds) {
      batch.update(
        db.collection(COLLECTIONS.leads).doc(leadId),
        stampForUpdate(
          {
            campaignId: campaignDocId,
            pushToInstantly: "pushed",
            channel: "cold_email",
          },
          g.uid,
        ),
      );
    }
    await batch.commit();

    await recordAudit({
      organizationId: g.organizationId,
      actorUid: g.uid,
      event: "instantly.leads_pushed",
      meta: { campaignId: campaignDocId, count: leadDocIds.length },
    });

    return NextResponse.json({
      ok: true,
      pushed: leadDocIds.length,
      skipped,
      instantly: result,
    });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
