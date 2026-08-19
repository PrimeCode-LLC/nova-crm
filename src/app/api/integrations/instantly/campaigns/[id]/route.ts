import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { guardInstantlyOutreachApi } from "@/lib/integrations/instantly/guard";
import { parseInstantlyId } from "@/lib/integrations/instantly/refs";
import {
  getInstantlyCampaign,
  patchInstantlyCampaign,
} from "@/lib/integrations/instantly/client";
import type { InstantlySequenceStep } from "@/lib/integrations/instantly/types";
import { syncCampaignStatsFromInstantly, updateCampaignServer } from "@/lib/integrations/instantly/campaign-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";
import type { Campaign } from "@/lib/types";

const sequenceStepSchema = z.object({
  type: z.literal("email").optional(),
  delay: z.number().optional(),
  variants: z
    .array(
      z.object({
        subject: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .min(1),
});

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    email_list: z.array(z.string().email()).optional(),
    steps: z.array(sequenceStepSchema).min(1).optional(),
  })
  .strict();

function asCampaignFromDoc(id: string, raw: Record<string, unknown>): Campaign {
  const statsRaw = raw.stats;
  const stats =
    statsRaw && typeof statsRaw === "object" && !Array.isArray(statsRaw)
      ? (statsRaw as Campaign["stats"])
      : { sent: 0, replied: 0, meetings: 0, closed: 0 };
  return {
    id,
    name: String(raw.name ?? ""),
    channel: (raw.channel as Campaign["channel"]) ?? "cold_email",
    status: (raw.status as Campaign["status"]) ?? "draft",
    externalRef: raw.externalRef ? String(raw.externalRef) : undefined,
    instantlyId: raw.instantlyId ? String(raw.instantlyId) : undefined,
    startedAt: raw.startedAt ? String(raw.startedAt) : undefined,
    lastSyncedAt: raw.lastSyncedAt ? String(raw.lastSyncedAt) : undefined,
    sequenceSummary:
      raw.sequenceSummary && typeof raw.sequenceSummary === "object"
        ? (raw.sequenceSummary as Campaign["sequenceSummary"])
        : undefined,
    stats,
  };
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
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

  const campaign = asCampaignFromDoc(id, raw);
  const instantlyId = parseInstantlyId(campaign.externalRef, campaign.instantlyId);
  let remote = null;
  if (instantlyId) {
    try {
      remote = await getInstantlyCampaign(g.apiKey, instantlyId);
    } catch (err) {
      return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/campaigns/[id]/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/campaigns/[id]",
    });
    }
  }

  return NextResponse.json({ campaign, remote });
}

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
  const parsed = patchSchema.safeParse(json);
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
    const patch: Record<string, unknown> = {};
    if (parsed.data.name) patch.name = parsed.data.name;
    if (parsed.data.email_list) patch.email_list = parsed.data.email_list;
    if (parsed.data.steps) {
      patch.sequences = [
        {
          steps: parsed.data.steps.map((s, i) => {
            const step: InstantlySequenceStep = {
              type: "email",
              variants: s.variants,
            };
            if (i > 0 && s.delay !== undefined) step.delay = s.delay;
            return step;
          }),
        },
      ];
    }
    if (Object.keys(patch).length > 0) {
      await patchInstantlyCampaign(g.apiKey, instantlyId, patch);
    }
    const novaPatch: Partial<Campaign> = {};
    if (parsed.data.name) novaPatch.name = parsed.data.name;
    if (parsed.data.steps) {
      novaPatch.sequenceSummary = { steps: parsed.data.steps.length };
      novaPatch.lastSyncedAt = new Date().toISOString();
    }
    if (Object.keys(novaPatch).length > 0) {
      await updateCampaignServer(id, novaPatch, g.uid);
    }
    const updated = await db.collection(COLLECTIONS.campaigns).doc(id).get();
    return NextResponse.json({
      campaign: asCampaignFromDoc(id, updated.data() as Record<string, unknown>),
    });
  } catch (err) {
    return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/campaigns/[id]/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/campaigns/[id]",
    });
  }
}
