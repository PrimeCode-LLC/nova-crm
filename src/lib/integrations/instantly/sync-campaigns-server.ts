import crypto from "crypto";
import {
  findNovaCampaignByInstantlyId,
  novaCampaignFromInstantly,
  persistCampaignServer,
  updateCampaignServer,
} from "./campaign-server";
import { listInstantlyCampaigns } from "./client";
import { getInstantlyApiKeyServer } from "./secrets";
import type { Campaign } from "@/lib/types";

export type SyncInstantlyCampaignsResult = {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
};

/** Import or update Nova campaign docs from all campaigns in the Instantly workspace. */
export async function syncInstantlyCampaignsFromRemote(
  organizationId: string,
  uid?: string,
): Promise<SyncInstantlyCampaignsResult> {
  const apiKey = await getInstantlyApiKeyServer(organizationId);
  if (!apiKey) throw new Error("Instantly is not connected");

  const remoteList = await listInstantlyCampaigns(apiKey);
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const remote of remoteList) {
    const instantlyId = remote.id?.trim();
    const name = remote.name?.trim();
    if (!instantlyId || !name) {
      skipped += 1;
      continue;
    }

    const existing = await findNovaCampaignByInstantlyId(organizationId, instantlyId);

    if (existing) {
      const prevStats =
        existing.data.stats &&
        typeof existing.data.stats === "object" &&
        !Array.isArray(existing.data.stats)
          ? (existing.data.stats as Campaign["stats"])
          : undefined;
      const campaign = novaCampaignFromInstantly(existing.id, remote);
      campaign.stats = {
        ...campaign.stats,
        meetings: prevStats?.meetings ?? campaign.stats.meetings,
        closed: prevStats?.closed ?? campaign.stats.closed,
      };
      if (existing.data.startedAt) {
        campaign.startedAt = String(existing.data.startedAt);
      }
      await updateCampaignServer(existing.id, campaign, uid);
      updated += 1;
    } else {
      const novaId = `c-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const campaign = novaCampaignFromInstantly(novaId, remote);
      await persistCampaignServer(organizationId, campaign, uid);
      imported += 1;
    }
  }

  return {
    total: remoteList.length,
    imported,
    updated,
    skipped,
  };
}
