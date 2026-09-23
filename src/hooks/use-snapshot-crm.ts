"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { peekCrmEntity, rememberCrmEntities, subscribeCrmEntityCache } from "@/lib/crm/entity-cache";
import type { DealStageSum } from "@/lib/deals/stage-sum-money";
import type { StrategyDayProgress } from "@/lib/prospecting-strategy/progress";
import type { Lead } from "@/lib/types";

/** Same ceiling as `LEADS_LIST_MAX_PAGES` in list-leads-postgres (kept here so client bundles stay free of Prisma). */
const LEAD_LIST_MAX_PAGES = 40;

type LeadListPageJson = {
  ok?: boolean;
  leads?: Lead[];
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
};

async function fetchLeadListPages(
  base: Record<string, string>,
  maxPages: number,
): Promise<Lead[]> {
  const rows: Lead[] = [];
  let cursor: string | null = null;
  const pageCap = Math.max(1, Math.min(LEAD_LIST_MAX_PAGES, maxPages));
  for (let page = 0; page < pageCap; page += 1) {
    const params = new URLSearchParams(base);
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/org/leads?${params.toString()}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const json = (await res.json()) as LeadListPageJson;
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || "leads list failed");
    }
    if (Array.isArray(json.leads)) rows.push(...json.leads);
    if (!json.hasMore || !json.nextCursor) break;
    cursor = json.nextCursor;
  }
  return rows;
}

/** Ids from `ids` that are currently in the lead entity cache. Updates when the cache does. */
export function useCachedLeadIds(ids: readonly string[]): string {
  const key = React.useMemo(
    () => [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort().join(","),
    [ids],
  );
  return React.useSyncExternalStore(
    subscribeCrmEntityCache,
    () => {
      if (!key) return "";
      return key
        .split(",")
        .filter((id) => peekCrmEntity("leads", id))
        .join(",");
    },
    () => "",
  );
}

/** Owner totals from GET /api/org/crm-counts?byOwner=1. Default counts body is unchanged. */
export function useCrmLeadCountsByOwner(enabled: boolean) {
  return useQuery({
    queryKey: ["org", "crm-counts", "byOwner"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/org/crm-counts?byOwner=1", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        byOwner?: Record<string, number>;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "crm-counts failed");
      }
      return json.byOwner ?? {};
    },
  });
}

export function useCrmEntityTotals(enabled: boolean) {
  return useQuery({
    queryKey: ["org", "crm-counts", "totals"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetch("/api/org/crm-counts", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        counts?: { leads?: number; deals?: number; accounts?: number; contacts?: number } | null;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "crm-counts failed");
      }
      return json.counts;
    },
  });
}

/** 36h window. Stops when the server reports no further page — not a fixed 4-page cap. */
export const STRATEGY_DAY_WINDOW_MS = 36 * 60 * 60 * 1000;
/** Safety stop for a broken cursor. The createdSince filter is what bounds the set. */
export const STRATEGY_DAY_MAX_PAGES = 16;

export function strategyDayShouldFetchAnotherPage(
  pagesFetched: number,
  hasMore: boolean,
  nextCursor: string | null | undefined,
): boolean {
  return pagesFetched < STRATEGY_DAY_MAX_PAGES && hasMore && Boolean(nextCursor);
}

/**
 * Recent prospects for day-progress. Pages through the 36-hour window until
 * the list API reports no more rows. This is not the workspace `all=1` snapshot.
 */
export function useRecentStrategyLeads(enabled: boolean) {
  return useQuery({
    queryKey: ["org", "strategy-progress-leads"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const since = new Date(Date.now() - STRATEGY_DAY_WINDOW_MS).toISOString();
      const rows: Lead[] = [];
      let cursor: string | null = null;
      let pagesFetched = 0;
      while (pagesFetched < STRATEGY_DAY_MAX_PAGES) {
        const params = new URLSearchParams({
          intakeKind: "prospect",
          createdSince: since,
          limit: "250",
        });
        if (cursor) params.set("cursor", cursor);
        const res = await fetch(`/api/org/leads?${params.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        });
        const json = (await res.json()) as {
          ok?: boolean;
          leads?: Lead[];
          hasMore?: boolean;
          nextCursor?: string | null;
        };
        pagesFetched += 1;
        if (!res.ok || json.ok === false) break;
        if (Array.isArray(json.leads)) rows.push(...json.leads);
        if (!strategyDayShouldFetchAnotherPage(pagesFetched, Boolean(json.hasMore), json.nextCursor)) {
          break;
        }
        cursor = json.nextCursor ?? null;
      }
      return rows;
    },
  });
}

export type StrategyDayProgressResponse = {
  ok?: boolean;
  results?: {
    userId: string;
    strategyAssignmentIds: string[];
    progress: StrategyDayProgress;
  }[];
  truncated?: boolean;
  error?: string;
};

/**
 * Today's prospect progress computed on the server (org timezone, no client page cap).
 * `subjects` are the users and assignment filters to score. Members only receive their own row.
 */
export function findStrategyDayProgress(
  results:
    | readonly {
        userId: string;
        strategyAssignmentIds: readonly string[];
        progress: StrategyDayProgress;
      }[]
    | undefined,
  userId: string,
  strategyAssignmentIds: readonly string[],
): StrategyDayProgress | undefined {
  const wanted = [...strategyAssignmentIds].filter(Boolean).sort().join(",");
  return results?.find(
    (row) =>
      row.userId === userId &&
      [...row.strategyAssignmentIds].filter(Boolean).sort().join(",") === wanted,
  )?.progress;
}

export function useStrategyDayProgress(
  enabled: boolean,
  subjects: readonly { userId: string; strategyAssignmentIds: readonly string[] }[],
  outreachThreshold?: number,
) {
  const key = React.useMemo(
    () =>
      subjects
        .map((subject) => {
          const ids = [...subject.strategyAssignmentIds].filter(Boolean).sort().join(",");
          return `${subject.userId}:${ids}`;
        })
        .sort()
        .join("|"),
    [subjects],
  );
  return useQuery({
    queryKey: ["org", "strategy-day-progress", key, outreachThreshold ?? 45],
    enabled: enabled && key.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const parsed = key.split("|").filter(Boolean).map((part) => {
        const splitAt = part.indexOf(":");
        const userId = part.slice(0, splitAt);
        const strategyAssignmentIds = part.slice(splitAt + 1).split(",").filter(Boolean);
        return { userId, strategyAssignmentIds };
      });
      const res = await fetch("/api/org/strategy-day-progress", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          subjects: parsed,
          outreachThreshold: outreachThreshold ?? 45,
        }),
      });
      const json = (await res.json()) as StrategyDayProgressResponse;
      if (!res.ok || json.ok === false || !Array.isArray(json.results)) {
        throw new Error(json.error || "strategy day progress failed");
      }
      return { results: json.results, truncated: json.truncated === true };
    },
  });
}

export function useFilteredCrmCount(
  entity: "leads" | "accounts" | "contacts" | "deals",
  params: Record<string, string>,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["org", "crm-filter-count", entity, params],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const search = new URLSearchParams({ countOnly: "1", ...params });
      const res = await fetch(`/api/org/${entity}?${search.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as { ok?: boolean; totalCount?: number };
      if (!res.ok || json.ok === false) return 0;
      return typeof json.totalCount === "number" ? json.totalCount : 0;
    },
  });
}

/** Same ceiling as `parseIdList` / `ids` on GET /api/org/leads. */
export const LEAD_ID_HYDRATION_BATCH = 100;

/**
 * Unique sorted id batches for entity-cache hydration.
 * Default keeps the first 100 ids (existing callers: dashboard, inbox, wall).
 * `hydrateAll` keeps every id and splits into batches of 100 so none are dropped.
 */
export function planLeadHydrationBatches(
  ids: readonly string[],
  options?: { hydrateAll?: boolean; batchSize?: number },
): string[][] {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort();
  const capped = options?.hydrateAll ? unique : unique.slice(0, LEAD_ID_HYDRATION_BATCH);
  const size = Math.max(1, Math.floor(options?.batchSize ?? LEAD_ID_HYDRATION_BATCH));
  const batches: string[][] = [];
  for (let i = 0; i < capped.length; i += size) {
    batches.push(capped.slice(i, i + size));
  }
  return batches;
}

async function fetchLeadBatch(ids: readonly string[]): Promise<Lead[]> {
  const params = new URLSearchParams({ ids: ids.join(","), limit: String(LEAD_ID_HYDRATION_BATCH) });
  const res = await fetch(`/api/org/leads?${params.toString()}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const json = (await res.json()) as { ok?: boolean; leads?: Lead[] };
  if (!res.ok || json.ok === false || !Array.isArray(json.leads)) {
    throw new Error("leads by id failed");
  }
  return json.leads;
}

/**
 * Load missing leads into the entity cache so getLeadById can resolve them.
 * Without `hydrateAll`, ids past the first 100 stay unresolved (dashboard widgets).
 * With `hydrateAll`, every id is requested in batches of 100. One retry per batch.
 * Does not call GET /api/org/leads/[id]: that route is not member-narrowed.
 */
export function useRememberLeadsByIds(
  ids: readonly string[],
  enabled: boolean,
  options?: { hydrateAll?: boolean },
): { error: boolean } {
  const hydrateAll = options?.hydrateAll === true;
  const key = React.useMemo(() => {
    const batches = planLeadHydrationBatches(ids, { hydrateAll });
    return batches.map((batch) => batch.join(",")).join("|");
  }, [ids, hydrateAll]);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !key) {
      setError(false);
      return;
    }
    const batches = key.split("|").map((part) => part.split(",").filter(Boolean));
    let cancelled = false;
    void (async () => {
      let failed = false;
      for (const batch of batches) {
        const missing = batch.filter((id) => !peekCrmEntity("leads", id));
        if (!missing.length) continue;
        let loaded = false;
        for (let attempt = 0; attempt < 2 && !loaded; attempt += 1) {
          try {
            const leads = await fetchLeadBatch(missing);
            if (cancelled) return;
            rememberCrmEntities("leads", leads);
            loaded = true;
          } catch {
            if (attempt === 1) failed = true;
          }
        }
      }
      if (!cancelled) setError(failed);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return { error };
}

/**
 * Reply-review, reply-action, and a capped idle slice for Needs attention
 * when the workspace snapshot is empty. One query so the widget loads once.
 * Server filters are supersets; the widget still applies the client predicates.
 * Failures degrade to an empty list (the widget's empty state).
 */
export function useNeedsAttentionLeads(opts: {
  enabled: boolean;
  narrow: boolean;
  idleLimit: number;
}) {
  const idleLimit = Math.max(1, Math.min(8, Math.floor(opts.idleLimit)));
  return useQuery({
    queryKey: ["org", "needs-attention-leads", opts.narrow, idleLimit],
    enabled: opts.enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const narrow = opts.narrow ? "1" : "0";
      try {
        const [review, action, idle] = await Promise.all([
          fetchLeadListPages(
            { replyReviewStatus: "pending", narrow, limit: "250" },
            LEAD_LIST_MAX_PAGES,
          ),
          fetchLeadListPages(
            { replyActionStatus: "pending", narrow, limit: "250" },
            LEAD_LIST_MAX_PAGES,
          ),
          fetchLeadListPages(
            {
              isIdle: "1",
              activeOnly: "1",
              intakeKind: "sales_lead",
              narrow,
              limit: String(idleLimit),
            },
            1,
          ),
        ]);
        const byId = new Map<string, Lead>();
        for (const lead of [...review, ...action, ...idle]) {
          if (lead?.id) byId.set(lead.id, lead);
        }
        return [...byId.values()];
      } catch (err) {
        console.warn("[needs-attention] lead list failed", err);
        return [] as Lead[];
      }
    },
  });
}

/** Account money totals. `null` when the request fails so the caller can keep the page sum. */
export function useDealStageSums(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["org", "deal-stage-sums", accountId],
    enabled: enabled && Boolean(accountId),
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, DealStageSum> | null> => {
      const params = new URLSearchParams({ sumValue: "1", accountId });
      const res = await fetch(`/api/org/deals?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        enabled?: boolean;
        sumByStage?: Record<string, DealStageSum>;
      };
      if (!res.ok || json.ok === false || json.enabled === false || !json.sumByStage) return null;
      return json.sumByStage;
    },
  });
}
