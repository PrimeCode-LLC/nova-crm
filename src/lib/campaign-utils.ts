import type { Campaign } from "./types";

export function campaignReplyRate(c: Campaign): number {
  const { sent, replied } = c.stats;
  if (sent > 0) return (replied / sent) * 100;
  if (replied > 0) return 100;
  return 0;
}

/** Best-effort deep link for Instantly campaign refs from mock/sync data. */
export function instantlyCampaignHref(externalRef: string | undefined): string | null {
  if (!externalRef?.startsWith("instantly:")) return null;
  const slug = externalRef.slice("instantly:".length).trim();
  if (!slug) return null;
  return `https://app.instantly.ai/campaign/${encodeURIComponent(slug)}`;
}
