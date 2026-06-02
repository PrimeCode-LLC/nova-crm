import type {
  CreateInstantlyCampaignInput,
  InstantlyAccount,
  InstantlyAccountListResponse,
  InstantlyBulkAddLeadsResponse,
  InstantlyCampaign,
  InstantlyCampaignAnalytics,
  InstantlyCampaignListResponse,
  InstantlyLead,
  InstantlyLeadInput,
} from "./types";

const BASE = "https://api.instantly.ai/api/v2";

export class InstantlyApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "InstantlyApiError";
  }
}

async function instantlyFetch<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: string }).message)
        : body && typeof body === "object" && "error" in body
          ? String((body as { error: string }).error)
          : text || res.statusText;
    throw new InstantlyApiError(res.status, msg);
  }
  return body as T;
}

function normalizeCampaignList(raw: InstantlyCampaignListResponse | InstantlyCampaign[]): InstantlyCampaign[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.campaigns)) return raw.campaigns;
  return [];
}

function campaignListNextCursor(raw: InstantlyCampaignListResponse): string | null {
  const c = raw.next_cursor ?? raw.next_starting_after ?? raw.cursor;
  return typeof c === "string" && c.trim() ? c.trim() : null;
}

function normalizeAccountList(raw: InstantlyAccountListResponse): InstantlyAccount[] {
  if (Array.isArray(raw.items)) return raw.items;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.accounts)) return raw.accounts;
  return [];
}

/** Pick the largest numeric value (Instantly may send 0 for one metric and the real count on another). */
function pickAnalyticsMax(...values: unknown[]): number {
  let max = 0;
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

/** Instantly analytics responses may be a bare array or wrapped in items/data. */
function normalizeCampaignAnalytics(raw: unknown): InstantlyCampaignAnalytics[] {
  if (Array.isArray(raw)) return raw as InstantlyCampaignAnalytics[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.items)) return o.items as InstantlyCampaignAnalytics[];
    if (Array.isArray(o.data)) return o.data as InstantlyCampaignAnalytics[];
    if (typeof o.campaign_id === "string") {
      return [o as unknown as InstantlyCampaignAnalytics];
    }
    // Single-campaign analytics/overview object (no campaign_id on overview).
    if (
      "emails_sent_count" in o ||
      "reply_count" in o ||
      "reply_count_unique" in o ||
      "open_count" in o
    ) {
      return [o as unknown as InstantlyCampaignAnalytics];
    }
  }
  return [];
}

export type CampaignAnalyticsMaps = {
  byId: Map<string, InstantlyCampaignAnalytics>;
  byName: Map<string, InstantlyCampaignAnalytics>;
};

export function buildCampaignAnalyticsMaps(
  rows: InstantlyCampaignAnalytics[],
): CampaignAnalyticsMaps {
  const byId = new Map<string, InstantlyCampaignAnalytics>();
  const byName = new Map<string, InstantlyCampaignAnalytics>();
  for (const row of rows) {
    const idKey = normalizeInstantlyCampaignId(row.campaign_id);
    if (idKey) byId.set(idKey, row);
    const nameKey = row.campaign_name?.trim().toLowerCase();
    if (nameKey) byName.set(nameKey, row);
  }
  return { byId, byName };
}

export function resolveCampaignAnalytics(
  maps: CampaignAnalyticsMaps,
  instantlyId: string,
  campaignName?: string,
): InstantlyCampaignAnalytics | undefined {
  const byId = maps.byId.get(normalizeInstantlyCampaignId(instantlyId) ?? instantlyId);
  if (byId) return byId;
  const nameKey = campaignName?.trim().toLowerCase();
  if (nameKey) return maps.byName.get(nameKey);
  return undefined;
}

export function normalizeInstantlyCampaignId(id: string | undefined | null): string | null {
  const t = id?.trim();
  return t ? t.toLowerCase() : null;
}

export async function listInstantlyCampaigns(apiKey: string): Promise<InstantlyCampaign[]> {
  const all: InstantlyCampaign[] = [];
  let cursor: string | null = null;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page += 1) {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("starting_after", cursor);
    const raw = await instantlyFetch<InstantlyCampaignListResponse | InstantlyCampaign[]>(
      apiKey,
      `/campaigns?${qs.toString()}`,
    );
    const batch = normalizeCampaignList(raw);
    all.push(...batch);
    if (Array.isArray(raw)) break;
    const next = campaignListNextCursor(raw);
    if (!next || batch.length === 0) break;
    cursor = next;
  }

  return all;
}

/**
 * Fetch analytics for all campaigns (or a single campaign by id) from the
 * dedicated analytics endpoint: `GET /api/v2/campaigns/analytics`.
 * The list/get campaign endpoints do NOT return these fields.
 */
export async function getCampaignAnalytics(
  apiKey: string,
  campaignId?: string,
): Promise<InstantlyCampaignAnalytics[]> {
  const qs = new URLSearchParams();
  if (campaignId) qs.set("id", campaignId);
  const raw = await instantlyFetch<unknown>(apiKey, `/campaigns/analytics?${qs.toString()}`);
  return normalizeCampaignAnalytics(raw);
}

/** Fallback when per-campaign analytics omit reply counts. */
export async function getCampaignAnalyticsOverview(
  apiKey: string,
  campaignId: string,
): Promise<InstantlyCampaignAnalytics | undefined> {
  const qs = new URLSearchParams({ id: campaignId });
  const raw = await instantlyFetch<unknown>(apiKey, `/campaigns/analytics/overview?${qs.toString()}`);
  return normalizeCampaignAnalytics(raw)[0];
}

export type ExtractedCampaignStats = ReturnType<typeof extractInstantlyStats>;

export function mergeExtractedStats(
  ...parts: Array<ExtractedCampaignStats | null | undefined>
): ExtractedCampaignStats {
  const out: ExtractedCampaignStats = {
    sent: 0,
    replied: 0,
    opened: 0,
    bounced: 0,
    linkClicks: 0,
    unsubscribed: 0,
    leadsCount: 0,
    contacted: 0,
    completed: 0,
  };
  for (const p of parts) {
    if (!p) continue;
    out.sent = Math.max(out.sent, p.sent);
    out.replied = Math.max(out.replied, p.replied);
    out.opened = Math.max(out.opened, p.opened);
    out.bounced = Math.max(out.bounced, p.bounced);
    out.linkClicks = Math.max(out.linkClicks, p.linkClicks);
    out.unsubscribed = Math.max(out.unsubscribed, p.unsubscribed);
    out.leadsCount = Math.max(out.leadsCount, p.leadsCount);
    out.contacted = Math.max(out.contacted, p.contacted);
    out.completed = Math.max(out.completed, p.completed);
  }
  return out;
}

/** Paginated lead count for a campaign (optional Instantly list filter). */
export async function countLeadsForCampaign(
  apiKey: string,
  campaignId: string,
  filter?: string,
): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page += 1) {
    const body: Record<string, unknown> = {
      campaign: campaignId,
      distinct_contacts: true,
      limit: 100,
    };
    if (filter) body.filter = filter;
    if (cursor) body.starting_after = cursor;

    const raw = await instantlyFetch<{
      items?: unknown[];
      next_starting_after?: string;
    }>(apiKey, "/leads/list", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const items = Array.isArray(raw.items) ? raw.items : [];
    total += items.length;
    const next = raw.next_starting_after?.trim();
    if (!next || items.length === 0) break;
    cursor = next;
  }

  return total;
}

export function countRepliedLeadsForCampaign(apiKey: string, campaignId: string): Promise<number> {
  return countLeadsForCampaign(apiKey, campaignId, "FILTER_VAL_REPLIED");
}

/** Fetch every lead in an Instantly campaign (paginated). */
export async function listAllLeadsForInstantlyCampaign(
  apiKey: string,
  campaignId: string,
): Promise<InstantlyLead[]> {
  const all: InstantlyLead[] = [];
  let cursor: string | undefined;
  const maxPages = 500;

  for (let page = 0; page < maxPages; page += 1) {
    const body: Record<string, unknown> = {
      campaign: campaignId,
      limit: 100,
    };
    if (cursor) body.starting_after = cursor;

    const raw = await instantlyFetch<{
      items?: InstantlyLead[];
      next_starting_after?: string;
    }>(apiKey, "/leads/list", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const items = Array.isArray(raw.items) ? raw.items : [];
    all.push(...items);
    const next = raw.next_starting_after?.trim();
    if (!next || items.length === 0) break;
    cursor = next;
  }

  return all;
}

/**
 * Resolve campaign stats from analytics + overview APIs, then count replied leads if needed.
 */
export async function resolveCampaignStatsFromInstantly(
  apiKey: string,
  instantlyId: string,
  preloaded?: InstantlyCampaignAnalytics,
): Promise<{ stats: ExtractedCampaignStats; campaignStatus?: number }> {
  const sources: InstantlyCampaignAnalytics[] = [];
  if (preloaded) sources.push(preloaded);

  const preStats = preloaded
    ? extractInstantlyStats(preloaded)
    : {
        sent: 0,
        replied: 0,
        opened: 0,
        bounced: 0,
        linkClicks: 0,
        unsubscribed: 0,
        leadsCount: 0,
        contacted: 0,
        completed: 0,
      };
  const needsDetailFetch = !preloaded || preStats.sent === 0 || preStats.replied === 0;

  if (needsDetailFetch) {
    const [byIdRows, overview] = await Promise.all([
      getCampaignAnalytics(apiKey, instantlyId).catch((): InstantlyCampaignAnalytics[] => []),
      getCampaignAnalyticsOverview(apiKey, instantlyId).catch(() => undefined),
    ]);
    sources.push(...byIdRows);
    if (overview) sources.push(overview);
  }

  let stats = mergeExtractedStats(...sources.map((s) => extractInstantlyStats(s)));
  const campaignStatus = sources.find((s) => s.campaign_status != null)?.campaign_status;

  const needsReplied = stats.sent > 0 && stats.replied === 0;
  const needsContacted = stats.contacted === 0 && (stats.sent > 0 || stats.replied > 0);

  if (needsReplied || needsContacted) {
    const [fromReplied, fromContacted] = await Promise.all([
      needsReplied
        ? countRepliedLeadsForCampaign(apiKey, instantlyId).catch(() => 0)
        : Promise.resolve(0),
      needsContacted
        ? countLeadsForCampaign(apiKey, instantlyId, "FILTER_VAL_CONTACTED").catch(() => 0)
        : Promise.resolve(0),
    ]);
    if (fromReplied > 0) stats = { ...stats, replied: fromReplied };
    if (fromContacted > 0) stats = { ...stats, contacted: fromContacted };
  }

  if (stats.leadsCount === 0 && stats.contacted > 0) {
    stats = { ...stats, leadsCount: stats.contacted };
  }

  return { stats, campaignStatus };
}

export async function getInstantlyCampaign(
  apiKey: string,
  campaignId: string,
): Promise<InstantlyCampaign> {
  return instantlyFetch<InstantlyCampaign>(apiKey, `/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function createInstantlyCampaign(
  apiKey: string,
  input: CreateInstantlyCampaignInput,
): Promise<InstantlyCampaign> {
  return instantlyFetch<InstantlyCampaign>(apiKey, "/campaigns", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function patchInstantlyCampaign(
  apiKey: string,
  campaignId: string,
  patch: Record<string, unknown>,
): Promise<InstantlyCampaign> {
  return instantlyFetch<InstantlyCampaign>(apiKey, `/campaigns/${encodeURIComponent(campaignId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function activateInstantlyCampaign(apiKey: string, campaignId: string): Promise<void> {
  await instantlyFetch(apiKey, `/campaigns/${encodeURIComponent(campaignId)}/activate`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function pauseInstantlyCampaign(apiKey: string, campaignId: string): Promise<void> {
  await instantlyFetch(apiKey, `/campaigns/${encodeURIComponent(campaignId)}/pause`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listInstantlyAccounts(apiKey: string): Promise<InstantlyAccount[]> {
  const raw = await instantlyFetch<InstantlyAccountListResponse>(apiKey, "/accounts");
  return normalizeAccountList(raw);
}

export async function addInstantlyLeadsBulk(
  apiKey: string,
  input: { campaign_id: string; leads: InstantlyLeadInput[] },
): Promise<InstantlyBulkAddLeadsResponse> {
  return instantlyFetch<InstantlyBulkAddLeadsResponse>(apiKey, "/leads/add", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Default schedule for new campaigns (Mon–Fri 9–17 UTC). */
export function defaultInstantlySchedule(timezone = "Etc/UTC"): CreateInstantlyCampaignInput["campaign_schedule"] {
  return {
    schedules: [
      {
        days: [1, 2, 3, 4, 5],
        timing: { from: "09:00", to: "17:00" },
        timezone,
      },
    ],
  };
}

/**
 * Map Instantly v2 campaign_status to Nova status.
 * Instantly: 0=Draft, 1=Active, 2=Paused, 3=Completed, 4=Running subsequences.
 */
export function mapInstantlyStatusToNova(
  status: InstantlyCampaign["status"] | number | undefined,
): "draft" | "active" | "paused" | "done" {
  if (status === undefined || status === null) return "draft";
  const n = typeof status === "number" ? status : Number(status);
  if (!Number.isNaN(n)) {
    if (n === 0) return "draft";
    if (n === 1) return "active";
    if (n === 2) return "paused";
    if (n === 3) return "done";
    if (n === 4) return "active";
    if (n === -1 || n === -2 || n === -99) return "paused";
    return "draft";
  }
  const s = String(status).toLowerCase();
  if (s.includes("complete") || s.includes("done")) return "done";
  if (s.includes("pause")) return "paused";
  if (s.includes("active") || s.includes("running") || s.includes("launch") || s.includes("subsequence"))
    return "active";
  if (s.includes("draft")) return "draft";
  return "draft";
}

export function extractInstantlyStats(c: InstantlyCampaign | InstantlyCampaignAnalytics): {
  sent: number;
  replied: number;
  opened: number;
  bounced: number;
  linkClicks: number;
  unsubscribed: number;
  leadsCount: number;
  contacted: number;
  completed: number;
} {
  const a = c as InstantlyCampaignAnalytics;
  const row = c as unknown as Record<string, unknown>;
  // Do not use `??` between counts: reply_count_unique can be 0 while reply_count is 6.
  const replied = pickAnalyticsMax(
    a.reply_count,
    a.reply_count_unique,
    a.reply_count_unique_by_step,
    row.replies,
    row.unique_replies,
  );
  const opened = pickAnalyticsMax(
    a.open_count_unique,
    a.open_count,
    a.open_count_unique_by_step,
    row.unique_opened,
    row.opened,
  );
  return {
    sent: Number(c.emails_sent_count ?? row.emails_sent ?? 0),
    replied,
    opened,
    bounced: Number(c.bounced_count ?? 0),
    linkClicks: Number(c.link_click_count ?? 0),
    unsubscribed: Number(a.unsubscribed_count ?? 0),
    leadsCount: pickAnalyticsMax(a.leads_count, a.contacted_count, row.leads_count, row.leadsCount),
    contacted: pickAnalyticsMax(
      a.contacted_count,
      row.contacted_count,
      row.contactedCount,
      row.contacted,
    ),
    completed: Number(a.completed_count ?? 0),
  };
}
