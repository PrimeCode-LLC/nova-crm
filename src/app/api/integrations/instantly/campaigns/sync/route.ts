import { NextResponse } from "next/server";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { syncInstantlyCampaignsFromRemote } from "@/lib/integrations/instantly/sync-campaigns-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";
import { recordAudit } from "@/lib/firestore/audit";

export async function POST() {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  try {
    const result = await syncInstantlyCampaignsFromRemote(g.organizationId, g.uid);

    await recordAudit({
      organizationId: g.organizationId,
      actorUid: g.uid,
      event: "instantly.campaigns_synced",
      meta: result,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
