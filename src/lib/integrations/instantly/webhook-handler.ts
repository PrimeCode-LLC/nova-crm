import crypto from "crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import {
  findNovaCampaignByInstantlyId,
  incrementCampaignStatServer,
} from "./campaign-server";
import { recordAudit } from "@/lib/firestore/audit";

export type InstantlyWebhookPayload = {
  timestamp?: string;
  event_type?: string;
  workspace?: string;
  campaign_id?: string;
  campaign_name?: string;
  lead_email?: string;
  reply_text?: string;
  reply_text_snippet?: string;
  reply_subject?: string;
  unibox_url?: string;
  email_subject?: string;
};

function unauthorized() {
  return { ok: false as const, status: 401, error: "Unauthorized" };
}

export async function verifyInstantlyWebhook(
  organizationId: string,
  presented: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!presented) return unauthorized();

  const db = getAdminDb();
  if (!db) return { ok: false, status: 503, error: "Database not configured" };

  const orgSnap = await db.collection(COLLECTIONS.organizations).doc(organizationId).get();
  if (!orgSnap.exists) return unauthorized();

  const settings = (orgSnap.data()?.settings ?? {}) as { instantlyWebhookSecret?: string };
  const orgSecret = settings.instantlyWebhookSecret?.trim() || null;
  const fallback = process.env.INSTANTLY_WEBHOOK_SECRET?.trim() || null;
  const accepted = orgSecret
    ? presented === orgSecret
    : fallback
      ? presented === fallback
      : false;

  if (!accepted) return unauthorized();
  return { ok: true };
}

export async function handleInstantlyWebhookEvent(
  organizationId: string,
  payload: InstantlyWebhookPayload,
): Promise<{ ok: true; leadId?: string }> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");

  const eventType = payload.event_type ?? "";
  const campaignId = payload.campaign_id?.trim();

  if (campaignId) {
    const nova = await findNovaCampaignByInstantlyId(organizationId, campaignId);
    if (nova) {
      if (eventType === "email_sent") {
        await incrementCampaignStatServer(nova.id, "sent");
      } else if (eventType === "email_opened") {
        await incrementCampaignStatServer(nova.id, "opened");
      } else if (eventType === "reply_received" || eventType === "auto_reply_received") {
        await incrementCampaignStatServer(nova.id, "replied");
      }
    }
  }

  if (eventType !== "reply_received" && eventType !== "auto_reply_received") {
    return { ok: true };
  }

  const email = payload.lead_email?.trim().toLowerCase();
  if (!email) return { ok: true };

  const novaCampaign = campaignId
    ? await findNovaCampaignByInstantlyId(organizationId, campaignId)
    : null;

  const existing = await db
    .collection(COLLECTIONS.leads)
    .where("organizationId", "==", organizationId)
    .where("contactEmail", "==", email)
    .limit(1)
    .get();

  const replyBody =
    payload.reply_text?.trim() ||
    payload.reply_text_snippet?.trim() ||
    payload.reply_subject?.trim() ||
    "Reply received from Instantly";

  let leadId: string;

  if (!existing.empty) {
    const doc = existing.docs[0]!;
    leadId = doc.id;
    const patch: Record<string, unknown> = {
      lastActivityAt: new Date().toISOString(),
      temperature: "warm",
    };
    if (novaCampaign) patch.campaignId = novaCampaign.id;
    patch.pushToInstantly = "pushed";
    await doc.ref.update(stampForUpdate(patch));
  } else {
    leadId = `l-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const accountId = `a-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const contactId = `ct-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const companyName = payload.campaign_name?.trim() || "Unknown";
    const localPart = email.split("@")[0] ?? "Contact";
    const contactName =
      localPart.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Contact";

    await db.collection(COLLECTIONS.accounts).doc(accountId).set(
      stampForCreate(organizationId, {
        name: companyName,
        domain: email.includes("@") ? email.split("@")[1] : undefined,
      }),
    );
    await db.collection(COLLECTIONS.contacts).doc(contactId).set(
      stampForCreate(organizationId, {
        accountId,
        name: contactName,
        email,
      }),
    );
    await db.collection(COLLECTIONS.leads).doc(leadId).set(
      stampForCreate(organizationId, {
        accountId,
        contactId,
        channel: "cold_email",
        campaignId: novaCampaign?.id,
        stage: "replied",
        temperature: "warm",
        priority: "high",
        ownerId: "",
        contactName,
        contactEmail: email,
        companyName,
        pushToInstantly: "pushed",
        touches: 1,
        firstContactAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      }),
    );
  }

  const leadSnap = await db.collection(COLLECTIONS.leads).doc(leadId).get();
  const leadOwnerId = String(leadSnap.data()?.ownerId ?? "");

  await db.collection(COLLECTIONS.timelineEvents).add(
    stampForCreate(organizationId, {
      leadId,
      leadOwnerId,
      type: "email_replied",
      actorId: null,
      summary:
        (payload.reply_subject?.trim()
          ? `${payload.reply_subject.trim()}: `
          : "") + replyBody.slice(0, 400),
      payload: {
        source: "instantly",
        campaignId: payload.campaign_id,
        uniboxUrl: payload.unibox_url,
      },
      createdAt: payload.timestamp ?? new Date().toISOString(),
    }),
  );

  await recordAudit({
    organizationId,
    actorUid: "system",
    event: "instantly.webhook_reply",
    meta: { leadId, email, campaignId: payload.campaign_id },
  });

  return { ok: true, leadId };
}
