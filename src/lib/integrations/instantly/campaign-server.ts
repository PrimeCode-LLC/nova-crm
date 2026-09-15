import { FieldValue } from "@/lib/db/document-shim/shim-firestore";
import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { stampForCreate, stampForUpdate } from "@/lib/documents/tenant-write";
import type { Campaign } from "@/lib/types";
import { formatInstantlyRef, parseInstantlyId } from "./refs";
import {
  extractInstantlyStats,
  getInstantlyCampaign,
  mapInstantlyStatusToNova,
  resolveCampaignStatsFromInstantly,
} from "./client";
import { getInstantlyApiKeyServer } from "./secrets";
import type { InstantlyCampaign } from "./types";

export async function findNovaCampaignByInstantlyId(
  organizationId: string,
  instantlyId: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const db = getAdminDb();
  if (!db) return null;
  const ref = formatInstantlyRef(instantlyId);
  const snap = await db
    .collection(COLLECTIONS.campaigns)
    .where("organizationId", "==", organizationId)
    .where("externalRef", "==", ref)
    .limit(1)
    .get();
  if (!snap.empty) {
    const doc = snap.docs[0]!;
    return { id: doc.id, data: doc.data() as Record<string, unknown> };
  }
  const snap2 = await db
    .collection(COLLECTIONS.campaigns)
    .where("organizationId", "==", organizationId)
    .where("instantlyId", "==", instantlyId)
    .limit(1)
    .get();
  if (!snap2.empty) {
    const doc = snap2.docs[0]!;
    return { id: doc.id, data: doc.data() as Record<string, unknown> };
  }
  return null;
}

export async function persistCampaignServer(
  organizationId: string,
  campaign: Campaign,
  uid?: string,
): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");
  const instantlyId =
    campaign.instantlyId ?? parseInstantlyId(campaign.externalRef) ?? null;
  await db
    .collection(COLLECTIONS.campaigns)
    .doc(campaign.id)
    .set(
      stampForCreate(
        organizationId,
        {
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          externalRef: campaign.externalRef ?? null,
          instantlyId,
          startedAt: campaign.startedAt ?? null,
          lastSyncedAt: campaign.lastSyncedAt ?? null,
          sequenceSummary: campaign.sequenceSummary ?? null,
          stats: campaign.stats,
        },
        uid,
      ),
    );
}

export async function updateCampaignServer(
  campaignId: string,
  patch: Partial<Campaign>,
  uid?: string,
): Promise<void> {
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.channel !== undefined) payload.channel = patch.channel;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.externalRef !== undefined) payload.externalRef = patch.externalRef ?? null;
  if (patch.instantlyId !== undefined) payload.instantlyId = patch.instantlyId ?? null;
  if (patch.startedAt !== undefined) payload.startedAt = patch.startedAt ?? null;
  if (patch.lastSyncedAt !== undefined) payload.lastSyncedAt = patch.lastSyncedAt ?? null;
  if (patch.sequenceSummary !== undefined) payload.sequenceSummary = patch.sequenceSummary ?? null;
  if (patch.stats !== undefined) payload.stats = patch.stats;
  await db
    .collection(COLLECTIONS.campaigns)
    .doc(campaignId)
    .update(stampForUpdate(payload, uid));
}

export async function syncCampaignStatsFromInstantly(
  organizationId: string,
  novaCampaignId: string,
  instantlyId: string,
  uid?: string,
): Promise<Campaign["stats"]> {
  const apiKey = await getInstantlyApiKeyServer(organizationId);
  if (!apiKey) throw new Error("Instantly is not connected");

  const [remote, resolved] = await Promise.all([
    getInstantlyCampaign(apiKey, instantlyId),
    resolveCampaignStatsFromInstantly(apiKey, instantlyId),
  ]);

  const extracted = resolved.stats;
  const novaStatus =
    resolved.campaignStatus != null
      ? mapInstantlyStatusToNova(resolved.campaignStatus)
      : mapInstantlyStatusToNova(remote.status);

  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");
  const ref = db.collection(COLLECTIONS.campaigns).doc(novaCampaignId);
  // Monotonic counters: take max(local, remote) under a lock so a concurrent
  // webhook increment is not clobbered by a stale Instantly sync snapshot.
  const stats = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prev =
      snap.exists && snap.data()?.stats && typeof snap.data()?.stats === "object"
        ? (snap.data()!.stats as Campaign["stats"])
        : { sent: 0, replied: 0, meetings: 0, closed: 0 };
    const next: Campaign["stats"] = {
      ...prev,
      sent: Math.max(extracted.sent || 0, prev.sent || 0),
      replied: Math.max(extracted.replied || 0, prev.replied || 0),
      opened: Math.max(extracted.opened || 0, prev.opened || 0),
      bounced: Math.max(extracted.bounced || 0, prev.bounced || 0),
      linkClicks: Math.max(extracted.linkClicks || 0, prev.linkClicks || 0),
      unsubscribed: Math.max(extracted.unsubscribed || 0, prev.unsubscribed || 0),
      leadsCount: Math.max(extracted.leadsCount || 0, prev.leadsCount || 0),
      contacted: Math.max(extracted.contacted || 0, prev.contacted || 0),
      completed: Math.max(extracted.completed || 0, prev.completed || 0),
    };
    tx.update(
      ref,
      stampForUpdate(
        {
          stats: next,
          status: novaStatus,
          lastSyncedAt: new Date().toISOString(),
        },
        uid,
      ),
    );
    return next;
  });
  return stats;
}

export function novaCampaignFromInstantly(
  novaId: string,
  remote: InstantlyCampaign,
): Campaign {
  const instantlyId = remote.id;
  const stats = extractInstantlyStats(remote);
  const steps = remote.sequences?.[0]?.steps?.length ?? 0;
  return {
    id: novaId,
    name: remote.name,
    channel: "cold_email",
    status: mapInstantlyStatusToNova(remote.status),
    externalRef: formatInstantlyRef(instantlyId),
    instantlyId,
    startedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    sequenceSummary: steps > 0 ? { steps } : undefined,
    stats: {
      sent: stats.sent ?? 0,
      replied: stats.replied ?? 0,
      meetings: 0,
      closed: 0,
      opened: stats.opened ?? 0,
      bounced: stats.bounced ?? 0,
      linkClicks: stats.linkClicks ?? 0,
      unsubscribed: stats.unsubscribed ?? 0,
      leadsCount: stats.leadsCount ?? 0,
      contacted: stats.contacted ?? 0,
      completed: stats.completed ?? 0,
    },
  };
}

export async function incrementCampaignStatServer(
  campaignId: string,
  field: "sent" | "replied" | "opened",
  delta = 1,
): Promise<void> {
  const db = getAdminDb();
  if (!db) return;
  const ref = db.collection(COLLECTIONS.campaigns).doc(campaignId);
  // Nested `stats.field` increments must re-read the object — the document
  // shim does not expand dotted FieldPath keys.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const prev =
      snap.data()?.stats && typeof snap.data()?.stats === "object"
        ? (snap.data()!.stats as Record<string, number>)
        : {};
    const next = {
      ...prev,
      [field]: Math.max(0, Number(prev[field] ?? 0) + delta),
    };
    tx.update(ref, {
      stats: next,
      lastSyncedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}
