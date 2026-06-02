"use client";

import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { ScraperCategory, ScraperFeed, ScraperPlatform } from "@/lib/types";
import {
  getScraperCategoryLabel,
  getScraperPlatformLabel,
  isScraperCategoryPreset,
  isScraperPlatformPreset,
  SCRAPER_CATEGORY_PRESETS,
  SCRAPER_PLATFORM_PRESETS,
} from "@/lib/scrapers/labels";
import { DEFAULT_SCRAPER_FEEDS } from "@/lib/scrapers/default-feeds";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const CUSTOM_CATEGORY_VALUE = "__custom__";
const CUSTOM_PLATFORM_VALUE = "__custom__";

function resetFeedForm(setters: {
  setName: (v: string) => void;
  setFeedUrl: (v: string) => void;
  setPlatform: (v: ScraperPlatform) => void;
  setCategory: (v: ScraperCategory) => void;
  setEnabled: (v: boolean) => void;
  setIntervalMin: (v: string) => void;
}) {
  setters.setName("");
  setters.setFeedUrl("");
  setters.setPlatform("reddit");
  setters.setCategory("hiring");
  setters.setEnabled(true);
  setters.setIntervalMin("60");
}

export default function AdminScrapersPage() {
  const ws = useWorkspace();
  const [feeds, setFeeds] = React.useState<ScraperFeed[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [runningAll, setRunningAll] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const [runFeedId, setRunFeedId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const [feedDialogOpen, setFeedDialogOpen] = React.useState(false);
  const [editFeedId, setEditFeedId] = React.useState<string | null>(null);
  const [savingFeed, setSavingFeed] = React.useState(false);
  const [name, setName] = React.useState("");
  const [feedUrl, setFeedUrl] = React.useState("");
  const [platform, setPlatform] = React.useState<ScraperPlatform>("reddit");
  const [customPlatform, setCustomPlatform] = React.useState("");
  const [category, setCategory] = React.useState<ScraperCategory>("hiring");
  const [customCategory, setCustomCategory] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [intervalMin, setIntervalMin] = React.useState("60");

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);

  const isEditing = editFeedId !== null;
  const selectedPlatformValue = isScraperPlatformPreset(platform) ? platform : CUSTOM_PLATFORM_VALUE;
  const selectedCategoryValue = isScraperCategoryPreset(category) ? category : CUSTOM_CATEGORY_VALUE;
  const totalPages = Math.max(1, Math.ceil(feeds.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const paginatedFeeds = feeds.slice(pageStart, pageStart + pageSize);
  const rangeStart = feeds.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, feeds.length);

  React.useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  React.useEffect(() => {
    setPage(1);
  }, [pageSize, feeds.length]);

  function openCreateDialog() {
    setEditFeedId(null);
    resetFeedForm({ setName, setFeedUrl, setPlatform, setCategory, setEnabled, setIntervalMin });
    setCustomPlatform("");
    setCustomCategory("");
    setFeedDialogOpen(true);
  }

  function openEditDialog(feed: ScraperFeed) {
    setEditFeedId(feed.id);
    setName(feed.name);
    setFeedUrl(feed.feedUrl);
    setPlatform(isScraperPlatformPreset(feed.platform) ? feed.platform : CUSTOM_PLATFORM_VALUE);
    setCustomPlatform(isScraperPlatformPreset(feed.platform) ? "" : feed.platform);
    setCategory(isScraperCategoryPreset(feed.category) ? feed.category : CUSTOM_CATEGORY_VALUE);
    setCustomCategory(isScraperCategoryPreset(feed.category) ? "" : feed.category);
    setEnabled(feed.enabled);
    setIntervalMin(String(feed.runIntervalMinutes));
    setFeedDialogOpen(true);
  }

  function closeFeedDialog() {
    setFeedDialogOpen(false);
    setEditFeedId(null);
  }

  const load = React.useCallback(async () => {
    if (ws.isDemo) {
      setFeeds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/org/scraper-feeds", { credentials: "same-origin" });
      const data = (await res.json()) as { feeds?: ScraperFeed[]; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not load feeds");
        return;
      }
      setFeeds(data.feeds ?? []);
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, [ws.isDemo]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function seedDefaults() {
    setSeeding(true);
    try {
      const res = await fetch("/api/org/scraper-feeds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const data = (await res.json()) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Seed failed");
        return;
      }
      toast.success(`Added ${data.created ?? 0} feeds (${data.skipped ?? 0} already existed)`);
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setSeeding(false);
    }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      const res = await fetch("/api/org/scraper-feeds", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_all" }),
      });
      const data = (await res.json()) as { newTotal?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Run failed");
        return;
      }
      toast.success(`${data.newTotal ?? 0} new posts ingested`);
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setRunningAll(false);
    }
  }

  async function runFeed(feedId: string) {
    setRunFeedId(feedId);
    try {
      const res = await fetch(`/api/org/scraper-feeds/${feedId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const data = (await res.json()) as {
        result?: { newCount: number; error?: string };
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Run failed");
        return;
      }
      const n = data.result?.newCount ?? 0;
      if (data.result?.error) toast.warning(data.result.error);
      toast.success(`${n} new posts`);
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setRunFeedId(null);
    }
  }

  async function saveFeed() {
    const n = name.trim();
    const url = feedUrl.trim();
    const nextPlatform = (isScraperPlatformPreset(platform) ? platform : customPlatform)
      .trim()
      .toLowerCase();
    const nextCategory = (isScraperCategoryPreset(category) ? category : customCategory)
      .trim()
      .toLowerCase();
    if (!n || !url) {
      toast.error("Name and feed URL are required");
      return;
    }
    if (!nextCategory) {
      toast.error("Category is required");
      return;
    }
    if (!nextPlatform) {
      toast.error("Platform is required");
      return;
    }
    const payload = {
      name: n,
      feedUrl: url,
      platform: nextPlatform,
      category: nextCategory,
      enabled,
      runIntervalMinutes: Number(intervalMin) || 60,
    };
    setSavingFeed(true);
    try {
      const res = await fetch(
        isEditing ? `/api/org/scraper-feeds/${editFeedId}` : "/api/org/scraper-feeds",
        {
          method: isEditing ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? (isEditing ? "Update failed" : "Create failed"));
        return;
      }
      toast.success(isEditing ? "Feed updated" : "Feed created");
      closeFeedDialog();
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setSavingFeed(false);
    }
  }

  async function toggleEnabled(feed: ScraperFeed) {
    try {
      const res = await fetch(`/api/org/scraper-feeds/${feed.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !feed.enabled }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Update failed");
        return;
      }
      await load();
    } catch {
      toast.error("Network error");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/org/scraper-feeds/${deleteId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Delete failed");
        return;
      }
      toast.success("Feed deleted");
      setDeleteId(null);
      await load();
    } catch {
      toast.error("Network error");
    }
  }

  return (
    <>
      <PageHeader
        title="Scrapers"
        description="RSS feeds (rss.app) ingested into the intake pool. Replaces n8n + Google Sheets."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </Button>
            <Button variant="outline" size="sm" disabled={seeding || ws.isDemo} onClick={() => void seedDefaults()}>
              {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Seed {DEFAULT_SCRAPER_FEEDS.length} defaults
            </Button>
            <Button variant="outline" size="sm" disabled={runningAll || ws.isDemo} onClick={() => void runAll()}>
              {runningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run all
            </Button>
            <Button size="sm" disabled={ws.isDemo} onClick={openCreateDialog}>
              <Plus className="h-3.5 w-3.5" /> Add feed
            </Button>
          </>
        }
      />
      <PageBody className="space-y-4">
        {ws.isDemo ? (
          <Card>
            <CardHeader>
              <CardTitle>Demo mode</CardTitle>
              <CardDescription>Scraper admin requires a live Firebase workspace.</CardDescription>
            </CardHeader>
          </Card>
        ) : loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading feeds…
          </p>
        ) : feeds.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No feeds yet</CardTitle>
              <CardDescription>
                Click &quot;Seed defaults&quot; to import your n8n/rss.app URLs, or add feeds manually.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Interval</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedFeeds.map((feed) => (
                    <TableRow key={feed.id}>
                      <TableCell>
                        <div className="font-medium">{feed.name}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[240px]" title={feed.feedUrl}>
                          {feed.feedUrl}
                        </div>
                        {feed.lastError ? (
                          <div className="text-xs text-destructive mt-1 truncate max-w-[280px]" title={feed.lastError}>
                            {feed.lastError}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{getScraperPlatformLabel(feed.platform)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getScraperCategoryLabel(feed.category)}</Badge>
                      </TableCell>
                      <TableCell>{feed.runIntervalMinutes}m</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {feed.lastRunAt
                          ? formatDistanceToNow(new Date(feed.lastRunAt), { addSuffix: true })
                          : "Never"}
                        {typeof feed.lastNewCount === "number" && feed.lastRunAt ? (
                          <span className="block text-xs">+{feed.lastNewCount} new</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Switch checked={feed.enabled} onCheckedChange={() => void toggleEnabled(feed)} />
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={() => openEditDialog(feed)}
                            aria-label={`Edit ${feed.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            disabled={runFeedId === feed.id}
                            onClick={() => void runFeed(feed.id)}
                            aria-label={`Run ${feed.name}`}
                          >
                            {runFeedId === feed.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteId(feed.id)}
                            aria-label={`Delete ${feed.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {rangeStart}–{rangeEnd} of {feeds.length} feeds
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="scraper-page-size" className="text-sm text-muted-foreground">
                      Per page
                    </Label>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => v && setPageSize(Number(v) as (typeof PAGE_SIZE_OPTIONS)[number])}
                    >
                      <SelectTrigger id="scraper-page-size" className="h-8 w-[72px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[4.5rem] text-center text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </PageBody>

      <Dialog
        open={feedDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeFeedDialog();
          else setFeedDialogOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit RSS feed" : "Add RSS feed"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="r/hire" />
            </div>
            <div className="space-y-1.5">
              <Label>Feed URL (rss.app)</Label>
              <Input
                value={feedUrl}
                onChange={(e) => setFeedUrl(e.target.value)}
                placeholder="https://rss.app/feeds/….xml"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select
                  value={selectedPlatformValue}
                  onValueChange={(v) => {
                    if (!v) return;
                    setPlatform(v as ScraperPlatform);
                    if (v !== CUSTOM_PLATFORM_VALUE) setCustomPlatform("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCRAPER_PLATFORM_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {getScraperPlatformLabel(p)}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_PLATFORM_VALUE}>Custom...</SelectItem>
                  </SelectContent>
                </Select>
                {platform === CUSTOM_PLATFORM_VALUE ? (
                  <Input
                    value={customPlatform}
                    onChange={(e) => setCustomPlatform(e.target.value)}
                    placeholder="e.g. hackernews"
                    className="mt-2"
                  />
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={selectedCategoryValue}
                  onValueChange={(v) => {
                    if (!v) return;
                    setCategory(v as ScraperCategory);
                    if (v !== CUSTOM_CATEGORY_VALUE) setCustomCategory("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCRAPER_CATEGORY_PRESETS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {getScraperCategoryLabel(c)}
                      </SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_CATEGORY_VALUE}>Custom...</SelectItem>
                  </SelectContent>
                </Select>
                {category === CUSTOM_CATEGORY_VALUE ? (
                  <Input
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    placeholder="e.g. partnership"
                    className="mt-2"
                  />
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>Run every (minutes)</Label>
                <Input
                  type="number"
                  min={15}
                  max={1440}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Enabled</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeFeedDialog} disabled={savingFeed}>
              Cancel
            </Button>
            <Button onClick={() => void saveFeed()} disabled={savingFeed}>
              {savingFeed ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isEditing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete feed?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing raw items from this feed stay in the pool until they expire or are promoted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
