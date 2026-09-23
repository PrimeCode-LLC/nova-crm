"use client";

import * as React from "react";
import { useQueries } from "@tanstack/react-query";

import { rememberCrmEntities } from "@/lib/crm/entity-cache";
import { KANBAN_STAGES } from "@/lib/constants";
import type { Lead, PipelineStage } from "@/lib/types";

type StagePage = {
  rows: Lead[];
  nextCursor: string | null;
  hasMore: boolean;
};

async function fetchStagePage(
  stage: PipelineStage,
  cursor: string | null,
  q: string,
): Promise<StagePage> {
  const params = new URLSearchParams();
  params.set("limit", "40");
  params.set("stage", stage);
  params.set("activeOnly", "1");
  if (q.trim()) params.set("q", q.trim());
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
    error?: string;
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || "Kanban stage page failed");
  }
  return {
    rows: Array.isArray(json.leads) ? json.leads : [],
    nextCursor: typeof json.nextCursor === "string" ? json.nextCursor : null,
    hasMore: Boolean(json.hasMore),
  };
}

/**
 * One cursor page per pipeline stage. Does not walk remaining pages.
 */
export function useKanbanStagePages(enabled: boolean, query: string) {
  const q = query.trim();
  const queries = useQueries({
    queries: KANBAN_STAGES.map((stage) => ({
      queryKey: ["org", "kanban-stage", stage, q],
      enabled,
      staleTime: 30_000,
      queryFn: () => fetchStagePage(stage, null, q),
    })),
  });

  const [more, setMore] = React.useState<Partial<Record<PipelineStage, Lead[]>>>({});
  const [moreCursor, setMoreCursor] = React.useState<
    Partial<Record<PipelineStage, { cursor: string | null; hasMore: boolean }>>
  >({});

  React.useEffect(() => {
    setMore({});
    setMoreCursor({});
  }, [q, enabled]);

  const leads = React.useMemo(() => {
    const rows: Lead[] = [];
    KANBAN_STAGES.forEach((stage, index) => {
      const page = queries[index]?.data;
      if (page?.rows) rows.push(...page.rows);
      const extra = more[stage];
      if (extra?.length) rows.push(...extra);
    });
    return rows;
  }, [queries, more]);

  React.useEffect(() => {
    if (leads.length) rememberCrmEntities("leads", leads);
  }, [leads]);

  const hasMore = KANBAN_STAGES.some((stage, index) => {
    const extra = moreCursor[stage];
    if (extra) return extra.hasMore;
    return Boolean(queries[index]?.data?.hasMore);
  });

  const loadMore = React.useCallback(async () => {
    await Promise.all(
      KANBAN_STAGES.map(async (stage, index) => {
        const page = queries[index]?.data;
        const cursorState = moreCursor[stage];
        const has = cursorState ? cursorState.hasMore : Boolean(page?.hasMore);
        const cursor = cursorState ? cursorState.cursor : (page?.nextCursor ?? null);
        if (!has || !cursor) return;
        const next = await fetchStagePage(stage, cursor, q);
        setMore((prev) => ({ ...prev, [stage]: [...(prev[stage] ?? []), ...next.rows] }));
        setMoreCursor((prev) => ({
          ...prev,
          [stage]: { cursor: next.nextCursor, hasMore: next.hasMore },
        }));
      }),
    );
  }, [moreCursor, q, queries]);

  const loading = queries.some((query) => query.isLoading);
  return { leads, loading, hasMore, loadMore };
}
