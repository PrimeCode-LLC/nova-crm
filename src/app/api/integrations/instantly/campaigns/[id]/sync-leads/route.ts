import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { recordAudit } from "@/lib/firestore/audit";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { syncInstantlyCampaignLeadsToNova } from "@/lib/integrations/instantly/sync-campaign-leads-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  const { id: campaignDocId } = await ctx.params;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const snap = await db.collection(COLLECTIONS.campaigns).doc(campaignDocId).get();
  if (!snap.exists) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const raw = snap.data() as Record<string, unknown>;
  if (raw.organizationId !== g.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const instantlyId = parseInstantlyId(
    raw.externalRef ? String(raw.externalRef) : undefined,
    raw.instantlyId ? String(raw.instantlyId) : undefined,
  );
  if (!instantlyId) {
    return NextResponse.json({ error: "Campaign is not linked to Instantly" }, { status: 400 });
  }

  try {
    const result = await syncInstantlyCampaignLeadsToNova(
      g.organizationId,
      campaignDocId,
      instantlyId,
      g.uid,
    );

    await recordAudit({
      organizationId: g.organizationId,
      actorUid: g.uid,
      event: "instantly.campaign_leads_synced",
      meta: { campaignId: campaignDocId, ...result },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
