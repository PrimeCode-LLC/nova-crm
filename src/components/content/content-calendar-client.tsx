"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  Copy,
  Filter,
  Plus,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { can } from "@/lib/permissions/can";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { brandsNeedingCaptureAttention } from "@/lib/content-calendar/capture-policy";
import { computeContentConsistency } from "@/lib/content-calendar/consistency";
import {
  CONTENT_FORMAT_LABELS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PLATFORM_LABELS,
  CONTENT_STATUS_LABELS,
  isContentItemOverdue,
  type ContentItem,
  type ContentPlatform,
  type ContentItemStatus,
} from "@/lib/content-calendar/types";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { ContentFillDaysDialog } from "@/components/content/content-fill-days-dialog";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysInView(anchor: Date, mode: "week" | "month"): Date[] {
  if (mode === "week") {
    const start = startOfDay(anchor);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  return days;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function ContentCalendarClient() {
  const navAccess = useNavAccessContext();
  const data = useContentCalendarData();
  const permissionSubject = React.useMemo(
    () => ({
      roleId: navAccess.roleId ?? "salesperson",
      isSuperAdmin: Boolean(navAccess.isSuperAdmin),
      featureGrants: navAccess.featureGrants,
      orgRole: navAccess.orgRole,
      roleSnapshot: navAccess.roleSnapshot,
    }),
    [navAccess],
  );

  const canView = can(permissionSubject, "content_calendar", "view");
  const canCreate = can(permissionSubject, "content_calendar", "create");
  const canEdit = can(permissionSubject, "content_calendar", "edit");

  const [brandId, setBrandId] = React.useState<string>("all");
  const [platform, setPlatform] = React.useState<string>("all");
  const [viewMode, setViewMode] = React.useState<"week" | "month">("month");
  const [anchor, setAnchor] = React.useState(() => new Date());
  const [fillOpen, setFillOpen] = React.useState(false);

  const activeBrands = data.brands.filter((b) => b.active);
  const selectedBrand =
    brandId === "all" ? null : activeBrands.find((b) => b.id === brandId) ?? null;

  const scopedItems = React.useMemo(() => {
    let list = data.items;
    if (brandId !== "all") list = list.filter((i) => i.brandId === brandId);
    if (platform !== "all") {
      list = list.filter((i) => i.platforms.includes(platform as ContentPlatform));
    }
    return list;
  }, [data.items, brandId, platform]);

  const now = React.useMemo(() => new Date(), []);
  const overdue = scopedItems.filter((i) => isContentItemOverdue(i, now));
  const todayItems = scopedItems.filter((i) => sameDay(new Date(i.publishAt), now));
  const score = computeContentConsistency({
    items: scopedItems,
    brand: selectedBrand,
    now,
  });

  const captureAttention = React.useMemo(
    () =>
      brandsNeedingCaptureAttention({
        brands: data.brands,
        captures: data.captures,
        currentUserId: data.currentUserId,
        nowMs: now.getTime(),
      }),
    [data.brands, data.captures, data.currentUserId, now],
  );

  const days = daysInView(anchor, viewMode);

  if (!canView) {
    return (
      <AppPage>
        <PageHeader title="Content" description="You do not have access to the content calendar." />
      </AppPage>
    );
  }

  async function copyVariant(item: ContentItem, platformKey: ContentPlatform) {
    const variant = item.variants.find((v) => v.platform === platformKey);
    const text = variant?.body || item.angle;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function markStatus(item: ContentItem, status: ContentItemStatus) {
    if (!canEdit) return;
    await data.updateItemStatus(item.id, status);
    toast.success(status === "published" ? "Marked published" : status === "skipped" ? "Skipped" : "Updated");
  }

  return (
    <AppPage>
      <PageHeader
        title="Content calendar"
        description="Strategy-first posts for LinkedIn, X, Instagram, and Reddit - capture proof, fill days, execute."
        actions={
          <>
            <Link
              href="/content/brands"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Brands
            </Link>
            <Link
              href="/content/capture"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex gap-1")}
            >
              <Plus className="h-3.5 w-3.5" /> Capture
            </Link>
            {canCreate && (
              <Button
                size="sm"
                type="button"
                disabled={!selectedBrand && activeBrands.length === 0}
                onClick={() => {
                  if (!selectedBrand && activeBrands[0]) setBrandId(activeBrands[0].id);
                  setFillOpen(true);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> Generate content plan
              </Button>
            )}
          </>
        }
      />
      <PageBody>
        {data.loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : activeBrands.length === 0 ? (
          <div className="space-y-4">
            <WorkspaceEmptyHint
              title="Set up a content brand"
              description="Create a personal or company brand with goal, pillars, and platforms - then fill your calendar."
            />
            <div className="flex justify-center">
              <Link href="/content/brands" className={cn(buttonVariants({ size: "sm" }))}>
                Create brand
              </Link>
            </div>
          </div>
        ) : (
          <>
            {captureAttention.length > 0 ? (
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm">
                Capture needs attention for{" "}
                {captureAttention.map((a) => a.brand.name).join(", ")}.{" "}
                <Link href="/content/capture" className="underline underline-offset-2">
                  Open Capture
                </Link>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={brandId} onValueChange={(v) => setBrandId(v ?? "all")}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Brand">
                    {brandId === "all" ? "All brands" : selectedBrand?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All brands</SelectItem>
                  {activeBrands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={platform} onValueChange={(v) => setPlatform(v ?? "all")}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Platform">
                    {platform === "all"
                      ? "All platforms"
                      : CONTENT_PLATFORM_LABELS[platform as ContentPlatform]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  {(Object.keys(CONTENT_PLATFORM_LABELS) as ContentPlatform[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {CONTENT_PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as "week" | "month")}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue>
                    {viewMode === "week" ? "Week" : "Month"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() =>
                  setAnchor((a) => {
                    const n = new Date(a);
                    n.setDate(n.getDate() - (viewMode === "week" ? 7 : 30));
                    return n;
                  })
                }
              >
                Prev
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => setAnchor(new Date())}>
                Today
              </Button>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() =>
                  setAnchor((a) => {
                    const n = new Date(a);
                    n.setDate(n.getDate() + (viewMode === "week" ? 7 : 30));
                    return n;
                  })
                }
              >
                Next
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Planned this week" value={String(score.total)} />
              <Stat label="Published" value={`${score.published} (${score.publishedPercent}%)`} />
              <Stat label="Awaiting approval" value={String(score.awaitingApproval)} />
              <Stat
                label="Overdue"
                value={String(overdue.length)}
                highlight={overdue.length > 0}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Verified / ready" value={`${score.verifiedReadyPercent}%`} />
              <Stat label="Open" value={String(score.open)} />
              <Stat
                label="Weekly target"
                value={
                  selectedBrand?.cadence.weeklyPublishTarget
                    ? String(selectedBrand.cadence.weeklyPublishTarget)
                    : "-"
                }
              />
            </div>

            {(overdue.length > 0 || todayItems.length > 0) && (
              <div className="grid gap-3 lg:grid-cols-2">
                {overdue.length > 0 && (
                  <Card className="border-destructive/40">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        Overdue
                      </CardTitle>
                      <CardDescription>Not published or skipped past due date</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {overdue.slice(0, 8).map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          brandName={activeBrands.find((b) => b.id === item.brandId)?.name}
                          canEdit={canEdit}
                          onCopy={copyVariant}
                          onStatus={markStatus}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}
                {todayItems.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Today</CardTitle>
                      <CardDescription>Due to publish today</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {todayItems.map((item) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          brandName={activeBrands.find((b) => b.id === item.brandId)?.name}
                          canEdit={canEdit}
                          onCopy={copyVariant}
                          onStatus={markStatus}
                        />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {score.pillarMix.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground self-center">Pillar mix:</span>
                {score.pillarMix.map((p) => (
                  <Badge key={p.key} variant="secondary" className="text-[10px]">
                    {CONTENT_PILLAR_LABELS[p.key]} {p.percent}%
                    {p.targetPercent ? ` / ${p.targetPercent}%` : ""}
                  </Badge>
                ))}
              </div>
            )}

            <div
              className={cn(
                "grid gap-2",
                viewMode === "week" ? "md:grid-cols-7" : "md:grid-cols-7",
              )}
            >
              {days.map((day) => {
                const dayItems = scopedItems.filter((i) => sameDay(new Date(i.publishAt), day));
                const isToday = sameDay(day, now);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "min-h-[120px] rounded-lg border p-2",
                      isToday && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <div className="text-xs font-medium mb-2">
                      {day.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </div>
                    <div className="space-y-1.5">
                      {dayItems.map((item) => (
                        <Link
                          key={item.id}
                          href={`/content/${item.id}`}
                          className={cn(
                            "block rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-muted/50",
                            isContentItemOverdue(item, now) && "border-destructive/50",
                          )}
                        >
                          <div className="font-medium line-clamp-2">{item.title}</div>
                          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-1">
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {CONTENT_STATUS_LABELS[item.status]}
                            </Badge>
                            {item.platforms.slice(0, 2).map((p) => (
                              <span key={p}>{CONTENT_PLATFORM_LABELS[p]}</span>
                            ))}
                            {item.format ? (
                              <span>{CONTENT_FORMAT_LABELS[item.format]}</span>
                            ) : null}
                            {item.verifiedFromKnowledge || (item.ragCitations?.length ?? 0) > 0 ? (
                              <span className="text-emerald-700 dark:text-emerald-400">Verified</span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                            {CONTENT_PILLAR_LABELS[item.pillarKey] ?? item.pillarKey}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </PageBody>

      <ContentFillDaysDialog
        open={fillOpen}
        onOpenChange={setFillOpen}
        brands={activeBrands}
        initialBrandId={selectedBrand?.id ?? activeBrands[0]?.id}
        items={data.items}
        currentUserId={data.currentUserId}
        createItem={data.createItem}
        savePlan={data.savePlan}
      />
    </AppPage>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && "border-destructive/40")}>
      <CardContent className="pt-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function ItemRow({
  item,
  brandName,
  canEdit,
  onCopy,
  onStatus,
}: {
  item: ContentItem;
  brandName?: string;
  canEdit: boolean;
  onCopy: (item: ContentItem, platform: ContentPlatform) => void;
  onStatus: (item: ContentItem, status: ContentItemStatus) => void;
}) {
  const primary = item.platforms[0] ?? "linkedin";
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5">
      <div className="min-w-0">
        <Link href={`/content/${item.id}`} className="text-sm font-medium hover:underline">
          {item.title}
        </Link>
        <div className="text-[11px] text-muted-foreground">
          {brandName ? `${brandName} · ` : ""}
          {fmtDate(item.publishAt)} · {CONTENT_PILLAR_LABELS[item.pillarKey]}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          type="button"
          title="Copy"
          onClick={() => onCopy(item, primary)}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {canEdit && item.status !== "published" && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              type="button"
              title="Mark published"
              onClick={() => onStatus(item, "published")}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              type="button"
              title="Skip"
              onClick={() => onStatus(item, "skipped")}
            >
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
