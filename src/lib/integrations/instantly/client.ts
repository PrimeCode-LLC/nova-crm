import type {
  CreateInstantlyCampaignInput,
  InstantlyAccount,
  InstantlyAccountListResponse,
  InstantlyBulkAddLeadsResponse,
  InstantlyCampaign,
  InstantlyCampaignListResponse,
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

/** Map Instantly status codes to Nova campaign status. */
export function mapInstantlyStatusToNova(
  status: InstantlyCampaign["status"] | undefined,
): "draft" | "active" | "paused" | "done" {
  if (status === undefined || status === null) return "draft";
  const n = typeof status === "number" ? status : Number(status);
  if (!Number.isNaN(n)) {
    if (n === 1 || n === 2) return "active";
    if (n === 3) return "paused";
    if (n === 4) return "done";
    return "draft";
  }
  const s = String(status).toLowerCase();
  if (s.includes("active") || s.includes("running") || s.includes("launch")) return "active";
  if (s.includes("pause")) return "paused";
  if (s.includes("complete") || s.includes("done")) return "done";
  return "draft";
}

export function extractInstantlyStats(c: InstantlyCampaign): {
  sent: number;
  replied: number;
  opened: number;
} {
  return {
    sent: Number(c.emails_sent_count ?? 0),
    replied: Number(c.reply_count ?? 0),
    opened: Number(c.open_count ?? 0),
  };
}
