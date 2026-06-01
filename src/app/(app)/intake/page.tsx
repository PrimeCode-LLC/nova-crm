"use client";

import * as React from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { ScraperCategory, ScraperPlatform, ScraperRawItem } from "@/lib/types";
import {
  SCRAPER_CATEGORY_LABELS,
  SCRAPER_PLATFORM_LABELS,
} from "@/lib/scrapers/labels";
import { RAW_ITEM_RETENTION_DAYS } from "@/lib/scrapers/default-feeds";

const ALL = "__all__" as const;

export default function IntakePoolPage() {
  const ws = useWorkspace();
  const [items, setItems] = React.useState<ScraperRawItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [platform, setPlatform] = React.useState<string>(ALL);
  const [category, setCategory] = React.useState<string>(ALL);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (ws.isDemo) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: "available", limit: "200" });
      if (platform !== ALL) params.set("platform", platform);
      if (category !== ALL) params.set("category", category);
      const res = await fetch(`/api/org/scraper-raw?${params}`, { credentials: "same-origin" });
      const data = (await res.json()) as { items?: ScraperRawItem[]; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not load intake pool");
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      toast.error("Network error loading intake pool");
    } finally {
      setLoading(false);
    }
  }, [ws.isDemo, platform, category]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function promote(itemId: string, assignToMe: boolean) {
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/org/scraper-raw/${itemId}/promote`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignToMe }),
      });
      const data = (await res.json()) as { leadId?: string; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Promote failed");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success(assignToMe ? "Prospect created and assigned to you" : "Prospect added to open queue", {
        action: data.leadId
          ? {
              label: "View",
              onClick: () => {
                window.location.href = `/leads/${data.leadId}?from=prospects`;
              },
            }
          : undefined,
      });
    } catch {
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  async function dismiss(itemId: string) {
    setBusyId(itemId);
    try {
      const res = await fetch(`/api/org/scraper-raw/${itemId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Dismiss failed");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      toast.success("Dismissed");
    } catch {
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Intake pool"
        description={`Fresh posts from your RSS scrapers. Unclaimed rows expire after ${RAW_ITEM_RETENTION_DAYS} days unless promoted to a prospect.`}
        actions={
          <>
            <Button variant="outline" size="sm" type="button" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href="/prospects">Prospects</Link>}
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
            <div className="flex flex-wrap gap-3">
              <Select value={platform} onValueChange={(v) => v && setPlatform(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All platforms</SelectItem>
                  {(Object.keys(SCRAPER_PLATFORM_LABELS) as ScraperPlatform[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {SCRAPER_PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={(v) => v && setCategory(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {(Object.keys(SCRAPER_CATEGORY_LABELS) as ScraperCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>
                      {SCRAPER_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground self-center">
                {loading ? "Loading…" : `${items.length} available`}
              </span>
            </div>

            {loading ? (
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
            ) : (
              <ul className="space-y-3">
                {items.map((item) => {
                  const busy = busyId === item.id;
                  const snippet =
                    item.contentSnippet?.trim() ||
                    item.content.replace(/<[^>]+>/g, " ").slice(0, 280);
                  return (
                    <li key={item.id}>
                      <Card>
                        <CardHeader className="pb-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 space-y-1">
                              <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
                              <div className="flex flex-wrap gap-1.5">
                                <Badge variant="secondary">{SCRAPER_PLATFORM_LABELS[item.platform]}</Badge>
                                <Badge variant="outline">{SCRAPER_CATEGORY_LABELS[item.category]}</Badge>
                                <Badge variant="outline" className="font-normal text-muted-foreground">
                                  {item.feedName}
                                </Badge>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatDistanceToNow(new Date(item.publishedAt), { addSuffix: true })}
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground line-clamp-3">{snippet}</p>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="default" size="sm" disabled={busy} type="button" onClick={() => void promote(item.id, true)}>
                              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                              Promote & assign to me
                            </Button>
                            <Button variant="outline" size="sm" disabled={busy} type="button" onClick={() => void promote(item.id, false)}>
                              <Users className="h-3.5 w-3.5" /> Open queue
                            </Button>
                            <Button variant="ghost" size="sm" disabled={busy} type="button" onClick={() => void dismiss(item.id)}>
                              <X className="h-3.5 w-3.5" /> Dismiss
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              nativeButton={false}
                              render={
                                <a href={item.link} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5" /> Source
                                </a>
                              }
                            />
                          </div>
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
