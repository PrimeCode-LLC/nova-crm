import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import { patchInstantlyCampaign } from "@/lib/integrations/instantly/client";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";

const optionsSchema = z
  .object({
    email_list: z.array(z.string().email()).min(1).optional(),
    stop_on_reply: z.boolean().optional(),
    stop_on_auto_reply: z.boolean().optional(),
    stop_for_company: z.boolean().optional(),
    open_tracking: z.boolean().optional(),
    link_tracking: z.boolean().optional(),
    text_only: z.boolean().optional(),
    first_email_text_only: z.boolean().optional(),
    daily_limit: z.number().int().min(1).nullable().optional(),
    daily_max_leads: z.number().int().min(0).nullable().optional(),
    email_gap: z.number().int().min(0).nullable().optional(),
    random_wait_max: z.number().int().min(0).nullable().optional(),
    prioritize_new_leads: z.boolean().optional(),
    insert_unsubscribe_header: z.boolean().optional(),
    match_lead_esp: z.boolean().optional(),
    allow_risky_contacts: z.boolean().optional(),
    disable_bounce_protect: z.boolean().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: "At least one option is required" });

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
  const parsed = optionsSchema.safeParse(json);
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
    const remote = await patchInstantlyCampaign(g.apiKey, instantlyId, parsed.data);
    return NextResponse.json({ ok: true, remote });
  } catch (err) {
    return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/campaigns/[id]/options/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/campaigns/[id]/options",
    });
  }
}
