import Parser from "rss-parser";

export type ParsedRssItem = {
  guid?: string;
  link: string;
  title: string;
  content: string;
  contentSnippet?: string;
  creator?: string;
  dcCreator?: string;
  pubDate?: string;
  isoDate?: string;
};

const parser = new Parser({
  customFields: {
    item: [["dc:creator", "dcCreator"]],
  },
  timeout: 25_000,
});

export async function fetchRssFeedItems(feedUrl: string): Promise<ParsedRssItem[]> {
  const feed = await parser.parseURL(feedUrl);
  const out: ParsedRssItem[] = [];
  for (const item of feed.items ?? []) {
    const link = (item.link ?? item.guid ?? "").trim();
    if (!link) continue;
    const title = (item.title ?? "").trim() || link;
    const raw = item as unknown as Record<string, unknown>;
    const encoded =
      typeof raw["content:encoded"] === "string" ? raw["content:encoded"] : undefined;
    const content =
      (item.content ?? encoded ?? item.contentSnippet ?? item.summary ?? title).trim() || title;
    const contentSnippet = (item.contentSnippet ?? item.summary ?? "").trim() || undefined;
    out.push({
      guid: item.guid?.trim() || undefined,
      link,
      title,
      content,
      contentSnippet,
      creator: item.creator?.trim() || undefined,
      dcCreator:
        typeof item.dcCreator === "string"
          ? item.dcCreator.trim() || undefined
          : undefined,
      pubDate: item.pubDate?.trim() || undefined,
      isoDate: item.isoDate?.trim() || undefined,
    });
  }
  return out;
}

export function buildDedupeKey(item: Pick<ParsedRssItem, "guid" | "link">): string {
  const g = item.guid?.trim();
  if (g) return `guid:${g}`;
  return `link:${item.link.trim()}`;
}

export function resolvePublishedAt(item: ParsedRssItem): string {
  const iso = item.isoDate?.trim();
  if (iso) {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const pub = item.pubDate?.trim();
  if (pub) {
    const d = new Date(pub);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}
