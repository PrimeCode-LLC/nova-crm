"use client";

import * as React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { mergeCrmListPagesById } from "@/lib/db/crm-list-keyset";
import type { LeadListFilters } from "@/lib/db/crm-list-filters";
import { isWorkspaceCrmPollV2Enabled } from "@/lib/dashboard-kpi-v2-flags";
import { useSessionUserProfile } from "@/lib/hooks/use-session-user-profile";
import { seesAllLeadsInTenant } from "@/lib/workspace-hierarchy";

type Entity = "leads" | "accounts" | "contacts" | "deals";

export type CrmEntityPageFilters = LeadListFilters & {
  q?: string;
  ownerId?: string;
};

type PageJson = {
  ok?: boolean;
  enabled?: boolean;
  hasMore?: boolean;
  nextCursor?: string | null;
  error?: string;
} & Record<string, unknown>;

function filtersQueryKey(filters: CrmEntityPageFilters | undefined): string {
  if (!filters) return "";
  return JSON.stringify(filters);
}

function appendLeadFilters(params: URLSearchParams, filters: CrmEntityPageFilters | undefined) {
  if (!filters) return;
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  for (const s of filters.stages ?? []) params.append("stage", s);
  for (const c of filters.channels ?? []) params.append("channel", c);
  if (filters.ownerId?.trim()) params.set("ownerId", filters.ownerId.trim());
  if (filters.intakeKind?.trim()) params.set("intakeKind", filters.intakeKind.trim());
  if (filters.activeOnly) params.set("activeOnly", "1");
  if (filters.archivedOnly) params.set("archivedOnly", "1");
  if (filters.isIdle) params.set("isIdle", "1");
}

function appendEntityFilters(params: URLSearchParams, filters: CrmEntityPageFilters | undefined) {
  if (!filters) return;
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.ownerId?.trim()) params.set("ownerId", filters.ownerId.trim());
}

/**
 * Phase 5 — cursor-paginated CRM list via React Query.
 * Enabled when WORKSPACE_CRM_POLL_V2 is on (replaces all=1 workspace snapshot).
 *
 * Default `drain` is false. Pass `drain: true` for pages that still filter client-side.
 */
export function useCrmEntityPages(opts: {
  entity: Entity;
  enabled?: boolean;
  narrow?: boolean;
  limit?: number;
  filters?: CrmEntityPageFilters;
  /** Fetch `/api/org/crm-counts` for total rows (same narrow scope). */
  includeTotalCount?: boolean;
  /** Auto-fetch remaining pages (deduped by id). Default false. */
  drain?: boolean;
}) {
  const flagOn = isWorkspaceCrmPollV2Enabled();
  const enabled = Boolean(opts.enabled) && flagOn;
  const limit = opts.limit ?? 250;
  const filterKey = filtersQueryKey(opts.filters);
  const drain = opts.drain ?? false;

  const viewer = useSessionUserProfile(enabled && opts.narrow === undefined);
  const narrow =
    opts.narrow ?? (viewer.data ? !seesAllLeadsInTenant(viewer.data) : true);

  const query = useInfiniteQuery({
    queryKey: ["org", "crm-pages", opts.entity, narrow ? "1" : "0", limit, filterKey],
    enabled,
    initialPageParam: null as string | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (narrow) params.set("narrow", "1");
      if (pageParam) params.set("cursor", pageParam);
      if (opts.entity === "leads") {
        appendLeadFilters(params, opts.filters);
      } else {
        appendEntityFilters(params, opts.filters);
      }
      const res = await fetch(`/api/org/${opts.entity}?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as PageJson;
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `${opts.entity} page failed`);
      }
      const rows = Array.isArray(json[opts.entity]) ? json[opts.entity] : [];
      return {
        rows: rows as unknown[],
        nextCursor: typeof json.nextCursor === "string" ? json.nextCursor : null,
        hasMore: Boolean(json.hasMore),
      };
    },
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });

  React.useEffect(() => {
    if (!drain || !enabled) return;
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [
    drain,
    enabled,
    query.hasNextPage,
    query.isFetchingNextPage,
    query.fetchNextPage,
    query.data?.pages.length,
  ]);

  const items = React.useMemo(() => {
    const pages = (query.data?.pages ?? []).map((p) => p.rows as { id: string }[]);
    return mergeCrmListPagesById(pages);
  }, [query.data]);

  const countsQuery = useQuery({
    queryKey: ["org", "crm-counts", narrow ? "1" : "0"],
    enabled: enabled && Boolean(opts.includeTotalCount),
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (narrow) params.set("narrow", "1");
      const res = await fetch(`/api/org/crm-counts?${params.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        counts?: Record<Entity, number>;
        error?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "crm-counts failed");
      }
      return json.counts ?? null;
    },
  });

  const totalCount =
    opts.includeTotalCount && countsQuery.data
      ? (countsQuery.data[opts.entity] ?? null)
      : null;

  const loading =
    query.isLoading || (drain && enabled && Boolean(query.hasNextPage));

  return {
    flagOn,
    enabled,
    items,
    loading,
    totalCount,
    error: query.error instanceof Error ? query.error.message : null,
    hasNextPage: Boolean(query.hasNextPage),
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
  };
}
