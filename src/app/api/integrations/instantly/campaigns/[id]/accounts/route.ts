import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { patchInstantlyCampaign } from "@/lib/integrations/instantly/client";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

const bodySchema = z.object({
  email_list: z.array(z.string().email()).min(1),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx) {
  const g = await guardInstantlyOutreachApi();
  if (!g.ok) return g.response;

  const { id } = await ctx.params;
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
    const remote = await patchInstantlyCampaign(g.apiKey, instantlyId, {
      email_list: parsed.data.email_list,
    });
    return NextResponse.json({ ok: true, email_list: remote.email_list ?? parsed.data.email_list });
  } catch (err) {
    return instantlyErrorResponse(err);
  }
}
