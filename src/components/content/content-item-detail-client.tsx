"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Info,
  Plus,
  SkipForward,
  Sparkles,
  Trash2,
} from "lucide-react";

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
  type ContentFormat,
  type ContentItemStatus,
  type ContentPlatform,
  type ContentVariant,
} from "@/lib/content-calendar/types";
import { fmtDate } from "@/lib/format";
import { scrubAiTellPunctuation, scrubPostBody } from "@/lib/content-calendar/schedule";
import {
  contentBodyCharTarget,
  formatUsesSegments,
  getContentPlatformPlaybook,
  segmentCountTarget,
} from "@/lib/content-calendar/platform-playbooks";
import { contentLintSummary, lintContentVariant } from "@/lib/content-calendar/post-lint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { OrganizationMember } from "@/lib/types";

/** Editable shape of one platform variant, with hashtags as raw text. */
type VariantDraft = {
  body: string;
  hashtags: string;
  firstComment: string;
  altText: string;
  postTitle: string;
  segments: string[];
};

function hashtagsToText(tags: string[] | undefined): string {
  return (tags ?? []).map((t) => `#${t}`).join(" ");
}

function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const tag = raw.replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function variantToDraft(variant: ContentVariant | undefined): VariantDraft {
  return {
    body: variant ? scrubPostBody(variant.body, variant.platform) : "",
    hashtags: hashtagsToText(variant?.hashtags),
    firstComment: variant?.firstComment ?? "",
    altText: variant?.altText ?? "",
    postTitle: variant?.postTitle ?? "",
    segments: variant?.segments ?? [],
  };
}

/** Unsaved editor state for one content item. */
type ItemEdits = {
  drafts: Partial<Record<ContentPlatform, VariantDraft>>;
  /** null means "no local edit yet", so the saved brief shows through. */
  design: string | null;
};

/** Body plus hashtags, i.e. exactly what gets pasted into the platform. */
function draftToPostText(draft: VariantDraft, platform: ContentPlatform): string {
  const body = scrubPostBody(draft.body, platform);
  const tags = parseHashtags(draft.hashtags);
  if (tags.length === 0) return body;
  return `${body}\n\n${tags.map((t) => `#${t}`).join(" ")}`;
}

function PlatformDraftCard({
  platform,
  format,
  draft,
  canEdit,
  bannedPhrases,
  onChange,
  onCopy,
}: {
  platform: ContentPlatform;
  format?: ContentFormat;
  draft: VariantDraft;
  canEdit: boolean;
  bannedPhrases: string[];
  onChange: (patch: Partial<VariantDraft>) => void;
  onCopy: () => void;
}) {
  const playbook = getContentPlatformPlaybook(platform);
  const target = contentBodyCharTarget(platform, format);
  const limit = contentVariantCharLimit(platform, format);
  const tags = parseHashtags(draft.hashtags);
  const usesSegments = formatUsesSegments(platform, format);
  const segmentTarget = segmentCountTarget(platform, format);

  const lint = lintContentVariant({
    platform,
    format,
    body: draft.body,
    hashtags: tags,
    segments: draft.segments,
    bannedPhrases,
  });

  const len = draft.body.length;
  const lengthTone =
    len > limit
      ? "text-destructive"
      : len < target.min || len > target.max
        ? "text-amber-500"
        : "text-emerald-500";

  const errors = lint.findings.filter((f) => f.severity === "error");

  return (
    <Card>
      <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{CONTENT_PLATFORM_LABELS[platform]}</CardTitle>
          {format ? (
            <Badge variant="outline" className="font-normal">
              {CONTENT_FORMAT_LABELS[format]}
            </Badge>
          ) : null}
          <Badge
            variant={errors.length > 0 ? "destructive" : lint.findings.length > 0 ? "secondary" : "outline"}
            className="font-normal"
          >
            {contentLintSummary(lint)}
          </Badge>
        </div>
        <span className={cn("text-xs tabular-nums", lengthTone)}>
          {len} / {target.min}-{target.max} chars
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Textarea
            value={draft.body}
            disabled={!canEdit}
            rows={usesSegments ? 5 : 10}
            className="pr-10 leading-relaxed"
            onChange={(e) => onChange({ body: e.target.value })}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Copy post with hashtags"
            aria-label="Copy post with hashtags"
            onClick={onCopy}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          First ~{playbook.previewChars} characters show before {CONTENT_PLATFORM_LABELS[platform]}{" "}
          truncates.
        </p>

        {usesSegments && segmentTarget ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm">
                {format === "thread" ? "Thread posts" : "Slides"}{" "}
                <span className="font-normal text-muted-foreground">
                  ({draft.segments.length} of {segmentTarget.min}-{segmentTarget.max})
                </span>
              </Label>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onChange({ segments: [...draft.segments, ""] })}
                >
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              ) : null}
            </div>
            {draft.segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet. Regenerate the draft or add parts manually.
              </p>
            ) : (
              draft.segments.map((segment, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="mt-2 w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {index + 1}.
                  </span>
                  <Textarea
                    value={segment}
                    disabled={!canEdit}
                    rows={2}
                    className="flex-1 text-sm"
                    onChange={(e) => {
                      const next = [...draft.segments];
                      next[index] = e.target.value;
                      onChange({ segments: next });
                    }}
                  />
                  <div className="mt-2 flex shrink-0 items-center gap-1">
                    {format === "thread" ? (
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          segment.length > 280 ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {segment.length}/280
                      </span>
                    ) : null}
                    {canEdit ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Remove part ${index + 1}`}
                        onClick={() =>
                          onChange({ segments: draft.segments.filter((_, i) => i !== index) })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {platform === "reddit" ? (
          <div className="space-y-1.5">
            <Label className="text-sm">Post title</Label>
            <Input
              value={draft.postTitle}
              disabled={!canEdit}
              placeholder="Specific, non-clickbait title the subreddit would click"
              onChange={(e) => onChange({ postTitle: e.target.value })}
            />
          </div>
        ) : null}

        {playbook.hashtags.max > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm">Hashtags</Label>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  tags.length > playbook.hashtags.max
                    ? "text-destructive"
                    : tags.length < playbook.hashtags.min
                      ? "text-amber-500"
                      : "text-muted-foreground",
                )}
              >
                {tags.length} / {playbook.hashtags.min}-{playbook.hashtags.max}
              </span>
            </div>
            <Input
              value={draft.hashtags}
              disabled={!canEdit}
              placeholder={
                platform === "instagram"
                  ? "#supplychainops #warehouseautomation #3pl"
                  : "Optional, specific topics only"
              }
              onChange={(e) => onChange({ hashtags: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{playbook.hashtagStyle}</p>
          </div>
        ) : null}

        {playbook.linkPolicy.firstComment !== "not_applicable" ? (
          <div className="space-y-1.5">
            <Label className="text-sm">First comment</Label>
            <Textarea
              value={draft.firstComment}
              disabled={!canEdit}
              rows={2}
              placeholder={
                playbook.linkPolicy.firstComment === "reliable"
                  ? "Links go here, not in the body"
                  : "Only if the click matters more than reach"
              }
              className="text-sm"
              onChange={(e) => onChange({ firstComment: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{playbook.linkPolicy.guidance}</p>
          </div>
        ) : null}

        {formatNeedsGraphics(format) ? (
          <div className="space-y-1.5">
            <Label className="text-sm">Alt text</Label>
            <Input
              value={draft.altText}
              disabled={!canEdit}
              placeholder="Describe the graphic. Feeds platform search and screen readers."
              onChange={(e) => onChange({ altText: e.target.value })}
            />
          </div>
        ) : null}

        {lint.findings.length > 0 ? (
          <ul className="space-y-1.5 rounded-md border bg-muted/30 px-3 py-2.5">
            {lint.findings.map((finding, index) => (
              <li key={`${finding.code}-${index}`} className="flex gap-2 text-xs leading-relaxed">
                {finding.severity === "error" ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                )}
                <span className={finding.severity === "error" ? "text-foreground" : "text-muted-foreground"}>
                  {finding.message}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

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

  // Unsaved edits are tagged with the revision they were made against, so a
  // server-side change to the item discards them instead of silently overwriting.
  const revisionKey = item ? `${item.id}:${item.updatedAt}` : "";
  const [edits, setEdits] = React.useState<ItemEdits & { key: string }>({
    key: "",
    drafts: {},
    design: null,
  });
  const [assetUrl, setAssetUrl] = React.useState("");
  const [assetLabel, setAssetLabel] = React.useState("");
  const [briefBusy, setBriefBusy] = React.useState(false);
  const [repurposeBusy, setRepurposeBusy] = React.useState<ContentPlatform | null>(null);
  const [members, setMembers] = React.useState<{ uid: string; label: string }[]>([]);

  const current = edits.key === revisionKey ? edits : null;
  const drafts = current?.drafts ?? {};
  const designDraft =
    current?.design ?? scrubAiTellPunctuation(item?.designInstructions ?? "");

  function updateEdits(apply: (prev: ItemEdits) => ItemEdits) {
    setEdits((prev) => {
      const base: ItemEdits =
        prev.key === revisionKey ? prev : { drafts: {}, design: null };
      return { key: revisionKey, ...apply(base) };
    });
  }

  function setDesignDraft(next: string) {
    updateEdits((prev) => ({ ...prev, design: next }));
  }

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
          body: drafts[platform]?.body || variant?.body || item.angle,
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
    const cleaned: Partial<Record<ContentPlatform, VariantDraft>> = {};
    const variants: ContentVariant[] = item.platforms.map((p) => {
      const prev = item.variants.find((v) => v.platform === p);
      const draft = drafts[p] ?? variantToDraft(prev);
      const platformFormat = prev?.format ?? item.format;
      const body = scrubPostBody(draft.body, p);
      const hashtags = parseHashtags(draft.hashtags).slice(
        0,
        getContentPlatformPlaybook(p).hashtags.max,
      );
      const segments = formatUsesSegments(p, platformFormat)
        ? draft.segments.map((s) => scrubPostBody(s, p)).filter(Boolean)
        : [];

      cleaned[p] = {
        body,
        hashtags: hashtagsToText(hashtags),
        firstComment: draft.firstComment.trim(),
        altText: draft.altText.trim(),
        postTitle: draft.postTitle.trim(),
        segments,
      };

      return {
        platform: p,
        body,
        hook: prev?.hook ? scrubAiTellPunctuation(prev.hook) : prev?.hook,
        format: prev?.format,
        hashtags: hashtags.length ? hashtags : undefined,
        firstComment: draft.firstComment.trim() || undefined,
        segments: segments.length ? segments : undefined,
        altText: draft.altText.trim() || undefined,
        postTitle: p === "reddit" ? draft.postTitle.trim() || undefined : undefined,
      };
    });
    updateEdits((prev) => ({ ...prev, drafts: cleaned }));
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
    const draft = drafts[platform] ?? variantToDraft(item.variants.find((v) => v.platform === platform));
    const text = draftToPostText(draft, platform);
    if (!text) {
      toast.message("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(draft.hashtags.trim() ? "Copied with hashtags" : "Copied");
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
    // Adapt the approved post rather than rewriting from the angle, so the
    // repurposed version keeps the same argument and proof.
    const source = item.platforms[0];
    const sourceBody = source
      ? (drafts[source]?.body || item.variants.find((v) => v.platform === source)?.body || "")
      : "";

    setRepurposeBusy(platform);
    try {
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
          format: item.format,
          sourcePlatform: sourceBody ? source : undefined,
          sourceBody: sourceBody || undefined,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        body?: string;
        hook?: string;
        format?: ContentFormat;
        hashtags?: string[];
        firstComment?: string;
        segments?: string[];
        altText?: string;
        postTitle?: string;
      };
      if (!res.ok) {
        toast.error(json.error || "Repurpose failed");
        return;
      }
      const platforms = [...item.platforms, platform];
      const variants: ContentVariant[] = [
        ...item.variants,
        {
          platform,
          body: scrubPostBody(json.body || item.angle, platform),
          hook: json.hook ? scrubAiTellPunctuation(json.hook) : undefined,
          format: json.format,
          hashtags: json.hashtags?.length ? json.hashtags : undefined,
          firstComment: json.firstComment || undefined,
          segments: json.segments?.length ? json.segments : undefined,
          altText: json.altText || undefined,
          postTitle: json.postTitle || undefined,
        },
      ];
      await data.updateItem(item.id, { platforms, variants });
      toast.success(`Added ${CONTENT_PLATFORM_LABELS[platform]}`);
    } finally {
      setRepurposeBusy(null);
    }
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
          const variant = item.variants.find((v) => v.platform === platform);
          const draft = drafts[platform] ?? variantToDraft(variant);
          const platformFormat = variant?.format ?? item.format;
          return (
            <PlatformDraftCard
              key={platform}
              platform={platform}
              format={platformFormat}
              draft={draft}
              canEdit={canEdit}
              bannedPhrases={brand?.bannedPhrases ?? []}
              onChange={(patch) =>
                updateEdits((prev) => ({
                  ...prev,
                  drafts: {
                    ...prev.drafts,
                    [platform]: { ...(prev.drafts[platform] ?? draft), ...patch },
                  },
                }))
              }
              onCopy={() => void copy(platform)}
            />
          );
        })}

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void saveBodies()}>
              Save drafts
            </Button>
            <Select
              disabled={repurposeBusy !== null}
              onValueChange={(v) => void repurpose(v as ContentPlatform)}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue
                  placeholder={
                    repurposeBusy
                      ? `Adapting for ${CONTENT_PLATFORM_LABELS[repurposeBusy]}…`
                      : "Adapt for another platform…"
                  }
                />
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
