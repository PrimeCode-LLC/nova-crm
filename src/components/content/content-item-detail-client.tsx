"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, Plus, SkipForward, Sparkles, Trash2 } from "lucide-react";

import { AppPage, PageBody, PageHeader } from "@/components/common/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { UserChip } from "@/components/common/user-chip";
import { can } from "@/lib/permissions/can";
import { cn } from "@/lib/utils";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import {
  CONTENT_CHECKLIST_STEP_LABELS,
  CONTENT_FORMAT_LABELS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PLATFORM_LABELS,
  CONTENT_STATUS_LABELS,
  buildContentChecklist,
  contentGraphicsSizeHint,
  contentVariantCharLimit,
  firstPendingChecklistAssignee,
  formatNeedsGraphics,
  isContentItemOverdue,
  statusFromChecklist,
  type ContentAssetLink,
  type ContentChecklistStep,
  type ContentChecklistStepKey,
  type ContentChecklistStepStatus,
  type ContentItemStatus,
  type ContentPlatform,
} from "@/lib/content-calendar/types";
import { fmtDate } from "@/lib/format";
import { scrubAiTellPunctuation } from "@/lib/content-calendar/schedule";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { OrganizationMember } from "@/lib/types";

export function ContentItemDetailClient() {
  const params = useParams();
  const router = useRouter();
  const itemId = String(params.itemId ?? "");
  const navAccess = useNavAccessContext();
  const ws = useWorkspace();
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
  const [assetUrl, setAssetUrl] = React.useState("");
  const [assetLabel, setAssetLabel] = React.useState("");
  const [designDraft, setDesignDraft] = React.useState("");
  const [briefBusy, setBriefBusy] = React.useState(false);
  const [members, setMembers] = React.useState<{ uid: string; label: string }[]>([]);

  React.useEffect(() => {
    if (!item) return;
    const next: Record<string, string> = {};
    for (const v of item.variants) next[v.platform] = scrubAiTellPunctuation(v.body);
    setBodies(next);
    setDesignDraft(scrubAiTellPunctuation(item.designInstructions ?? ""));
  }, [item]);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/org/members", { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { members?: OrganizationMember[] };
        const list = (json.members ?? [])
          .filter((m) => m.status === "active")
          .map((m) => ({
            uid: m.uid,
            label: m.displayName?.trim() || m.email?.trim() || m.uid,
          }));
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) {
          setMembers(
            ws.users.map((u) => ({
              uid: u.id,
              label: u.displayName?.trim() || u.email?.trim() || u.id,
            })),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ws.users]);

  const checklist = React.useMemo(() => {
    if (!item) return [] as ContentChecklistStep[];
    if (item.checklist?.length) return item.checklist;
    if (!brand) return [];
    return buildContentChecklist({
      brand,
      format: item.format,
      dueAt: item.dueAt,
      fallbackUserId: item.assigneeUserId || data.currentUserId,
    });
  }, [item, brand, data.currentUserId]);

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

  async function persistChecklist(nextChecklist: ContentChecklistStep[]) {
    if (!canEdit || !item) return;
    const status = statusFromChecklist(nextChecklist, item.status);
    const assigneeUserId = firstPendingChecklistAssignee(
      nextChecklist,
      item.assigneeUserId || data.currentUserId,
    );
    const completedAt =
      status === "published" || status === "skipped" || status === "repurpose"
        ? new Date().toISOString()
        : undefined;
    await data.updateItem(item.id, {
      checklist: nextChecklist,
      assigneeUserId,
      status,
      completedAt,
    });
  }

  async function setStepStatus(key: ContentChecklistStepKey, status: ContentChecklistStepStatus) {
    if (!canEdit || !item) return;
    const now = new Date().toISOString();
    const next = checklist.map((step) =>
      step.key === key
        ? {
            ...step,
            status,
            completedAt: status === "pending" ? undefined : now,
            completedById: status === "pending" ? undefined : data.currentUserId,
          }
        : step,
    );
    await persistChecklist(next);
    toast.success(
      status === "done"
        ? "Step completed"
        : status === "skipped"
          ? "Step skipped"
          : "Step reopened",
    );
  }

  async function reassignStep(key: ContentChecklistStepKey, assigneeUserId: string) {
    if (!canEdit || !item) return;
    const next = checklist.map((step) =>
      step.key === key ? { ...step, assigneeUserId } : step,
    );
    await persistChecklist(next);
    toast.success("Assignee updated");
  }

  async function addAssetLink() {
    if (!canEdit || !item) return;
    const url = assetUrl.trim();
    if (!url) {
      toast.error("Paste a graphics URL");
      return;
    }
    try {
      // Validate URL shape before saving.
      void new URL(url);
    } catch {
      toast.error("Enter a valid URL");
      return;
    }
    const link: ContentAssetLink = {
      url,
      label: assetLabel.trim() || undefined,
      addedById: data.currentUserId,
      addedAt: new Date().toISOString(),
    };
    const assetLinks = [...(item.assetLinks ?? []), link];
    await data.updateItem(item.id, { assetLinks });
    setAssetUrl("");
    setAssetLabel("");
    toast.success("Asset link added");
  }

  async function removeAssetLink(index: number) {
    if (!canEdit || !item) return;
    const assetLinks = (item.assetLinks ?? []).filter((_, i) => i !== index);
    await data.updateItem(item.id, { assetLinks });
    toast.success("Link removed");
  }

  async function saveDesignInstructions() {
    if (!canEdit || !item) return;
    const designInstructions = scrubAiTellPunctuation(designDraft) || undefined;
    setDesignDraft(designInstructions ?? "");
    await data.updateItem(item.id, { designInstructions });
    toast.success("Design brief saved");
  }

  async function copyDesignBrief() {
    const text = scrubAiTellPunctuation(designDraft);
    if (!text) {
      toast.message("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Design brief copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  async function generateDesignBrief() {
    if (!canEdit || !item || !brand) return;
    const platform = item.platforms[0];
    if (!platform) {
      toast.error("Add a platform first");
      return;
    }
    const format = item.format ?? "graphic_post";
    if (!formatNeedsGraphics(format)) {
      toast.message("This format does not need graphics");
      return;
    }
    setBriefBusy(true);
    try {
      const variant = item.variants.find((v) => v.platform === platform);
      const res = await fetch("/api/ai/content-graphics-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          brandId: brand.id,
          platform,
          format,
          pillarKey: item.pillarKey,
          title: item.title,
          angle: item.angle,
          ctaType: item.ctaType,
          hook: variant?.hook,
          body: bodies[platform] || variant?.body || item.angle,
        }),
      });
      const json = (await res.json()) as { error?: unknown; designInstructions?: string };
      if (!res.ok) {
        toast.error(
          typeof json.error === "string" ? json.error : "Could not generate design brief",
        );
        return;
      }
      const designInstructions = scrubAiTellPunctuation(json.designInstructions ?? "");
      setDesignDraft(designInstructions);
      await data.updateItem(item.id, { designInstructions: designInstructions || undefined });
      toast.success("Design brief ready");
    } finally {
      setBriefBusy(false);
    }
  }

  async function saveBodies() {
    if (!canEdit || !item) return;
    const cleaned: Record<string, string> = {};
    const variants = item.platforms.map((p) => {
      const body = scrubAiTellPunctuation(
        bodies[p] ?? item.variants.find((v) => v.platform === p)?.body ?? "",
      );
      cleaned[p] = body;
      const prev = item.variants.find((v) => v.platform === p);
      return {
        platform: p,
        body,
        hook: prev?.hook ? scrubAiTellPunctuation(prev.hook) : prev?.hook,
        format: prev?.format,
      };
    });
    setBodies(cleaned);
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
    const raw = bodies[platform] || item.variants.find((v) => v.platform === platform)?.body || "";
    const text = scrubAiTellPunctuation(raw);
    if (!text) {
      toast.message("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (text !== raw) {
        setBodies((prev) => ({ ...prev, [platform]: text }));
      }
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
      {
        platform,
        body: scrubAiTellPunctuation(json.body || item.angle),
        hook: json.hook ? scrubAiTellPunctuation(json.hook) : json.hook,
      },
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
            <CardTitle className="text-base">Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {checklist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checklist steps yet.</p>
            ) : (
              checklist.map((step) => (
                <div
                  key={step.key}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Badge
                    variant={
                      step.status === "done"
                        ? "secondary"
                        : step.status === "skipped"
                          ? "outline"
                          : "default"
                    }
                  >
                    {CONTENT_CHECKLIST_STEP_LABELS[step.key]}
                  </Badge>
                  <span className="text-xs text-muted-foreground capitalize">{step.status}</span>
                  <div className="min-w-0 flex-1">
                    {canEdit ? (
                      <Select
                        value={step.assigneeUserId}
                        onValueChange={(v) => {
                          if (v) void reassignStep(step.key, v);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue>
                            <UserChip userId={step.assigneeUserId} size="sm" />
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {members.map((m) => (
                            <SelectItem key={m.uid} value={m.uid}>
                              {m.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <UserChip userId={step.assigneeUserId} size="sm" />
                    )}
                  </div>
                  {canEdit && step.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => void setStepStatus(step.key, "done")}
                      >
                        Done
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() => void setStepStatus(step.key, "skipped")}
                      >
                        Skip
                      </Button>
                    </>
                  )}
                  {canEdit && step.status !== "pending" && (
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() => void setStepStatus(step.key, "pending")}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Graphics / assets</CardTitle>
            {item.format && formatNeedsGraphics(item.format) ? (
              <Badge variant="secondary" className="font-normal">
                {CONTENT_FORMAT_LABELS[item.format]}
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {(formatNeedsGraphics(item.format) || designDraft.trim()) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm">Design brief</Label>
                    {item.platforms[0] && item.format && formatNeedsGraphics(item.format) ? (
                      <p className="text-xs text-muted-foreground">
                        Suggested size:{" "}
                        {contentGraphicsSizeHint(item.platforms[0], item.format)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {designDraft.trim() ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copyDesignBrief()}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    ) : null}
                    {canEdit && formatNeedsGraphics(item.format) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={briefBusy}
                        onClick={() => void generateDesignBrief()}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {briefBusy
                          ? "Generating…"
                          : designDraft.trim()
                            ? "Regenerate"
                            : "Generate brief"}
                      </Button>
                    )}
                  </div>
                </div>
                {canEdit ? (
                  <>
                    <Textarea
                      value={designDraft}
                      onChange={(e) => setDesignDraft(e.target.value)}
                      rows={7}
                      placeholder={`Short designer brief, e.g.\nPlatform / format / size: Instagram · Graphic · 1080×1080\nOn-graphic headline: …\nMust show: …\nTone: …\nAvoid: …`}
                      className="font-mono text-xs leading-relaxed"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveDesignInstructions()}
                        disabled={designDraft.trim() === (item.designInstructions ?? "").trim()}
                      >
                        Save brief
                      </Button>
                    </div>
                  </>
                ) : designDraft.trim() ? (
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs leading-relaxed">
                    {designDraft}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">No design brief yet.</p>
                )}
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-sm">Asset links</Label>
              {(item.assetLinks ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Designers can paste Drive, Figma, or CDN links here.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(item.assetLinks ?? []).map((link, index) => (
                    <li
                      key={`${link.url}-${index}`}
                      className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="min-w-0 flex-1 truncate text-primary hover:underline"
                      >
                        {link.label || link.url}
                      </a>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => void removeAssetLink(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={assetUrl}
                    onChange={(e) => setAssetUrl(e.target.value)}
                    placeholder="https://…"
                    className="flex-1"
                  />
                  <Input
                    value={assetLabel}
                    onChange={(e) => setAssetLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="sm:w-40"
                  />
                  <Button type="button" size="sm" onClick={() => void addAssetLink()}>
                    <Plus className="h-3.5 w-3.5" /> Add link
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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
                <span
                  className={
                    body.length > limit ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                  }
                >
                  {body.length}/{limit}
                </span>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <Textarea
                    value={body}
                    disabled={!canEdit}
                    rows={8}
                    className="pr-10"
                    onChange={(e) => setBodies((prev) => ({ ...prev, [platform]: e.target.value }))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground hover:text-foreground"
                    title="Copy"
                    aria-label="Copy"
                    onClick={() => void copy(platform)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveBodies()}>
              Save drafts
            </Button>
            <Select onValueChange={(v) => void repurpose(v as ContentPlatform)}>
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
