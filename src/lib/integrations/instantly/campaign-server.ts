import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { stampForCreate, stampForUpdate } from "@/lib/firestore/tenant-write";
import type { Campaign } from "@/lib/types";
import { formatInstantlyRef, parseInstantlyId } from "./refs";
import {
  extractInstantlyStats,
  getInstantlyCampaign,
  mapInstantlyStatusToNova,
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
  const remote = await getInstantlyCampaign(apiKey, instantlyId);
  const extracted = extractInstantlyStats(remote);
  const db = getAdminDb();
  if (!db) throw new Error("Database not configured");
  const ref = db.collection(COLLECTIONS.campaigns).doc(novaCampaignId);
  const snap = await ref.get();
  const prev =
    snap.exists && snap.data()?.stats && typeof snap.data()?.stats === "object"
      ? (snap.data()!.stats as Campaign["stats"])
      : { sent: 0, replied: 0, meetings: 0, closed: 0 };
  const stats: Campaign["stats"] = {
    ...prev,
    sent: extracted.sent,
    replied: extracted.replied,
    opened: extracted.opened,
  };
  await ref.update(
    stampForUpdate(
      {
        stats,
        status: mapInstantlyStatusToNova(remote.status),
        lastSyncedAt: new Date().toISOString(),
      },
      uid,
    ),
  );
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
      sent: stats.sent,
      replied: stats.replied,
      meetings: 0,
      closed: 0,
      opened: stats.opened,
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
  await db
    .collection(COLLECTIONS.campaigns)
    .doc(campaignId)
    .update({
      [`stats.${field}`]: FieldValue.increment(delta),
      lastSyncedAt: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}
