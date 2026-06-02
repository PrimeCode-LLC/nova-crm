import crypto from "crypto";
import {
  findNovaCampaignByInstantlyId,
  novaCampaignFromInstantly,
  persistCampaignServer,
  updateCampaignServer,
} from "./campaign-server";
import {
  buildCampaignAnalyticsMaps,
  getCampaignAnalytics,
  listInstantlyCampaigns,
  mapInstantlyStatusToNova,
  resolveCampaignAnalytics,
  resolveCampaignStatsFromInstantly,
} from "./client";
import { getInstantlyApiKeyServer } from "./secrets";
import type { Campaign } from "@/lib/types";
import type { InstantlyCampaignAnalytics } from "./types";

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

  const [remoteList, analyticsAll] = await Promise.all([
    listInstantlyCampaigns(apiKey),
    getCampaignAnalytics(apiKey).catch((): InstantlyCampaignAnalytics[] => []),
  ]);

  const analyticsMaps = buildCampaignAnalyticsMaps(analyticsAll);

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

    const preloaded = resolveCampaignAnalytics(analyticsMaps, instantlyId, name);
    const { stats: ex, campaignStatus } = await resolveCampaignStatsFromInstantly(
      apiKey,
      instantlyId,
      preloaded,
    );
    const novaStatus =
      campaignStatus != null
        ? mapInstantlyStatusToNova(campaignStatus)
        : mapInstantlyStatusToNova(remote.status);

    const existing = await findNovaCampaignByInstantlyId(organizationId, instantlyId);

    if (existing) {
      const prevStats =
        existing.data.stats &&
        typeof existing.data.stats === "object" &&
        !Array.isArray(existing.data.stats)
          ? (existing.data.stats as Campaign["stats"])
          : undefined;
      const campaign = novaCampaignFromInstantly(existing.id, remote);
      campaign.status = novaStatus;
      campaign.stats = {
        sent: ex.sent || prevStats?.sent || 0,
        replied: ex.replied,
        opened: ex.opened || prevStats?.opened || 0,
        bounced: ex.bounced || prevStats?.bounced || 0,
        linkClicks: ex.linkClicks || prevStats?.linkClicks || 0,
        unsubscribed: ex.unsubscribed || prevStats?.unsubscribed || 0,
        leadsCount: ex.leadsCount || prevStats?.leadsCount || 0,
        contacted: ex.contacted || prevStats?.contacted || 0,
        completed: ex.completed || prevStats?.completed || 0,
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
      campaign.status = novaStatus;
      campaign.stats = {
        ...campaign.stats,
        sent: ex.sent,
        replied: ex.replied,
        opened: ex.opened,
        bounced: ex.bounced,
        linkClicks: ex.linkClicks,
        unsubscribed: ex.unsubscribed,
        leadsCount: ex.leadsCount,
        contacted: ex.contacted,
        completed: ex.completed,
      };
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
