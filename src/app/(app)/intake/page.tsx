"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { rankAssignedStrategies, type AssignedStrategyMatch } from "@nova/scoring";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { activeAssignmentsForUser } from "@/lib/prospecting-strategy/allocation";
import { roleAtLeast } from "@/lib/platform/org-role";
import { userCanDeleteIntakePool, userHasAdminFeature } from "@/lib/admin-feature-access";
import { canAction } from "@/lib/permissions/can";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { cn } from "@/lib/utils";

const ALL = "__all__" as const;
const ANY_MY_STRATEGY = "__any_my_strategy__" as const;
const NO_STRATEGY_MATCH = "__no_strategy_match__" as const;
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type QualityFilter = "all" | "no_signals" | "not_matching" | "has_signals" | "ready";
type SortMode = "newest" | "best_match";
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
    action: "assign" | "queue" | "dismiss";
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
  } | null>(null);

  const loadSequenceRef = React.useRef(0);
  const lastFetchAtRef = React.useRef(0);
  const itemsLenRef = React.useRef(0);
  React.useEffect(() => {
    itemsLenRef.current = items.length;
  }, [items.length]);

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

  const { qualityById, scoring: scoringQuality } = useIntakeQualityScores(
    items,
    ws.intentPlaybook,
  );
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
  const categoryOptions = React.useMemo(() => {
    const dynamic = new Set(items.map((item) => item.category).filter(Boolean));
    for (const preset of SCRAPER_CATEGORY_PRESETS) dynamic.add(preset);
    return Array.from(dynamic).sort((a, b) => getScraperCategoryLabel(a).localeCompare(getScraperCategoryLabel(b)));
  }, [items]);
  const platformOptions = React.useMemo(() => {
    const dynamic = new Set(items.map((item) => item.platform).filter(Boolean));
    for (const preset of SCRAPER_PLATFORM_PRESETS) dynamic.add(preset);
    return Array.from(dynamic).sort((a, b) => getScraperPlatformLabel(a).localeCompare(getScraperPlatformLabel(b)));
  }, [items]);

  const keywordFiltersActive =
    intakeKeywordFiltersActive(teamDefaults.includeKeywords, teamDefaults.excludeKeywords) ||
    intakeKeywordFiltersActive(personalIncludeKeywords, personalExcludeKeywords);
  const canManageTeamDefaults = roleAtLeast(ws.viewerOrgRole, "admin");
  const filtersActive =
    searchQuery.trim().length > 0 ||
    dateFrom.length > 0 ||
    dateTo.length > 0 ||
    keywordFiltersActive ||
    qualityFilter !== "all" ||
    minimumScore.trim().length > 0 ||
    maximumScore.trim().length > 0 ||
    strategyFilter !== ALL ||
    sortMode !== "newest";

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
    async (opts?: { soft?: boolean }) => {
      if (ws.isDemo) {
        setItems([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const soft = opts?.soft ?? itemsLenRef.current > 0;
      const loadSequence = ++loadSequenceRef.current;

      if (soft) setRefreshing(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({ status: "available", limit: "200" });
        if (platform !== ALL) params.set("platform", platform);
        if (category !== ALL) params.set("category", category);
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
    [ws.isDemo, platform, category],
  );

  React.useEffect(() => {
    // Soft refresh when platform/category changes so the list doesn't blank for 10s+.
    void load({ soft: itemsLenRef.current > 0 });
    return () => {
      loadSequenceRef.current += 1;
    };
  }, [load]);

  React.useEffect(() => {
    if (ws.isDemo) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAtRef.current < VISIBILITY_REFRESH_MIN_MS) return;
      void load({ soft: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load, ws.isDemo]);

  async function runAllScrapers() {
    if (ws.isDemo || !canRunScrapers) return;
    setRunningScrapers(true);
    try {
      const res = await fetch("/api/org/scraper-feeds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_all" }),
      });
      const data = (await res.json()) as { newTotal?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not run scrapers");
        return;
      }
      const n = data.newTotal ?? 0;
      toast.success(`${n} new post${n === 1 ? "" : "s"} fetched`);
      await load({ soft: true });
    } catch {
      toast.error("Network error running scrapers");
    } finally {
      setRunningScrapers(false);
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

  async function confirmBulkDelete() {
    if (!deleteConfirm) return;
    const mode = deleteConfirm;
    const total = mode === "selected" ? selectedIds.size : items.length;

    setBulkBusy(true);
    setBulkDeleteResult(null);
    setBulkProgress({ done: 0, total });
    try {
      const body =
        mode === "all"
          ? { action: "dismiss", allAvailable: true, streamProgress: true }
          : {
              action: "dismiss",
              itemIds: Array.from(selectedIds),
              streamProgress: true,
            };
      const res = await fetch("/api/org/scraper-raw", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(
          res.status === 403
            ? "You don’t have permission to delete intake posts"
            : (data.error ?? "Delete failed"),
        );
        return;
      }

      if (!res.body) throw new Error("Deletion progress stream unavailable");

      type DeleteEvent =
        | { type: "progress"; done: number; total: number }
        | { type: "complete"; dismissedIds: string[]; count: number; total: number }
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

      const removed = new Set(completed.dismissedIds);
      const deletedCount = completed.count;
      const actualTotal = completed.total;
      setBulkProgress({ done: deletedCount, total: actualTotal });
      setItems((previous) => previous.filter((item) => !removed.has(item.id)));
      setBulkDeleteResult({ deleted: deletedCount, total: actualTotal });
      setSelectedIds(new Set());
      toast.success(deletedCount === 1 ? "1 post deleted" : `${deletedCount} posts deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network error");
    } finally {
      setBulkBusy(false);
    }
  }

  const canDelete = canDeleteIntake && items.length > 0 && !bulkBusy;
  const deleteDialogTotal =
    bulkDeleteResult?.total ??
    bulkProgress?.total ??
    (deleteConfirm === "all" ? items.length : selectedCount);
  const deleteDialogDone = bulkDeleteResult?.deleted ?? bulkProgress?.done ?? 0;
  const deleteDialogRemaining = Math.max(0, deleteDialogTotal - deleteDialogDone);
  const bulkProgressPercent =
    deleteDialogTotal > 0
      ? Math.round((deleteDialogDone / deleteDialogTotal) * 100)
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
                ? "Deletion complete"
                : deleteConfirm === "all"
                  ? `Delete all ${deleteDialogTotal} posts?`
                  : `Delete ${deleteDialogTotal} selected post${deleteDialogTotal === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteResult
                ? `${bulkDeleteResult.deleted} post${bulkDeleteResult.deleted === 1 ? "" : "s"} removed from the intake pool.`
                : "These posts will leave the intake pool and won’t be promoted. Already promoted prospects are not affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
                      Deleting {bulkProgressPercent}%
                    </>
                  ) : (
                    `Delete ${deleteDialogTotal} post${deleteDialogTotal === 1 ? "" : "s"}`
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
                disabled={loading || refreshing || runningScrapers}
              >
                {runningScrapers ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}{" "}
                {runningScrapers ? "Fetching…" : "Fetch new posts"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void load({ soft: items.length > 0 })}
              disabled={loading || refreshing || runningScrapers}
            >
              <RefreshCw
                className={
                  loading || refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
                }
              />{" "}
              {refreshing ? "Updating…" : "Refresh"}
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
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={selectedCount === 0 || bulkBusy}
                    onSelect={() => setDeleteConfirm("selected")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete selected
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={!canDelete}
                    onSelect={() => setDeleteConfirm("all")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete all
                  </DropdownMenuItem>
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
            <div className="space-y-3">
              <div className="relative max-w-xl">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, feed, or content…"
                  className="pl-8 h-9"
                  aria-label="Search intake pool"
                />
              </div>
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
              <div className="flex flex-wrap items-end gap-3">
                <Select value={platform} onValueChange={(v) => v && setPlatform(v)}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Platform">
                      {platform === ALL
                        ? "All platforms"
                        : getScraperPlatformLabel(platform)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All platforms</SelectItem>
                    {platformOptions.map((p) => (
                      <SelectItem key={p} value={p}>
                        {getScraperPlatformLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Category">
                      {category === ALL
                        ? "All categories"
                        : getScraperCategoryLabel(category)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All categories</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {getScraperCategoryLabel(c)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={qualityFilter}
                  onValueChange={(v) => v && setQualityFilter(v as QualityFilter)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Match quality">
                      {qualityFilter === "all"
                        ? "All matches"
                        : qualityFilter === "no_signals"
                          ? "No signals"
                          : qualityFilter === "not_matching"
                            ? "Not matching"
                        : qualityFilter === "has_signals"
                          ? "Has signals"
                          : "Ready (≥ threshold)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All matches</SelectItem>
                    <SelectItem value="no_signals">No signals</SelectItem>
                    <SelectItem value="not_matching">Not matching</SelectItem>
                    <SelectItem value="has_signals">Has signals</SelectItem>
                    <SelectItem value="ready">Ready (≥ threshold)</SelectItem>
                  </SelectContent>
                </Select>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Minimum score</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    inputMode="numeric"
                    value={minimumScore}
                    onChange={(event) => setMinimumScore(event.target.value)}
                    placeholder="0–100"
                    className="h-9 w-[110px]"
                    aria-label="Minimum match score"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Maximum score</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    inputMode="numeric"
                    value={maximumScore}
                    onChange={(event) => setMaximumScore(event.target.value)}
                    placeholder="0–100"
                    className="h-9 w-[110px]"
                    aria-label="Maximum match score"
                  />
                </div>
                <Select
                  value={strategyFilter}
                  onValueChange={(value) => value && setStrategyFilter(value)}
                  disabled={prospecting.loading}
                >
                  <SelectTrigger className="w-[210px]">
                    <SelectValue placeholder="Strategy match">
                      {strategyFilter === ALL
                        ? "All strategies"
                        : strategyFilter === ANY_MY_STRATEGY
                          ? "Matches my strategies"
                          : strategyFilter === NO_STRATEGY_MATCH
                            ? "No strategy match"
                            : assignedStrategies.find((strategy) => strategy.id === strategyFilter)
                                ?.name ?? "Assigned strategy"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All strategies</SelectItem>
                    <SelectItem value={ANY_MY_STRATEGY}>Matches my strategies</SelectItem>
                    <SelectItem value={NO_STRATEGY_MATCH}>No strategy match</SelectItem>
                    {assignedStrategies.map((strategy) => (
                      <SelectItem key={strategy.id} value={strategy.id}>
                        {strategy.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sortMode}
                  onValueChange={(v) => v && setSortMode(v as SortMode)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Sort">
                      {sortMode === "newest" ? "Newest" : "Best match"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="best_match">Best match</SelectItem>
                  </SelectContent>
                </Select>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">From date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="pl-8 h-9 w-[150px]"
                      aria-label="Published from date"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">To date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="pl-8 h-9 w-[150px]"
                      aria-label="Published to date"
                    />
                  </div>
                </div>
                {filtersActive ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="h-9"
                    onClick={() => {
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
                    }}
                  >
                    Clear filters
                  </Button>
                ) : null}
                <span className="text-sm text-muted-foreground pb-2 ml-auto flex items-center gap-2">
                  {refreshing || scoringQuality ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : null}
                  {loading && items.length === 0
                    ? "Loading…"
                    : refreshing
                      ? "Updating…"
                      : scoringQuality
                        ? `Scoring matches… · ${filteredItems.length} of ${items.length}`
                        : filtersActive
                          ? `${filteredItems.length} of ${items.length} shown`
                          : `${items.length} available`}
                </span>
              </div>
            </div>

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
                    Delete selected
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
                  <CardTitle>No posts in the pool</CardTitle>
                  <CardDescription>
                    Run your feeds from Admin → Scrapers, or seed the default n8n/rss.app feeds and
                    click Run all.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : filteredItems.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No matches</CardTitle>
                  <CardDescription>
                    Try different search terms, keyword lists, dates, or match filters, or clear
                    filters to see all {items.length} posts.
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
                    refreshing && "opacity-70",
                  )}
                >
                {paginatedItems.map((item) => {
                  const itemBusy = busy?.itemId === item.id ? busy.action : null;
                  const snippet =
                    item.contentSnippet?.trim() ||
                    item.content.replace(/<[^>]+>/g, " ").slice(0, 280);
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
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground line-clamp-3">{snippet}</p>
                          <IntakeItemActions
                            item={item}
                            busyAction={itemBusy}
                            canDismiss={canDeleteIntake}
                            onAssignToMe={() => promote(item.id, true)}
                            onOpenQueue={() => promote(item.id, false)}
                            onDismissConfirmed={() => dismiss(item.id)}
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
