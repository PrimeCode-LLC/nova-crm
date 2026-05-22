import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardInstantlyApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { activateInstantlyCampaign } from "@/lib/integrations/instantly/client";
import { updateCampaignServer } from "@/lib/integrations/instantly/campaign-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
  const g = await guardInstantlyApi({ minRole: "manager" });
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
    await activateInstantlyCampaign(g.apiKey, instantlyId);
    await updateCampaignServer(id, { status: "active" }, g.uid);
    return NextResponse.json({ ok: true, status: "active" });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
