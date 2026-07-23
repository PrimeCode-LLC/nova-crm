"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, SkipForward } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { can } from "@/lib/permissions/can";
import { cn } from "@/lib/utils";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import {
  CONTENT_PILLAR_LABELS,
  CONTENT_PLATFORM_LABELS,
  CONTENT_STATUS_LABELS,
  contentVariantCharLimit,
  isContentItemOverdue,
  type ContentItemStatus,
  type ContentPlatform,
} from "@/lib/content-calendar/types";
import { fmtDate } from "@/lib/format";

export function ContentItemDetailClient() {
  const params = useParams();
  const router = useRouter();
  const itemId = String(params.itemId ?? "");
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
  const canEdit = can(permissionSubject, "content_calendar", "edit");

  const item = data.items.find((i) => i.id === itemId);
  const brand = data.brands.find((b) => b.id === item?.brandId);

  const [bodies, setBodies] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!item) return;
    const next: Record<string, string> = {};
    for (const v of item.variants) next[v.platform] = v.body;
    setBodies(next);
  }, [item]);

  if (data.loading) {
    return (
      <AppPage>
        <PageHeader title="Content item" description="Loading…" />
      </AppPage>
    );
  }

  if (!item) {
    return (
      <AppPage>
        <PageHeader title="Not found" description="This content item does not exist." />
        <PageBody>
          <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Back
          </Link>
        </PageBody>
      </AppPage>
    );
  }

  async function saveBodies() {
    if (!canEdit || !item) return;
    const variants = item.platforms.map((p) => ({
      platform: p,
      body: bodies[p] ?? item.variants.find((v) => v.platform === p)?.body ?? "",
      hook: item.variants.find((v) => v.platform === p)?.hook,
    }));
    await data.updateItem(item.id, {
      variants,
      status: item.status === "idea" || item.status === "research" ? "draft" : item.status,
    });
    toast.success("Saved");
  }

  async function setStatus(status: ContentItemStatus) {
    if (!canEdit || !item) return;
    await data.updateItemStatus(item.id, status);
    toast.success("Updated");
  }

  async function copy(platform: ContentPlatform) {
    if (!item) return;
    const text = bodies[platform] || item.variants.find((v) => v.platform === platform)?.body || "";
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function repurpose(platform: ContentPlatform) {
    if (!canEdit || !item || !brand) return;
    if (item.platforms.includes(platform)) {
      toast.message("Already has this platform");
      return;
    }
    const res = await fetch("/api/ai/content-draft-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        brandId: brand.id,
        platform,
        pillarKey: item.pillarKey,
        title: item.title,
        angle: item.angle,
        proofHint: item.ragCitations?.[0]?.title ?? item.angle,
        ctaType: item.ctaType,
      }),
    });
    const json = (await res.json()) as { error?: string; body?: string; hook?: string };
    if (!res.ok) {
      toast.error(json.error || "Repurpose failed");
      return;
    }
    const platforms = [...item.platforms, platform];
    const variants = [
      ...item.variants,
      { platform, body: json.body || item.angle, hook: json.hook },
    ];
    await data.updateItem(item.id, { platforms, variants });
    toast.success(`Added ${CONTENT_PLATFORM_LABELS[platform]}`);
  }

  const overdue = isContentItemOverdue(item);

  return (
    <AppPage>
      <PageHeader
        title={item.title}
        description={`${brand?.name ?? "Brand"} · ${fmtDate(item.publishAt)} · ${CONTENT_PILLAR_LABELS[item.pillarKey]}`}
        actions={
          <>
            <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Calendar
            </Link>
            {canEdit && item.status !== "published" && (
              <>
                <Button size="sm" type="button" onClick={() => void setStatus("published")}>
                  <Check className="h-3.5 w-3.5" /> Mark published
                </Button>
                <Button size="sm" variant="outline" type="button" onClick={() => void setStatus("skipped")}>
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </Button>
              </>
            )}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-wrap gap-2">
          <Badge variant={overdue ? "destructive" : "secondary"}>
            {CONTENT_STATUS_LABELS[item.status]}
            {overdue ? " · overdue" : ""}
          </Badge>
          {item.platforms.map((p) => (
            <Badge key={p} variant="outline">
              {CONTENT_PLATFORM_LABELS[p]}
            </Badge>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Angle</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>{item.angle}</p>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select
                value={item.status}
                disabled={!canEdit}
                onValueChange={(v) => void setStatus(v as ContentItemStatus)}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTENT_STATUS_LABELS) as ContentItemStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {CONTENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {item.platforms.map((platform) => {
          const body = bodies[platform] ?? "";
          const limit = contentVariantCharLimit(platform);
          return (
            <Card key={platform}>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">{CONTENT_PLATFORM_LABELS[platform]}</CardTitle>
                <div className="flex gap-2">
                  <span
                    className={
                      body.length > limit ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                    }
                  >
                    {body.length}/{limit}
                  </span>
                  <Button size="sm" variant="outline" type="button" onClick={() => void copy(platform)}>
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={body}
                  disabled={!canEdit}
                  rows={8}
                  onChange={(e) => setBodies((prev) => ({ ...prev, [platform]: e.target.value }))}
                />
              </CardContent>
            </Card>
          );
        })}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveBodies()}>
              Save drafts
            </Button>
            <Select
              onValueChange={(v) => void repurpose(v as ContentPlatform)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Repurpose to…" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONTENT_PLATFORM_LABELS) as ContentPlatform[])
                  .filter((p) => !item.platforms.includes(p))
                  .map((p) => (
                    <SelectItem key={p} value={p}>
                      {CONTENT_PLATFORM_LABELS[p]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                void data.deleteItem(item.id).then(() => router.push("/content"));
              }}
            >
              Delete
            </Button>
          </div>
        )}

        {item.ragCitations && item.ragCitations.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">RAG citations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {item.ragCitations.map((c, i) => (
                <div key={i} className="rounded-md border px-3 py-2">
                  <div className="font-medium">{c.title}</div>
                  <div className="text-muted-foreground text-xs mt-1">{c.excerpt}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </PageBody>
    </AppPage>
  );
}
