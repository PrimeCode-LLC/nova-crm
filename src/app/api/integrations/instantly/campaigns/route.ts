import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTenantApi } from "@/lib/platform/tenant-api-guard";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import type { Campaign } from "@/lib/types";
import { guardInstantlyApi } from "@/lib/integrations/instantly/guard";
import {
  createInstantlyCampaign,
  defaultInstantlySchedule,
} from "@/lib/integrations/instantly/client";
import { normalizeInstantlyTimezone } from "@/lib/integrations/instantly/timezones";
import {
  novaCampaignFromInstantly,
  persistCampaignServer,
} from "@/lib/integrations/instantly/campaign-server";
import { instantlyErrorResponse } from "@/lib/integrations/instantly/api-error";
import { recordAudit } from "@/lib/documents/audit";
import type { InstantlySequence, InstantlySequenceStep } from "@/lib/integrations/instantly/types";

const stepSchema = z.object({
  type: z.literal("email"),
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

const createSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().optional(),
  scheduleFrom: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  scheduleTo: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  steps: z.array(stepSchema).min(1).optional(),
  email_list: z.array(z.string().email()).optional(),
  activate: z.boolean().optional(),
});

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

export async function GET() {
  const g = await guardTenantApi({ minRole: "member" });
  if (!g.ok) return g.response;

  const orgId = g.ctx.session.organizationId;
  const db = getAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const snap = await db
    .collection(COLLECTIONS.campaigns)
    .where("organizationId", "==", orgId)
    .where("channel", "==", "cold_email")
    .get();

  const campaigns = snap.docs.map((d) => asCampaignFromDoc(d.id, d.data() as Record<string, unknown>));
  return NextResponse.json({ campaigns });
}

export async function POST(req: Request) {
  const g = await guardInstantlyApi({ minRole: "manager", grantFeature: "create_campaigns" });
  if (!g.ok) return g.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, timezone, scheduleFrom, scheduleTo, steps, email_list, activate } = parsed.data;
  const schedule = defaultInstantlySchedule(normalizeInstantlyTimezone(timezone));
  if (schedule.schedules[0]) {
    schedule.schedules[0].timing = {
      from: scheduleFrom ?? "09:00",
      to: scheduleTo ?? "17:00",
    };
  }

  const sequences: InstantlySequence[] | undefined = steps?.length
    ? [{ steps: steps as InstantlySequenceStep[] }]
    : undefined;

  try {
    const remote = await createInstantlyCampaign(g.apiKey, {
      name,
      campaign_schedule: schedule,
      ...(sequences ? { sequences } : {}),
      email_list: email_list?.length ? email_list : undefined,
    });

    if (activate && remote.id) {
      const { activateInstantlyCampaign } = await import("@/lib/integrations/instantly/client");
      await activateInstantlyCampaign(g.apiKey, remote.id);
      remote.status = 1;
    }

    const novaId = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const campaign = novaCampaignFromInstantly(novaId, remote);
    await persistCampaignServer(g.organizationId, campaign, g.uid);

    await recordAudit({
      organizationId: g.organizationId,
      actorUid: g.uid,
      event: "instantly.campaign_created",
      meta: { campaignId: novaId, instantlyId: remote.id },
    });

    return NextResponse.json({ campaign });
  } catch (err) {
    return instantlyErrorResponse(err, {
      organizationId: g.organizationId,
      actorUid: g.uid,
      location: "src/app/api/integrations/instantly/campaigns/route.ts",
      functionName: "handler",
      route: "/api/integrations/instantly/campaigns",
    });
  }
}
