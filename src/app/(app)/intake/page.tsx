"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Calendar, CheckSquare, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  mergeTeamAndPersonalKeywords,
  passesKeywordFilters,
  rawItemSearchHaystack,
} from "@/lib/intake/keyword-filter";
import type { OrganizationIntakeFilterDefaults } from "@/lib/types";
import { EMPTY_INTAKE_FILTER_DEFAULTS } from "@/lib/intake/intake-filter-defaults";
import { useIntakeQualityScores } from "@/lib/intake/use-intake-quality-scores";
import { roleAtLeast } from "@/lib/platform/org-role";
import { userCanDeleteIntakePool } from "@/lib/admin-feature-access";
import { cn } from "@/lib/utils";

const ALL = "__all__" as const;
type QualityFilter = "all" | "has_signals" | "ready";
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

export default function IntakePoolPage() {
  const ws = useWorkspace();
  const router = useRouter();
  const viewer = ws.getUserById(ws.currentUserId);
  const canDeleteIntake = userCanDeleteIntakePool(viewer, ws.viewerOrgRole);
  const [items, setItems] = React.useState<ScraperRawItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [platform, setPlatform] = React.useState<string>(ALL);
  const [category, setCategory] = React.useState<string>(ALL);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [qualityFilter, setQualityFilter] = React.useState<QualityFilter>("all");
  const [sortMode, setSortMode] = React.useState<SortMode>("newest");
  const [teamDefaults, setTeamDefaults] = React.useState<OrganizationIntakeFilterDefaults>({
    ...EMPTY_INTAKE_FILTER_DEFAULTS,
  });
  const [personalIncludeKeywords, setPersonalIncludeKeywords] = React.useState<string[]>([]);
  const [personalExcludeKeywords, setPersonalExcludeKeywords] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<{
    itemId: string;
    action: "assign" | "queue" | "dismiss";
  } | null>(null);
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [deleteConfirm, setDeleteConfirm] = React.useState<null | "all" | "selected">(null);
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const lastFetchAtRef = React.useRef(0);
  const itemsLenRef = React.useRef(0);
  itemsLenRef.current = items.length;

  const effectiveKeywords = React.useMemo(
    () =>
      mergeTeamAndPersonalKeywords(teamDefaults, {
        includeKeywords: personalIncludeKeywords,
        excludeKeywords: personalExcludeKeywords,
      }),
    [teamDefaults, personalIncludeKeywords, personalExcludeKeywords],
  );

  const { qualityById, scoring: scoringQuality } = useIntakeQualityScores(
    items,
    ws.intentPlaybook,
  );

  const filteredItems = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const haystack = rawItemSearchHaystack(item);
      if (q && !haystack.includes(q)) return false;
      if (
        !passesKeywordFilters(
          haystack,
          effectiveKeywords.includeKeywords,
          effectiveKeywords.excludeKeywords,
        )
      ) {
        return false;
      }
      if (!passesPublishedDateRange(item.publishedAt, dateFrom, dateTo)) return false;
      const quality = qualityById.get(item.id);
      if (qualityFilter === "has_signals" && !(quality && quality.signalCount > 0)) return false;
      if (qualityFilter === "ready" && !(quality && quality.meetsThreshold)) return false;
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
    searchQuery,
    effectiveKeywords,
    dateFrom,
    dateTo,
    qualityFilter,
    sortMode,
    qualityById,
  ]);
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
    sortMode !== "newest";

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

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
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (soft) setRefreshing(true);
      else setLoading(true);

      try {
        const params = new URLSearchParams({ status: "available", limit: "200" });
        if (platform !== ALL) params.set("platform", platform);
        if (category !== ALL) params.set("category", category);
        const res = await fetch(`/api/org/scraper-raw?${params}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: ac.signal,
        });
        if (ac.signal.aborted) return;
        const data = (await res.json()) as { items?: ScraperRawItem[]; error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "Could not load intake pool");
          if (!soft) setItems([]);
          return;
        }
        setItems(data.items ?? []);
        lastFetchAtRef.current = Date.now();
      } catch (e) {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        toast.error("Network error loading intake pool");
      } finally {
        if (!ac.signal.aborted) {
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
      abortRef.current?.abort();
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

  React.useEffect(() => {
    if (!canDeleteIntake && selectMode) {
      setSelectMode(false);
      setSelectedIds(new Set());
      setDeleteConfirm(null);
    }
  }, [canDeleteIntake, selectMode]);

  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const available = new Set(items.map((i) => i.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (available.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
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
      toast.success("Dismissed");
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function confirmBulkDelete() {
    if (!deleteConfirm) return;
    setBulkBusy(true);
    try {
      const body =
        deleteConfirm === "all"
          ? { action: "dismiss", allAvailable: true }
          : { action: "dismiss", itemIds: Array.from(selectedIds) };
      const res = await fetch("/api/org/scraper-raw", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        dismissedIds?: string[];
        count?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(
          res.status === 403
            ? "You don’t have permission to delete intake posts"
            : (data.error ?? "Delete failed"),
        );
        return;
      }
      const removed = new Set(data.dismissedIds ?? []);
      setItems((prev) => prev.filter((i) => !removed.has(i.id)));
      const count = data.count ?? removed.size;
      toast.success(count === 1 ? "Deleted 1 post" : `Deleted ${count} posts`);
      setDeleteConfirm(null);
      exitSelectMode();
    } catch {
      toast.error("Network error");
    } finally {
      setBulkBusy(false);
    }
  }

  const canDelete = canDeleteIntake && items.length > 0 && !bulkBusy;

  return (
    <>
      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => {
          if (!bulkBusy && !open) setDeleteConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm === "all"
                ? `Delete all ${items.length} posts?`
                : `Delete ${selectedCount} selected post${selectedCount === 1 ? "" : "s"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will leave the intake pool and won&apos;t be promoted. New posts can still appear
              when feeds run again. This does not delete anything already promoted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkBusy}
              onClick={() => void confirmBulkDelete()}
            >
              {bulkBusy ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageHeader
        title="Intake pool"
        description={`Fresh posts from your RSS scrapers. Unclaimed rows expire after ${RAW_ITEM_RETENTION_DAYS} days unless promoted to a prospect.`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => void load({ soft: items.length > 0 })}
              disabled={loading || refreshing}
            >
              <RefreshCw
                className={
                  loading || refreshing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"
                }
              />{" "}
              {refreshing ? "Updating…" : "Refresh"}
            </Button>
            {!ws.isDemo && canDeleteIntake ? (
              selectMode ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={exitSelectMode}
                  disabled={bulkBusy}
                >
                  Cancel select
                </Button>
              ) : (
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
                      disabled={!canDelete}
                      onSelect={() => setDeleteConfirm("all")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete all
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canDelete}
                      onSelect={() => {
                        setSelectMode(true);
                        setSelectedIds(new Set());
                      }}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      Select for delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )
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
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/admin/scrapers">Manage feeds</Link>}
            />
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
                        : qualityFilter === "has_signals"
                          ? "Has signals"
                          : "Ready (≥ threshold)"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All matches</SelectItem>
                    <SelectItem value="has_signals">Has signals</SelectItem>
                    <SelectItem value="ready">Ready (≥ threshold)</SelectItem>
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

            {selectMode && filteredItems.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 px-3 py-2 text-sm">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={() => toggleSelectAllFiltered()}
                  aria-label="Select all visible posts"
                />
                <span className="font-medium">
                  {selectedCount > 0
                    ? `${selectedCount} selected`
                    : "Select posts to delete"}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={toggleSelectAllFiltered}
                    disabled={bulkBusy || filteredItems.length === 0}
                  >
                    {allFilteredSelected ? "Deselect all" : "Select all"}
                  </Button>
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
              <ul
                className={cn(
                  "space-y-3 transition-opacity",
                  refreshing && "opacity-70",
                )}
              >
                {filteredItems.map((item) => {
                  const itemBusy = busy?.itemId === item.id ? busy.action : null;
                  const snippet =
                    item.contentSnippet?.trim() ||
                    item.content.replace(/<[^>]+>/g, " ").slice(0, 280);
                  const isSelected = selectedIds.has(item.id);
                  const quality = qualityById.get(item.id);
                  const topSignalLabels =
                    quality?.matchedSignals
                      .filter((s) => s.category !== "engagement")
                      .slice(0, 2)
                      .map((s) => s.label) ?? [];
                  return (
                    <li key={item.id}>
                      <Card
                        className={cn(
                          selectMode && isSelected && "ring-1 ring-primary/40",
                        )}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-3">
                              {selectMode ? (
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
                          {!selectMode ? (
                            <IntakeItemActions
                              item={item}
                              busyAction={itemBusy}
                              canDismiss={canDeleteIntake}
                              onAssignToMe={() => promote(item.id, true)}
                              onOpenQueue={() => promote(item.id, false)}
                              onDismissConfirmed={() => dismiss(item.id)}
                            />
                          ) : null}
                        </CardContent>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
