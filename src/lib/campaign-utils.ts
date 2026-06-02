import type { Campaign } from "./types";

/**
 * Match Instantly campaign list: reply rate = replies ÷ contacted leads
 * (leads who started the sequence), not ÷ emails sent.
 */
export function campaignReplyRate(c: Campaign): number {
  const { sent, replied, leadsCount, contacted } = c.stats;
  const denom =
    contacted && contacted > 0
      ? contacted
      : leadsCount && leadsCount > 0
        ? leadsCount
        : sent;
  if (denom > 0) return (replied / denom) * 100;
  if (replied > 0) return 100;
  return 0;
}

export function campaignOpenRate(c: Campaign): number {
  const { sent, opened } = c.stats;
  if (sent > 0 && opened) return (opened / sent) * 100;
  return 0;
}

export function campaignBounceRate(c: Campaign): number {
  const { sent, bounced } = c.stats;
  if (sent > 0 && bounced) return (bounced / sent) * 100;
  return 0;
}

/** Best-effort deep link for Instantly campaign refs from mock/sync data. */
export function instantlyCampaignHref(externalRef: string | undefined): string | null {
  if (!externalRef?.startsWith("instantly:")) return null;
  const slug = externalRef.slice("instantly:".length).trim();
  if (!slug) return null;
  return `https://app.instantly.ai/campaign/${encodeURIComponent(slug)}`;
}
