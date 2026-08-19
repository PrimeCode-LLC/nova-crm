import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { pauseInstantlyCampaign } from "@/lib/integrations/instantly/client";
import { updateCampaignServer } from "@/lib/integrations/instantly/campaign-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
  const db = getAdminDb();
  if (!db) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const snap = await db.collection(COLLECTIONS.campaigns).doc(id).get();
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
    await pauseInstantlyCampaign(g.apiKey, instantlyId);
    await updateCampaignServer(id, { status: "paused" }, g.uid);
    return NextResponse.json({ ok: true, status: "paused" });
  } catch (err) {
    return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/campaigns/[id]/pause/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/campaigns/[id]/pause",
    });
  }
}
