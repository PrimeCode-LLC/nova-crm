"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtDate, fmtRelative } from "@/lib/format";
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { rankAssignedStrategies, type AssignedStrategyMatch } from "@nova/scoring";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { Account, Contact, Lead, ScraperRawItem } from "@/lib/types";
import {
  getScraperCategoryLabel,
  getScraperPlatformLabel,
  SCRAPER_CATEGORY_PRESETS,
  SCRAPER_PLATFORM_PRESETS,
} from "@/lib/scrapers/labels";
import { RAW_ITEM_RETENTION_DAYS } from "@/lib/scrapers/default-feeds";
import { IntakeItemActions } from "@/components/intake/intake-item-actions";
import { IntakeItemBody } from "@/components/intake/intake-item-body";
import { IntakeKeywordFilters } from "@/components/intake/intake-keyword-filters";
import { IntakeQualityBadge } from "@/components/intake/intake-quality-badge";
import {
  intakeKeywordFiltersActive,
  matchesAnyKeyword,
  mergeTeamAndPersonalKeywords,
  rawItemSearchHaystack,
} from "@/lib/intake/keyword-filter";
import type { OrganizationIntakeFilterDefaults } from "@/lib/types";
import { EMPTY_INTAKE_FILTER_DEFAULTS } from "@/lib/intake/intake-filter-defaults";
import { useIntakeQualityScores } from "@/lib/intake/use-intake-quality-scores";
import { intakeItemPlainText } from "@/lib/intent/score-intake-item";
import { useProspectingStrategyData } from "@/lib/hooks/use-prospecting-strategy-data";
import { formatElapsed, useElapsedSeconds } from "@/lib/hooks/use-elapsed-seconds";
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { roleAtLeast } from "@/lib/platform/org-role";
import { userCanDeleteIntakePool, userHasAdminFeature } from "@/lib/admin-feature-access";
import { canAction } from "@/lib/permissions/can";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { cn } from "@/lib/utils";

const ALL = "__all__" as const;
const ANY_MY_STRATEGY = "__any_my_strategy__" as const;
const NO_STRATEGY_MATCH = "__no_strategy_match__" as const;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
type QualityFilter = "all" | "no_signals" | "not_matching" | "has_signals" | "ready";
type SortMode = "newest" | "best_match";
type PoolView = "available" | "dismissed";
/** Soft auto-refresh when returning to the tab (ms). */
const VISIBILITY_REFRESH_MIN_MS = 90_000;

function localYmdFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function passesPublishedDateRange(iso: string, fromYmd: string, toYmd: string): boolean {
  if (!fromYmd && !toYmd) return true;
  const rowYmd = localYmdFromIso(iso);
  if (!rowYmd) return true;
  let from = fromYmd;
  let to = toYmd;
  if (from && to && from > to) [from, to] = [to, from];
  if (from && rowYmd < from) return false;
  if (to && rowYmd > to) return false;
  return true;
}

type IntakePoolFetchResult = {
  ok: boolean;
  data: { items?: ScraperRawItem[]; error?: string };
};

const inFlightIntakePoolRequests = new Map<string, Promise<IntakePoolFetchResult>>();

function fetchIntakePoolOnce(path: string): Promise<IntakePoolFetchResult> {
  const existing = inFlightIntakePoolRequests.get(path);
  if (existing) return existing;

  const request = fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then(async (response) => ({
      ok: response.ok,
      data: (await response.json()) as IntakePoolFetchResult["data"],
    }))
    .finally(() => {
      if (inFlightIntakePoolRequests.get(path) === request) {
        inFlightIntakePoolRequests.delete(path);
      }
    });
  inFlightIntakePoolRequests.set(path, request);
  return request;
}

export default function IntakePoolPage() {
  const ws = useWorkspace();
  const prospecting = useProspectingStrategyData();
  const router = useRouter();
  const navAccess = useNavAccessContext();
  const viewer = ws.getUserById(ws.currentUserId);
  const permissionSubject = {
    roleId: viewer?.roleId ?? navAccess.roleId ?? "salesperson",
    isSuperAdmin: Boolean(viewer?.isSuperAdmin || navAccess.isSuperAdmin),
    featureGrants: viewer?.featureGrants ?? navAccess.featureGrants,
    orgRole: viewer?.orgRole ?? navAccess.orgRole,
    roleSnapshot: navAccess.roleSnapshot,
  };
  const canDeleteIntake = userCanDeleteIntakePool(permissionSubject, navAccess.orgRole);
  const canRunScrapers =
    canAction(permissionSubject, "scrapers.run") ||
    userHasAdminFeature(permissionSubject, "scrapers", navAccess.orgRole);
  const canManageFeeds = userHasAdminFeature(
    permissionSubject,
    "scrapers",
    navAccess.orgRole,
  );
  const [items, setItems] = React.useState<ScraperRawItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [runningScrapers, setRunningScrapers] = React.useState(false);
  const [poolView, setPoolView] = React.useState<PoolView>("available");
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [fetchProgress, setFetchProgress] = React.useState<{
    done: number;
    total: number;
    newTotal: number;
    feedName?: string;
  } | null>(null);
  const [platform, setPlatform] = React.useState<string>(ALL);
  const [category, setCategory] = React.useState<string>(ALL);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [qualityFilter, setQualityFilter] = React.useState<QualityFilter>("all");
  const [minimumScore, setMinimumScore] = React.useState("");
  const [maximumScore, setMaximumScore] = React.useState("");
  const [strategyFilter, setStrategyFilter] = React.useState<string>(ALL);
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] =
    React.useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [teamDefaults, setTeamDefaults] = React.useState<OrganizationIntakeFilterDefaults>({
    ...EMPTY_INTAKE_FILTER_DEFAULTS,
  });
  const [personalIncludeKeywords, setPersonalIncludeKeywords] = React.useState<string[]>([]);
  const [personalExcludeKeywords, setPersonalExcludeKeywords] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<{
    itemId: string;
    action: "assign" | "queue" | "dismiss" | "delete";
  } | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = React.useState<null | "all" | "selected">(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [bulkProgress, setBulkProgress] = React.useState<{ done: number; total: number } | null>(
    null,
  );
  const [bulkDeleteResult, setBulkDeleteResult] = React.useState<{
    deleted: number;
    total: number;
    emptied?: boolean;
  } | null>(null);

  const loadSequenceRef = React.useRef(0);
  const lastFetchAtRef = React.useRef(0);
  const itemsLenRef = React.useRef(0);
  const runningScrapersRef = React.useRef(false);
  React.useEffect(() => {
    itemsLenRef.current = items.length;
  }, [items.length]);
  React.useEffect(() => {
    runningScrapersRef.current = runningScrapers;
  }, [runningScrapers]);

  const effectiveKeywords = React.useMemo(
    () =>
      mergeTeamAndPersonalKeywords(teamDefaults, {
        includeKeywords: personalIncludeKeywords,
        excludeKeywords: personalExcludeKeywords,
      }),
    [teamDefaults, personalIncludeKeywords, personalExcludeKeywords],
  );
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const searchHaystackById = React.useMemo(
    () => new Map(items.map((item) => [item.id, rawItemSearchHaystack(item)])),
    [items],
  );

  const {
    qualityById,
    scoring: scoringQuality,
    scored: scoringScored,
    total: scoringTotal,
  } = useIntakeQualityScores(items, ws.intentPlaybook);
  const myActiveAssignments = React.useMemo(
    () => activeAssignmentsForUser(prospecting.assignments, ws.currentUserId),
    [prospecting.assignments, ws.currentUserId],
  );
  const assignedStrategies = React.useMemo(() => {
    const assignedIds = new Set(myActiveAssignments.map((assignment) => assignment.strategyId));
    return prospecting.strategies
      .filter((strategy) => assignedIds.has(strategy.id) && strategy.status === "published")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [myActiveAssignments, prospecting.strategies]);
  const strategyMatchesById = React.useMemo(() => {
    const matches = new Map<string, AssignedStrategyMatch[]>();
    if (myActiveAssignments.length === 0) return matches;

    for (const item of items) {
      const quality = qualityById.get(item.id);
      if (!quality) continue;
      const { title, body } = intakeItemPlainText(item);
      const ranked = rankAssignedStrategies({
        page: { title, text: body },
        quality,
        assignments: myActiveAssignments,
        strategies: assignedStrategies,
        personas: prospecting.personas,
      });
      matches.set(item.id, ranked);
    }
    return matches;
  }, [
    assignedStrategies,
    items,
    myActiveAssignments,
    prospecting.personas,
    qualityById,
  ]);

  const filteredItems = React.useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    const parsedMinimumScore = Number(minimumScore);
    const hasMinimumScore =
      minimumScore.trim() !== "" && Number.isFinite(parsedMinimumScore);
    const parsedMaximumScore = Number(maximumScore);
    const hasMaximumScore =
      maximumScore.trim() !== "" && Number.isFinite(parsedMaximumScore);
    const filtered = items.filter((item) => {
      if (platform !== ALL && item.platform !== platform) return false;
      if (category !== ALL && item.category !== category) return false;
      const haystack = searchHaystackById.get(item.id) ?? "";
      if (q && !haystack.includes(q)) return false;
      if (
        effectiveKeywords.excludeKeywords.length > 0 &&
        matchesAnyKeyword(haystack, effectiveKeywords.excludeKeywords)
      ) return false;
      if (
        effectiveKeywords.includeKeywords.length > 0 &&
        !matchesAnyKeyword(haystack, effectiveKeywords.includeKeywords)
      ) return false;
      if (!passesPublishedDateRange(item.publishedAt, dateFrom, dateTo)) return false;
      const quality = qualityById.get(item.id);
      const score = quality?.score ?? 0;
      const strategyMatches = strategyMatchesById.get(item.id) ?? [];
      const qualifyingStrategyMatches = strategyMatches.filter(
        (match) =>
          !match.disqualified &&
          match.missingRequiredSignalIds.length === 0 &&
          match.score >= ws.intentPlaybook.outreachThreshold,
      );
      if (qualityFilter === "no_signals" && (quality?.signalCount ?? 0) !== 0) return false;
      if (qualityFilter === "not_matching" && score >= ws.intentPlaybook.outreachThreshold) {
        return false;
      }
      if (qualityFilter === "has_signals" && !(quality && quality.signalCount > 0)) return false;
      if (qualityFilter === "ready" && !(quality && quality.meetsThreshold)) return false;
      if (hasMinimumScore && score < Math.max(0, Math.min(100, parsedMinimumScore))) return false;
      if (hasMaximumScore && score > Math.max(0, Math.min(100, parsedMaximumScore))) return false;
      if (
        strategyFilter === ANY_MY_STRATEGY &&
        qualifyingStrategyMatches.length === 0
      ) {
        return false;
      }
      if (
        strategyFilter === NO_STRATEGY_MATCH &&
        qualifyingStrategyMatches.length > 0
      ) {
        return false;
      }
      if (
        strategyFilter !== ALL &&
        strategyFilter !== ANY_MY_STRATEGY &&
        strategyFilter !== NO_STRATEGY_MATCH &&
        !qualifyingStrategyMatches.some((match) => match.strategyId === strategyFilter)
      ) {
        return false;
      }
      return true;
    });

    if (sortMode === "best_match") {
      return [...filtered].sort((a, b) => {
        const sa = qualityById.get(a.id)?.score ?? 0;
        const sb = qualityById.get(b.id)?.score ?? 0;
        if (sb !== sa) return sb - sa;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });
    }
    return filtered;
  }, [
    items,
    platform,
    category,
    deferredSearchQuery,
    searchHaystackById,
    effectiveKeywords,
    dateFrom,
    dateTo,
    qualityFilter,
    minimumScore,
    maximumScore,
    strategyFilter,
    sortMode,
    qualityById,
    strategyMatchesById,
    ws.intentPlaybook.outreachThreshold,
  ]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPageIndex = Math.min(pageIndex, totalPages - 1);
  const pageStart = currentPageIndex * pageSize;
  const paginatedItems = filteredItems.slice(pageStart, pageStart + pageSize);
  const platformCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.platform) continue;
      counts.set(item.platform, (counts.get(item.platform) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const categoryCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.category) continue;
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return counts;
  }, [items]);
  const strategyCounts = React.useMemo(() => {
    const threshold = ws.intentPlaybook.outreachThreshold;
    let anyMatch = 0;
    let noMatch = 0;
    const byStrategy = new Map<string, number>();

    for (const item of items) {
      const qualifying = (strategyMatchesById.get(item.id) ?? []).filter(
        (match) =>
          !match.disqualified &&
          match.missingRequiredSignalIds.length === 0 &&
          match.score >= threshold,
      );
      if (qualifying.length === 0) {
        noMatch += 1;
        continue;
      }
      anyMatch += 1;
      const seen = new Set<string>();
      for (const match of qualifying) {
        if (seen.has(match.strategyId)) continue;
        seen.add(match.strategyId);
        byStrategy.set(match.strategyId, (byStrategy.get(match.strategyId) ?? 0) + 1);
      }
    }

    return {
      all: items.length,
      any: anyMatch,
      none: noMatch,
      byStrategy,
    };
  }, [items, strategyMatchesById, ws.intentPlaybook.outreachThreshold]);
  const qualityCounts = React.useMemo(() => {
    const threshold = ws.intentPlaybook.outreachThreshold;
    let noSignals = 0;
    let notMatching = 0;
    let hasSignals = 0;
    let ready = 0;

    for (const item of items) {
      const quality = qualityById.get(item.id);
      const signalCount = quality?.signalCount ?? 0;
      const score = quality?.score ?? 0;
      if (signalCount === 0) noSignals += 1;
      if (score < threshold) notMatching += 1;
      if (quality && signalCount > 0) hasSignals += 1;
      if (quality?.meetsThreshold) ready += 1;
    }

    return {
      all: items.length,
      no_signals: noSignals,
      not_matching: notMatching,
      has_signals: hasSignals,
      ready,
    };
  }, [items, qualityById, ws.intentPlaybook.outreachThreshold]);
  const categoryOptions = React.useMemo(() => {
    const dynamic = new Set(items.map((item) => item.category).filter(Boolean));
    for (const preset of SCRAPER_CATEGORY_PRESETS) dynamic.add(preset);
    return Array.from(dynamic).sort((a, b) =>
      getScraperCategoryLabel(a).localeCompare(getScraperCategoryLabel(b)),
    );
  }, [items]);
  const platformOptions = React.useMemo(() => {
    const dynamic = new Set(items.map((item) => item.platform).filter(Boolean));
    for (const preset of SCRAPER_PLATFORM_PRESETS) dynamic.add(preset);
    return Array.from(dynamic).sort((a, b) =>
      getScraperPlatformLabel(a).localeCompare(getScraperPlatformLabel(b)),
    );
  }, [items]);

  const keywordFiltersActive =
    intakeKeywordFiltersActive(teamDefaults.includeKeywords, teamDefaults.excludeKeywords) ||
    intakeKeywordFiltersActive(personalIncludeKeywords, personalExcludeKeywords);
  const canManageTeamDefaults = roleAtLeast(ws.viewerOrgRole, "admin");
  const filtersActive =
    platform !== ALL ||
    category !== ALL ||
    searchQuery.trim().length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    keywordFiltersActive ||
    qualityFilter !== "all" ||
    minimumScore.trim().length > 0 ||
    maximumScore.trim().length > 0 ||
    strategyFilter !== ALL ||
    sortMode !== "newest";
  const advancedFilterCount = [
    platform !== ALL,
    category !== ALL,
    dateFrom.length > 0,
    dateTo.length > 0,
    keywordFiltersActive,
    qualityFilter !== "all",
    minimumScore.trim().length > 0,
    maximumScore.trim().length > 0,
    strategyFilter !== ALL,
  ].filter(Boolean).length;

  function clearFilters() {
    setPlatform(ALL);
    setCategory(ALL);
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
    setPersonalIncludeKeywords([]);
    setPersonalExcludeKeywords([]);
    setQualityFilter("all");
    setMinimumScore("");
    setMaximumScore("");
    setStrategyFilter(ALL);
    setSortMode("newest");
  }

  const fetchElapsed = useElapsedSeconds(runningScrapers);
  const refreshElapsed = useElapsedSeconds(refreshing && !runningScrapers);
  const poolBusy = runningScrapers || refreshing;
  const statusBusy = poolBusy || scoringQuality;
  const fetchProgressPercent =
    fetchProgress && fetchProgress.total > 0
      ? Math.min(100, Math.round((fetchProgress.done / fetchProgress.total) * 100))
      : 0;
  const scoringProgressPercent =
    scoringQuality && scoringTotal > 0
      ? Math.min(100, Math.round((scoringScored / scoringTotal) * 100))
      : 0;

  let poolStatusLabel: string;
  if (loading && items.length === 0) {
    poolStatusLabel = "Loading…";
  } else if (runningScrapers) {
    if (fetchProgress && fetchProgress.total > 0) {
      const feedBit = fetchProgress.feedName ? ` · ${fetchProgress.feedName}` : "";
      poolStatusLabel = `Fetching feeds ${fetchProgress.done}/${fetchProgress.total} · ${fetchProgress.newTotal} new${feedBit}`;
    } else if (fetchElapsed > 0) {
      poolStatusLabel = `Starting feed run… ${formatElapsed(fetchElapsed)}`;
    } else {
      poolStatusLabel = "Starting feed run…";
    }
  } else if (refreshing) {
    poolStatusLabel =
      refreshElapsed > 0
        ? `Refreshing list… ${formatElapsed(refreshElapsed)}`
        : "Refreshing list…";
  } else if (scoringQuality) {
    poolStatusLabel = `Scoring matches… ${scoringScored}/${scoringTotal}`;
  } else if (filtersActive) {
    poolStatusLabel = `${filteredItems.length} of ${items.length} shown`;
  } else {
    poolStatusLabel =
      poolView === "dismissed"
        ? `${items.length} dismissed`
        : `${items.length} available`;
  }

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));
  const allPageSelected =
    paginatedItems.length > 0 && paginatedItems.every((item) => selectedIds.has(item.id));
  const somePageSelected =
    !allPageSelected && paginatedItems.some((item) => selectedIds.has(item.id));

  React.useEffect(() => {
    if (ws.isDemo) return;
    void (async () => {
      try {
        const res = await fetch("/api/org/intake-filter-defaults", { credentials: "same-origin" });
        const data = (await res.json()) as {
          defaults?: OrganizationIntakeFilterDefaults;
        };
        if (res.ok && data.defaults) {
          setTeamDefaults(data.defaults);
        }
      } catch {
        /* optional — personal filters still work */
      }
    })();
  }, [ws.isDemo, ws.organizationId]);

  const load = React.useCallback(
    async (opts?: { soft?: boolean; quiet?: boolean }) => {
      if (ws.isDemo) {
        setItems([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const soft = opts?.soft ?? itemsLenRef.current > 0;
      const quiet = opts?.quiet === true;
      const loadSequence = ++loadSequenceRef.current;

      // Quiet reloads (e.g. after Fetch) keep a single primary busy state instead of
      // stacking Fetching + Updating on the header and status row.
      if (soft && !quiet) setRefreshing(true);
      else if (!soft) setLoading(true);

      try {
        const params = new URLSearchParams({ status: poolView, limit: "200" });
        const { ok, data } = await fetchIntakePoolOnce(`/api/org/scraper-raw?${params}`);
        if (loadSequence !== loadSequenceRef.current) return;
        if (!ok) {
          toast.error(data.error ?? "Could not load intake pool");
          if (!soft) setItems([]);
          return;
        }
        const nextItems = data.items ?? [];
        setItems(nextItems);
        setSelectedIds((previous) => {
          if (previous.size === 0) return previous;
          const availableIds = new Set(nextItems.map((item) => item.id));
          const next = new Set(Array.from(previous).filter((id) => availableIds.has(id)));
          return next.size === previous.size ? previous : next;
        });
        lastFetchAtRef.current = Date.now();
      } catch {
        if (loadSequence !== loadSequenceRef.current) return;
        toast.error("Network error loading intake pool");
      } finally {
        if (loadSequence === loadSequenceRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [ws.isDemo, poolView],
  );

  React.useEffect(() => {
    // Soft refresh on mount / when load identity changes.
    // Skip while a feed run is in flight so Fetch doesn't look like it restarts mid-run.
    if (runningScrapersRef.current) return;
    void load({ soft: itemsLenRef.current > 0 });
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    setSelectedIds(new Set());
    setPageIndex(0);
  }, [poolView]);

  React.useEffect(() => {
    if (advancedFilterCount > 0) setFiltersOpen(true);
  }, [advancedFilterCount]);

  React.useEffect(() => {
    setPageIndex(0);
  }, [
    platform,
    category,
    deferredSearchQuery,
    dateFrom,
    dateTo,
    qualityFilter,
    minimumScore,
    maximumScore,
    strategyFilter,
    sortMode,
    pageSize,
  ]);

  React.useEffect(() => {
    if (ws.isDemo) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (runningScrapersRef.current) return;
      if (Date.now() - lastFetchAtRef.current < VISIBILITY_REFRESH_MIN_MS) return;
      void load({ soft: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, ws.isDemo]);

  async function runAllScrapers() {
    if (ws.isDemo || !canRunScrapers) return;
    setRunningScrapers(true);
    setFetchProgress({ done: 0, total: 0, newTotal: 0 });
    try {
      const res = await fetch("/api/org/scraper-feeds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_all", streamProgress: true }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Could not run scrapers");
        return;
      }
      if (!res.body) throw new Error("Feed progress stream unavailable");

      type RunEvent =
        | { type: "start" }
        | {
            type: "progress";
            done: number;
            total: number;
            newTotal: number;
            feedName?: string;
            newCount?: number;
            ok?: boolean;
            error?: string;
          }
        | { type: "complete"; newTotal: number; feedCount: number }
        | { type: "error"; error: string };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: Extract<RunEvent, { type: "complete" }> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as RunEvent;
          if (event.type === "progress") {
            setFetchProgress({
              done: event.done,
              total: event.total,
              newTotal: event.newTotal,
              feedName: event.feedName,
            });
          } else if (event.type === "complete") {
            completed = event;
            setFetchProgress({
              done: event.feedCount,
              total: event.feedCount,
              newTotal: event.newTotal,
            });
          } else if (event.type === "error") {
            throw new Error(event.error);
          }
        }

        if (done) break;
      }

      if (!completed) throw new Error("Feed run did not complete");

      const n = completed.newTotal;
      toast.success(
        `${n} new post${n === 1 ? "" : "s"} from ${completed.feedCount} feed${completed.feedCount === 1 ? "" : "s"}`,
      );
      await load({ soft: true, quiet: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network error running scrapers");
    } finally {
      setRunningScrapers(false);
      setFetchProgress(null);
    }
  }

  function toggleSelected(itemId: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const item of filteredItems) next.delete(item.id);
        return next;
      });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filteredItems) next.add(item.id);
      return next;
    });
  }

  function toggleSelectCurrentPage() {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const item of paginatedItems) {
        if (allPageSelected) next.delete(item.id);
        else next.add(item.id);
      }
      return next;
    });
  }

  async function promote(itemId: string, assignToMe: boolean) {
    setBusy({ itemId, action: assignToMe ? "assign" : "queue" });
    try {
      const res = await fetch(`/api/org/scraper-raw/${itemId}/promote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignToMe }),
      });
      const data = (await res.json()) as {
        leadId?: string;
        lead?: Lead;
        account?: Account;
        contact?: Contact;
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Promote failed");
        return;
      }
      if (data.lead) {
        ws.stageCrmEntities({
          leads: [data.lead],
          accounts: data.account ? [data.account] : undefined,
          contacts: data.contact ? [data.contact] : undefined,
        });
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedIds((previous) => {
        if (!previous.has(itemId)) return previous;
        const next = new Set(previous);
        next.delete(itemId);
        return next;
      });
      const viewHref = data.leadId ? `/leads/${data.leadId}?from=prospects` : null;
      if (assignToMe) {
        toast.success("Prospect created, you are the owner", {
          description: "Find it anytime under Prospects → Owned by me.",
          action: viewHref
            ? {
                label: "View prospect",
                onClick: () => router.push(viewHref),
              }
            : undefined,
        });
      } else {
        toast.success("Prospect added to open queue", {
          description: "Teammates can claim it from Prospects → Open queue.",
          action: viewHref
            ? {
                label: "View queue",
                onClick: () => router.push("/prospects?owner=open-queue"),
              }
            : undefined,
        });
      }
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(itemId: string) {
    setBusy({ itemId, action: "dismiss" });
    try {
      const res = await fetch(`/api/org/scraper-raw/${itemId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "You don’t have permission to delete intake posts"
            : (data.error ?? "Dismiss failed"),
        );
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedIds((previous) => {
        if (!previous.has(itemId)) return previous;
        const next = new Set(previous);
        next.delete(itemId);
        return next;
      });
      toast.success("Dismissed");
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function deleteDismissedItem(itemId: string) {
    setBusy({ itemId, action: "delete" });
    try {
      const res = await fetch(`/api/org/scraper-raw/${itemId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "You don’t have permission to delete intake posts"
            : (data.error ?? "Delete failed"),
        );
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedIds((previous) => {
        if (!previous.has(itemId)) return previous;
        const next = new Set(previous);
        next.delete(itemId);
        return next;
      });
      toast.success("Deleted permanently");
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBulkDelete() {
    if (!deleteConfirm) return;
    const mode = deleteConfirm;
    const hardDelete = poolView === "dismissed";

    setBulkBusy(true);
    setBulkDeleteResult(null);
    try {
      if (mode === "all") {
        if (hardDelete) {
          toast.error("Empty pool is only available for active posts");
          return;
        }
        setBulkProgress(null);
        const res = await fetch("/api/org/scraper-raw", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "empty_pool" }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(
            res.status === 403
              ? "You don’t have permission to delete intake posts"
              : (data.error ?? "Could not empty pool"),
          );
          return;
        }
        setItems([]);
        setSelectedIds(new Set());
        await load({ soft: true });
        setBulkDeleteResult({ deleted: 0, total: 0, emptied: true });
        toast.success("Intake pool emptied");
        return;
      }

      const total = selectedIds.size;
      setBulkProgress({ done: 0, total });
      const res = await fetch("/api/org/scraper-raw", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: hardDelete ? "delete" : "dismiss",
          itemIds: Array.from(selectedIds),
          streamProgress: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(
          res.status === 403
            ? "You don’t have permission to delete intake posts"
            : (data.error ?? (hardDelete ? "Delete failed" : "Dismiss failed")),
        );
        return;
      }

      if (!res.body) throw new Error("Deletion progress stream unavailable");

      type DeleteEvent =
        | { type: "progress"; done: number; total: number }
        | {
            type: "complete";
            dismissedIds?: string[];
            deletedIds?: string[];
            count: number;
            total: number;
          }
        | { type: "error"; error: string };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed: Extract<DeleteEvent, { type: "complete" }> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as DeleteEvent;
          if (event.type === "progress") {
            setBulkProgress({ done: event.done, total: event.total });
          } else if (event.type === "complete") {
            completed = event;
          } else {
            throw new Error(event.error);
          }
        }

        if (done) break;
      }

      if (!completed) throw new Error("Deletion did not complete");

      const removed = new Set(completed.deletedIds ?? completed.dismissedIds ?? []);
      const deletedCount = completed.count;
      const actualTotal = completed.total;
      setBulkProgress({ done: deletedCount, total: actualTotal });
      setItems((prev) => prev.filter((item) => !removed.has(item.id)));
      setSelectedIds(new Set());
      setBulkDeleteResult({ deleted: deletedCount, total: actualTotal });
      toast.success(
        hardDelete
          ? `${deletedCount} post${deletedCount === 1 ? "" : "s"} deleted permanently`
          : `${deletedCount} post${deletedCount === 1 ? "" : "s"} dismissed`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const canDelete = canDeleteIntake && items.length > 0 && !bulkBusy;
  const isEmptyPoolDialog = deleteConfirm === "all";
  const deleteDialogTotal =
    bulkDeleteResult?.emptied
      ? 0
      : (bulkDeleteResult?.total ??
        bulkProgress?.total ??
        (isEmptyPoolDialog ? 0 : selectedCount));
  const deleteDialogDone = bulkDeleteResult?.emptied
    ? 0
    : (bulkDeleteResult?.deleted ?? bulkProgress?.done ?? 0);
  const deleteDialogRemaining = Math.max(0, deleteDialogTotal - deleteDialogDone);
  const bulkProgressPercent =
    deleteDialogTotal > 0
      ? Math.round((deleteDialogDone / deleteDialogTotal) * 100)
      : bulkDeleteResult?.emptied
        ? 100
        : 0;

  return (
    <>
      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!bulkBusy && !open) {
            setDeleteConfirm(null);
            setBulkDeleteResult(null);
            setBulkProgress(null);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogMedia
              className={
                bulkDeleteResult
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-destructive/10 text-destructive"
              }
            >
              {bulkDeleteResult ? <CheckCircle2 /> : <Trash2 />}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {bulkDeleteResult
                ? bulkDeleteResult.emptied
                  ? "Pool emptied"
                  : "Deletion complete"
                : deleteConfirm === "all"
                  ? "Empty the entire intake pool?"
                  : `Delete ${deleteDialogTotal} selected post${deleteDialogTotal === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteResult
                ? bulkDeleteResult.emptied
                  ? "The intake pool is clear. New scraper runs will refill it. Already promoted prospects are not affected."
                  : items.length > 0
                    ? `${bulkDeleteResult.deleted} post${bulkDeleteResult.deleted === 1 ? "" : "s"} removed. ${items.length} still remain.`
                    : `${bulkDeleteResult.deleted} post${bulkDeleteResult.deleted === 1 ? "" : "s"} removed.`
                : deleteConfirm === "all"
                  ? "This instantly hides every available post in the pool — not just the ones on screen. Old rows are cleaned up in the background. Already promoted prospects are not affected."
                  : poolView === "dismissed"
                    ? "Selected dismissed posts will be permanently deleted from the database. This cannot be undone."
                    : "Only the posts you selected will be dismissed from the pool. Other posts (including ones hidden by filters) will remain. Already promoted prospects are not affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteConfirm === "selected" ||
          (bulkDeleteResult && !bulkDeleteResult.emptied) ? (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                <div>
                  <div className="text-lg font-semibold tabular-nums">{deleteDialogTotal}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums text-destructive">
                    {deleteDialogDone}
                  </div>
                  <div className="text-xs text-muted-foreground">Deleted</div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums">{deleteDialogRemaining}</div>
                  <div className="text-xs text-muted-foreground">Remaining</div>
                </div>
              </div>
              <Progress
                value={bulkProgressPercent}
                className="w-full gap-2 [&_[data-slot=progress-indicator]]:bg-destructive"
              >
                <ProgressLabel className="text-sm text-muted-foreground">
                  {bulkDeleteResult
                    ? "Deletion finished"
                    : bulkBusy
                      ? "Deleting posts…"
                      : "Ready to delete"}
                </ProgressLabel>
                <ProgressValue className="text-sm">
                  {() => `${bulkProgressPercent}%`}
                </ProgressValue>
              </Progress>
            </>
          ) : null}
          <AlertDialogFooter>
            {bulkDeleteResult ? (
              <AlertDialogCancel variant="default">Done</AlertDialogCancel>
            ) : (
              <>
                <AlertDialogCancel disabled={bulkBusy}>Keep posts</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={bulkBusy}
                  onClick={() => void confirmBulkDelete()}
                >
                  {bulkBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {deleteConfirm === "all"
                        ? "Emptying…"
                        : `Deleting ${bulkProgressPercent}%`}
                    </>
                  ) : deleteConfirm === "all" ? (
                    "Empty entire pool"
                  ) : poolView === "dismissed" ? (
                    `Permanently delete ${deleteDialogTotal}`
                  ) : (
                    `Dismiss ${deleteDialogTotal} post${deleteDialogTotal === 1 ? "" : "s"}`
                  )}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        title="Intake pool"
        description={`Fresh posts from your RSS scrapers. Unclaimed rows expire after ${RAW_ITEM_RETENTION_DAYS} days unless promoted to a prospect.`}
        actions={
          <>
            {!ws.isDemo && canRunScrapers ? (
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={() => void runAllScrapers()}
                disabled={loading || poolBusy}
                title={
                  runningScrapers
                    ? "Running all feeds — keep this tab open"
                    : "Run all enabled scrapers and refresh the pool"
                }
              >
                {runningScrapers ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}{" "}
                {runningScrapers
                  ? fetchProgress && fetchProgress.total > 0
                    ? `Fetching ${fetchProgress.done}/${fetchProgress.total}`
                    : fetchElapsed > 0
                      ? `Fetching… ${formatElapsed(fetchElapsed)}`
                      : "Fetching…"
                  : "Fetch new posts"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void load({ soft: items.length > 0 })}
              disabled={loading || poolBusy}
              title="Reload the intake pool from the server"
            >
              <RefreshCw
                className={
                  refreshing && !runningScrapers
                    ? "h-3.5 w-3.5 animate-spin"
                    : "h-3.5 w-3.5"
                }
              />{" "}
              Refresh
            </Button>
            {!ws.isDemo && canDeleteIntake ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm" type="button" disabled={!canDelete}>
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={selectedCount === 0 || bulkBusy}
                    onSelect={() => setDeleteConfirm("selected")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {poolView === "dismissed"
                      ? "Delete selected permanently"
                      : "Dismiss selected"}
                  </DropdownMenuItem>
                  {poolView === "available" ? (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!canDelete}
                      onSelect={() => setDeleteConfirm("all")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Empty entire pool
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/prospects?owner=me">My prospects</Link>}
            />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/prospects">All prospects</Link>}
            />
            {canManageFeeds ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/admin/scrapers">Manage feeds</Link>}
              />
            ) : null}
          </>
        }
      />
      <PageBody className="space-y-4">
        {ws.isDemo ? (
          <Card>
            <CardHeader>
              <CardTitle>Live workspace required</CardTitle>
              <CardDescription>
                The intake pool is loaded from your organization&apos;s scraper feeds in live mode.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="inline-flex shrink-0 rounded-lg border bg-muted/40 p-0.5"
                  role="group"
                  aria-label="Intake pool view"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={poolView === "available" ? "default" : "ghost"}
                    className="h-8 px-3"
                    onClick={() => setPoolView("available")}
                  >
                    Available
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={poolView === "dismissed" ? "default" : "ghost"}
                    className="h-8 px-3"
                    onClick={() => setPoolView("dismissed")}
                  >
                    Dismissed
                  </Button>
                </div>

                <div className="relative min-w-[12rem] flex-1 max-w-xl">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search title, feed, or content…"
                    className="h-8 pl-8"
                    aria-label="Search intake pool"
                  />
                </div>

                <Select
                  value={sortMode}
                  onValueChange={(v) => v && setSortMode(v as SortMode)}
                >
                  <SelectTrigger className="h-8 w-[8.5rem]">
                    <SelectValue placeholder="Sort">
                      {sortMode === "newest" ? "Newest" : "Best match"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="best_match">Best match</SelectItem>
                  </SelectContent>
                </Select>

                <CollapsibleTrigger
                  render={
                    <Button variant="outline" size="sm" type="button" className="h-8 gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Filters
                      {advancedFilterCount > 0 ? (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px] font-normal tabular-nums"
                        >
                          {advancedFilterCount}
                        </Badge>
                      ) : null}
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 opacity-60 transition-transform",
                          filtersOpen && "rotate-180",
                        )}
                      />
                    </Button>
                  }
                />

                {filtersActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="h-8"
                    onClick={clearFilters}
                  >
                    Clear
                  </Button>
                ) : null}

                <span
                  className="ml-auto flex min-w-0 max-w-full flex-col items-end gap-1 text-sm text-muted-foreground sm:max-w-sm"
                  aria-live="polite"
                >
                  <span className="flex items-center gap-2">
                    {statusBusy ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                    ) : null}
                    <span className="truncate">{poolStatusLabel}</span>
                  </span>
                  {runningScrapers && fetchProgress && fetchProgress.total > 0 ? (
                    <Progress value={fetchProgressPercent} className="w-full min-w-[10rem]">
                      <ProgressLabel className="sr-only">Feed run progress</ProgressLabel>
                      <ProgressValue className="text-xs">
                        {() => `${fetchProgressPercent}%`}
                      </ProgressValue>
                    </Progress>
                  ) : null}
                  {scoringQuality && !runningScrapers && !refreshing && scoringTotal > 0 ? (
                    <Progress value={scoringProgressPercent} className="w-full min-w-[10rem]">
                      <ProgressLabel className="sr-only">Match scoring progress</ProgressLabel>
                      <ProgressValue className="text-xs">
                        {() => `${scoringProgressPercent}%`}
                      </ProgressValue>
                    </Progress>
                  ) : null}
                </span>
              </div>

              <CollapsibleContent className="overflow-hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                  <IntakeKeywordFilters
                    organizationId={ws.organizationId}
                    teamIncludeKeywords={teamDefaults.includeKeywords}
                    teamExcludeKeywords={teamDefaults.excludeKeywords}
                    personalIncludeKeywords={personalIncludeKeywords}
                    personalExcludeKeywords={personalExcludeKeywords}
                    onPersonalIncludeChange={setPersonalIncludeKeywords}
                    onPersonalExcludeChange={setPersonalExcludeKeywords}
                    canManageTeamDefaults={canManageTeamDefaults}
                  />

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    <Select value={platform} onValueChange={(v) => v && setPlatform(v)}>
                      <SelectTrigger className="h-8 w-full gap-2">
                        <SelectValue placeholder="Platform" className="overflow-hidden">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">
                              {platform === ALL
                                ? "All platforms"
                                : getScraperPlatformLabel(platform)}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              ({platform === ALL ? items.length : platformCounts.get(platform) ?? 0})
                            </span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value={ALL}>
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">All platforms</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {items.length}
                            </span>
                          </span>
                        </SelectItem>
                        {platformOptions.map((p) => (
                          <SelectItem key={p} value={p}>
                            <span className="flex w-full min-w-0 items-center justify-between gap-3">
                              <span className="truncate">{getScraperPlatformLabel(p)}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {platformCounts.get(p) ?? 0}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                      <SelectTrigger
                        className="h-8 w-full gap-2"
                        title={
                          category === ALL
                            ? `All categories (${items.length})`
                            : `${getScraperCategoryLabel(category)} (${categoryCounts.get(category) ?? 0})`
                        }
                      >
                        <SelectValue placeholder="Category" className="overflow-hidden">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">
                              {category === ALL
                                ? "All categories"
                                : getScraperCategoryLabel(category)}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              ({category === ALL ? items.length : categoryCounts.get(category) ?? 0})
                            </span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value={ALL}>
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">All categories</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {items.length}
                            </span>
                          </span>
                        </SelectItem>
                        {categoryOptions.map((c) => (
                          <SelectItem key={c} value={c}>
                            <span className="flex w-full min-w-0 items-center justify-between gap-3">
                              <span className="truncate">{getScraperCategoryLabel(c)}</span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {categoryCounts.get(c) ?? 0}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={qualityFilter}
                      onValueChange={(v) => v && setQualityFilter(v as QualityFilter)}
                    >
                      <SelectTrigger className="h-8 w-full gap-2">
                        <SelectValue placeholder="Match quality" className="overflow-hidden">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">
                              {qualityFilter === "all"
                                ? "All matches"
                                : qualityFilter === "no_signals"
                                  ? "No signals"
                                  : qualityFilter === "not_matching"
                                    ? "Not matching"
                                    : qualityFilter === "has_signals"
                                      ? "Has signals"
                                      : "Ready (≥ threshold)"}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              ({qualityCounts[qualityFilter]})
                            </span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="all">
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">All matches</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {qualityCounts.all}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="no_signals">
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">No signals</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {qualityCounts.no_signals}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="not_matching">
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">Not matching</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {qualityCounts.not_matching}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="has_signals">
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">Has signals</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {qualityCounts.has_signals}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="ready">
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">Ready (≥ threshold)</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {qualityCounts.ready}
                            </span>
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    <Select
                      value={strategyFilter}
                      onValueChange={(value) => value && setStrategyFilter(value)}
                      disabled={prospecting.loading}
                    >
                      <SelectTrigger
                        className="h-8 w-full gap-2"
                        title={
                          strategyFilter === ALL
                            ? `All strategies (${strategyCounts.all})`
                            : strategyFilter === ANY_MY_STRATEGY
                              ? `Matches my strategies (${strategyCounts.any})`
                              : strategyFilter === NO_STRATEGY_MATCH
                                ? `No strategy match (${strategyCounts.none})`
                                : `${assignedStrategies.find((strategy) => strategy.id === strategyFilter)?.name ?? "Assigned strategy"} (${strategyCounts.byStrategy.get(strategyFilter) ?? 0})`
                        }
                      >
                        <SelectValue placeholder="Strategy match" className="overflow-hidden">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate">
                              {strategyFilter === ALL
                                ? "All strategies"
                                : strategyFilter === ANY_MY_STRATEGY
                                  ? "Matches my strategies"
                                  : strategyFilter === NO_STRATEGY_MATCH
                                    ? "No strategy match"
                                    : assignedStrategies.find(
                                        (strategy) => strategy.id === strategyFilter,
                                      )?.name ?? "Assigned strategy"}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              (
                              {strategyFilter === ALL
                                ? strategyCounts.all
                                : strategyFilter === ANY_MY_STRATEGY
                                  ? strategyCounts.any
                                  : strategyFilter === NO_STRATEGY_MATCH
                                    ? strategyCounts.none
                                    : (strategyCounts.byStrategy.get(strategyFilter) ?? 0)}
                              )
                            </span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" className="min-w-(--anchor-width) max-w-[24rem]">
                        <SelectItem value={ALL}>
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">All strategies</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {strategyCounts.all}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value={ANY_MY_STRATEGY}>
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">Matches my strategies</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {strategyCounts.any}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value={NO_STRATEGY_MATCH}>
                          <span className="flex w-full min-w-0 items-center justify-between gap-3">
                            <span className="truncate">No strategy match</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {strategyCounts.none}
                            </span>
                          </span>
                        </SelectItem>
                        {assignedStrategies.map((strategy) => (
                          <SelectItem key={strategy.id} value={strategy.id}>
                            <span className="flex w-full min-w-0 items-center justify-between gap-3">
                              <span className="line-clamp-2 text-left">{strategy.name}</span>
                              <span className="shrink-0 self-start tabular-nums text-muted-foreground">
                                {strategyCounts.byStrategy.get(strategy.id) ?? 0}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Min score</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={minimumScore}
                        onChange={(event) => setMinimumScore(event.target.value)}
                        placeholder="0–100"
                        className="h-8 w-[6.5rem]"
                        aria-label="Minimum match score"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Max score</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        inputMode="numeric"
                        value={maximumScore}
                        onChange={(event) => setMaximumScore(event.target.value)}
                        placeholder="0–100"
                        className="h-8 w-[6.5rem]"
                        aria-label="Maximum match score"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">From</Label>
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="date"
                          value={dateFrom}
                          onChange={(e) => setDateFrom(e.target.value)}
                          className="h-8 w-[9.5rem] pl-8"
                          aria-label="Published from date"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">To</Label>
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="date"
                          value={dateTo}
                          onChange={(e) => setDateTo(e.target.value)}
                          className="h-8 w-[9.5rem] pl-8"
                          aria-label="Published to date"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {canDeleteIntake && filteredItems.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
                <Checkbox
                  checked={allPageSelected}
                  indeterminate={somePageSelected}
                  onCheckedChange={() => toggleSelectCurrentPage()}
                  aria-label="Select all posts on this page"
                />
                <span className="font-medium">
                  {selectedCount > 0
                    ? `${selectedCount} selected`
                    : "Select posts"}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={toggleSelectCurrentPage}
                    disabled={bulkBusy || paginatedItems.length === 0}
                  >
                    {allPageSelected ? "Deselect page" : "Select page"}
                  </Button>
                  {filteredItems.length > paginatedItems.length ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={toggleSelectAllFiltered}
                      disabled={bulkBusy}
                    >
                      {allFilteredSelected ? "Deselect all results" : "Select all results"}
                    </Button>
                  ) : null}
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    disabled={bulkBusy || selectedCount === 0}
                    onClick={() => setDeleteConfirm("selected")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {poolView === "dismissed" ? "Delete permanently" : "Dismiss selected"}
                  </Button>
                </div>
              </div>
            ) : null}

            {loading && items.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading posts…
              </div>
            ) : items.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {poolView === "dismissed" ? "No dismissed posts" : "No posts in the pool"}
                  </CardTitle>
                  <CardDescription>
                    {poolView === "dismissed"
                      ? "Dismissed posts will appear here. You can permanently delete them from this view."
                      : "Run your feeds from Admin → Scrapers, or seed the default n8n/rss.app feeds and click Run all."}
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : filteredItems.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No matches</CardTitle>
                  <CardDescription>
                    Try different search terms, keyword lists, dates, or match filters, or clear
                    filters to see all {items.length}{" "}
                    {poolView === "dismissed" ? "dismissed posts" : "posts"}.
                    {scoringQuality && (qualityFilter === "has_signals" || qualityFilter === "ready")
                      ? " Match scores are still calculating — results may appear shortly."
                      : null}
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <>
                <ul
                  className={cn(
                    "space-y-3 transition-opacity",
                    refreshing && !runningScrapers && "opacity-70",
                  )}
                >
                {paginatedItems.map((item) => {
                  const itemBusy = busy?.itemId === item.id ? busy.action : null;
                  const isSelected = selectedIds.has(item.id);
                  const quality = qualityById.get(item.id);
                  const matchingStrategies = (strategyMatchesById.get(item.id) ?? []).filter(
                    (match) =>
                      !match.disqualified &&
                      match.missingRequiredSignalIds.length === 0 &&
                      match.score >= ws.intentPlaybook.outreachThreshold,
                  );
                  const topSignalLabels =
                    quality?.matchedSignals
                      .filter((s) => s.category !== "engagement")
                      .slice(0, 2)
                      .map((s) => s.label) ?? [];
                  return (
                    <li key={item.id}>
                      <Card
                        className={cn(
                          isSelected && "ring-1 ring-primary/40",
                        )}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              {canDeleteIntake ? (
                                <Checkbox
                                  className="mt-1"
                                  checked={isSelected}
                                  disabled={bulkBusy}
                                  onCheckedChange={(v) => toggleSelected(item.id, v === true)}
                                  aria-label={`Select ${item.title}`}
                                />
                              ) : null}
                              <div className="min-w-0 flex-1 space-y-1">
                                <CardTitle className="text-base leading-snug">
                                  <a
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-primary hover:underline underline-offset-2"
                                    title="Open original post"
                                  >
                                    {item.title}
                                  </a>
                                </CardTitle>
                                <div className="flex flex-wrap gap-1.5">
                                  {quality ? (
                                    <IntakeQualityBadge
                                      result={quality}
                                      playbook={ws.intentPlaybook}
                                    />
                                  ) : null}
                                  <Badge variant="secondary">{getScraperPlatformLabel(item.platform)}</Badge>
                                  <Badge variant="outline">{getScraperCategoryLabel(item.category)}</Badge>
                                  <Badge variant="outline" className="font-normal text-muted-foreground">
                                    {item.feedName}
                                  </Badge>
                                  {quality?.primaryOpportunity ? (
                                    <Badge variant="outline" className="font-normal">
                                      {quality.primaryOpportunity.label}
                                    </Badge>
                                  ) : null}
                                  {matchingStrategies.slice(0, 2).map((match) => (
                                    <Badge
                                      key={match.strategyId}
                                      variant="outline"
                                      className="font-normal text-xs"
                                    >
                                      {match.strategyName} · {match.score}
                                    </Badge>
                                  ))}
                                  {topSignalLabels.map((label) => (
                                    <Badge
                                      key={label}
                                      variant="secondary"
                                      className="font-normal text-xs"
                                    >
                                      {label}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="shrink-0 space-y-0.5 text-right text-xs text-muted-foreground">
                              <div title={item.publishedAt || undefined}>
                                <span className="text-muted-foreground/80">Published · </span>
                                {fmtRelative(item.publishedAt)}
                              </div>
                              {poolView === "dismissed" && item.dismissedAt ? (
                                <div title={item.dismissedAt}>
                                  <span className="text-muted-foreground/80">Dismissed · </span>
                                  {fmtRelative(item.dismissedAt)}
                                </div>
                              ) : (
                                <div title={item.createdAt || undefined}>
                                  <span className="text-muted-foreground/80">Scraped · </span>
                                  {fmtDate(item.createdAt, "MMM d, yyyy · h:mm a")}
                                </div>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <IntakeItemBody item={item} />
                          <IntakeItemActions
                            item={item}
                            busyAction={itemBusy}
                            mode={poolView}
                            canDismiss={canDeleteIntake}
                            canDelete={canDeleteIntake}
                            onAssignToMe={() => promote(item.id, true)}
                            onOpenQueue={() => promote(item.id, false)}
                            onDismissConfirmed={() => dismiss(item.id)}
                            onDeleteConfirmed={() => deleteDismissedItem(item.id)}
                          />
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    Showing {pageStart + 1}–
                    {Math.min(pageStart + pageSize, filteredItems.length)} of {filteredItems.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <span>Posts per page</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => {
                        const next = Number(value);
                        if (
                          PAGE_SIZE_OPTIONS.includes(
                            next as (typeof PAGE_SIZE_OPTIONS)[number],
                          )
                        ) {
                          setPageSize(next as (typeof PAGE_SIZE_OPTIONS)[number]);
                          setPageIndex(0);
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 w-[72px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      type="button"
                      aria-label="Previous page"
                      disabled={currentPageIndex === 0}
                      onClick={() => setPageIndex(Math.max(0, currentPageIndex - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="min-w-[6.5rem] text-center font-medium tabular-nums text-foreground">
                      Page {currentPageIndex + 1} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      type="button"
                      aria-label="Next page"
                      disabled={currentPageIndex >= totalPages - 1}
                      onClick={() =>
                        setPageIndex(Math.min(totalPages - 1, currentPageIndex + 1))
                      }
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
