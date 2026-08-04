"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  Info,
  MapPin,
  Pencil,
  Plus,
  SkipForward,
  Sparkles,
  Trash2,
  Loader2,
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
import { fmtDate, fmtRelative } from "@/lib/format";
import { scrubAiTellPunctuation, scrubPostBody } from "@/lib/content-calendar/schedule";
import {
  contentBodyCharTarget,
  formatUsesSegments,
  getContentPlatformPlaybook,
  segmentCountTarget,
} from "@/lib/content-calendar/platform-playbooks";
import { contentLintSummary, lintContentVariant } from "@/lib/content-calendar/post-lint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useOrgMembers } from "@/hooks/use-org-members";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { toDatetimeLocalValue } from "@/lib/schedule-followup-email-client";
import {
  formatTimezoneDisplayLabel,
  isoFromDatetimeLocalInZone,
} from "@/lib/org-timezone";

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

/** Full local schedule line: "Mon, Jul 27 · 10:00 AM". */
function formatPublishWhen(iso: string): string {
  return fmtDate(iso, "EEE, MMM d · h:mm a");
}

function scheduleTimingLabel(iso: string, overdue: boolean): string {
  const when = formatPublishWhen(iso);
  const relative = fmtRelative(iso);
  if (overdue) return `${when} · overdue (${relative})`;
  return `${when} · ${relative}`;
}

function PlatformDraftCard({
  platform,
  format,
  draft,
  canEdit,
  bannedPhrases,
  publishAt,
  onChange,
  onCopy,
  onCopyFirstComment,
}: {
  platform: ContentPlatform;
  format?: ContentFormat;
  draft: VariantDraft;
  canEdit: boolean;
  bannedPhrases: string[];
  publishAt?: string;
  onChange: (patch: Partial<VariantDraft>) => void;
  onCopy: () => void;
  onCopyFirstComment?: () => void;
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
    <Card id={`platform-draft-${platform}`}>
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
        <div className="flex flex-wrap items-center gap-3">
          {publishAt ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              Schedule {formatPublishWhen(publishAt)}
            </span>
          ) : null}
          <span className={cn("text-xs tabular-nums", lengthTone)}>
            {len} / {target.min}-{target.max} chars
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {publishAt ? (
          <p className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Copy the draft below, then schedule it on {CONTENT_PLATFORM_LABELS[platform]} for{" "}
            <span className="font-medium text-foreground">{formatPublishWhen(publishAt)}</span>
            {draft.firstComment.trim()
              ? ". Put the first comment / link in your own reply right after posting."
              : "."}
          </p>
        ) : null}
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm">First comment</Label>
              {draft.firstComment.trim() && onCopyFirstComment ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={onCopyFirstComment}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy
                </Button>
              ) : null}
            </div>
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
  const timezone = useOrgTimezone();
  const timezoneLabel = formatTimezoneDisplayLabel(timezone);

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
  const [adaptSource, setAdaptSource] = React.useState<ContentPlatform | null>(null);
  const membersQuery = useOrgMembers(!ws.isDemo);
  const members = React.useMemo(() => {
    if (membersQuery.data?.length) {
      return membersQuery.data
        .filter((m) => m.status === "active")
        .map((m) => ({
          uid: m.uid,
          label: m.displayName?.trim() || m.email?.trim() || m.uid,
        }));
    }
    return ws.users.map((u) => ({
      uid: u.id,
      label: u.displayName?.trim() || u.email?.trim() || u.id,
    }));
  }, [membersQuery.data, ws.users]);
  const [scheduleEditing, setScheduleEditing] = React.useState(false);
  const [scheduleDraft, setScheduleDraft] = React.useState("");
  const [scheduleBusy, setScheduleBusy] = React.useState(false);

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
    setScheduleEditing(false);
    setScheduleDraft("");
  }, [itemId]);

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

  function startScheduleEdit() {
    if (!canEdit || !item) return;
    setScheduleDraft(toDatetimeLocalValue(new Date(item.publishAt), timezone));
    setScheduleEditing(true);
  }

  function cancelScheduleEdit() {
    setScheduleEditing(false);
    setScheduleDraft("");
  }

  async function saveSchedule() {
    if (!canEdit || !item || scheduleBusy) return;
    const raw = scheduleDraft.trim();
    if (!raw) {
      toast.error("Pick a date and time");
      return;
    }
    const iso = isoFromDatetimeLocalInZone(raw, timezone);
    const nextAt = new Date(iso);
    if (Number.isNaN(nextAt.getTime())) {
      toast.error("Enter a valid date and time");
      return;
    }
    setScheduleBusy(true);
    try {
      const nextChecklist = checklist.map((step) =>
        step.status === "pending" ? { ...step, dueAt: iso } : step,
      );
      await data.updateItem(item.id, {
        publishAt: iso,
        dueAt: iso,
        checklist: nextChecklist,
      });
      setScheduleEditing(false);
      setScheduleDraft("");
      toast.success("Schedule updated");
    } catch {
      toast.error("Could not update schedule");
    } finally {
      setScheduleBusy(false);
    }
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
    // Prefer an explicit source, else the first platform that already has copy.
    const source =
      (adaptSource && item.platforms.includes(adaptSource) ? adaptSource : null) ||
      item.platforms.find((p) => {
        const body =
          drafts[p]?.body || item.variants.find((v) => v.platform === p)?.body || "";
        return Boolean(body.trim());
      }) ||
      item.platforms[0];
    const sourceBody = source
      ? (drafts[source]?.body || item.variants.find((v) => v.platform === source)?.body || "").trim()
      : "";

    if (!sourceBody) {
      toast.error("Write and save a draft first — adapt rebuilds from that copy");
      return;
    }

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
          sourcePlatform: source,
          sourceBody,
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
        toast.error(json.error || "Could not adapt this draft");
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
      toast.success(
        `Adapted ${CONTENT_PLATFORM_LABELS[source]} → ${CONTENT_PLATFORM_LABELS[platform]}`,
      );
      // Let the new draft card paint, then scroll it into view.
      requestAnimationFrame(() => {
        document
          .getElementById(`platform-draft-${platform}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } finally {
      setRepurposeBusy(null);
    }
  }

  async function copyFirstComment(platform: ContentPlatform) {
    if (!item) return;
    const draft =
      drafts[platform] ?? variantToDraft(item.variants.find((v) => v.platform === platform));
    const text = draft.firstComment.trim();
    if (!text) {
      toast.message("No first comment yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("First comment copied");
    } catch {
      toast.error("Could not copy");
    }
  }

  const overdue = isContentItemOverdue(item);
  const publishWhen = formatPublishWhen(item.publishAt);
  const publishTiming = scheduleTimingLabel(item.publishAt, overdue);
  const needsGraphics =
    formatNeedsGraphics(item.format) ||
    Boolean(designDraft.trim()) ||
    (item.assetLinks?.length ?? 0) > 0;
  const nextPendingStep = checklist.find((s) => s.status === "pending");
  const publishStepPending = nextPendingStep?.key === "publish";
  const posterFocused =
    item.status === "scheduled" ||
    item.status === "approved" ||
    publishStepPending ||
    (item.status !== "published" &&
      checklist.length > 0 &&
      checklist.every((s) => s.key === "publish" || s.status !== "pending"));
  const yourTurn =
    Boolean(nextPendingStep) && nextPendingStep?.assigneeUserId === data.currentUserId;
  const draftsDirty = item.platforms.some((platform) => {
    if (!(platform in drafts)) return false;
    const saved = variantToDraft(item.variants.find((v) => v.platform === platform));
    const draft = drafts[platform]!;
    return (
      draft.body !== saved.body ||
      draft.hashtags !== saved.hashtags ||
      draft.firstComment !== saved.firstComment ||
      draft.altText !== saved.altText ||
      draft.postTitle !== saved.postTitle ||
      draft.segments.join("\u0001") !== saved.segments.join("\u0001")
    );
  });
  const markPublishedPrimary =
    item.status === "scheduled" || item.status === "approved" || publishStepPending;
  const availableAdaptTargets = (
    Object.keys(CONTENT_PLATFORM_LABELS) as ContentPlatform[]
  ).filter((p) => !item.platforms.includes(p));
  const adaptSourcePlatform =
    (adaptSource && item.platforms.includes(adaptSource) ? adaptSource : null) ||
    item.platforms.find((p) => {
      const body =
        drafts[p]?.body || item.variants.find((v) => v.platform === p)?.body || "";
      return Boolean(body.trim());
    }) ||
    item.platforms[0];
  const adaptSourceReady = Boolean(
    adaptSourcePlatform &&
      (
        drafts[adaptSourcePlatform]?.body ||
        item.variants.find((v) => v.platform === adaptSourcePlatform)?.body ||
        ""
      ).trim(),
  );

  const scheduleCard = (
    <Card className={cn(overdue && "border-destructive/50")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
          When to schedule
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-muted/20 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                When
              </div>
              {canEdit && !scheduleEditing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={startScheduleEdit}
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </Button>
              ) : null}
            </div>
            {scheduleEditing ? (
              <div className="space-y-2">
                <Input
                  id="content-schedule-at"
                  type="datetime-local"
                  value={scheduleDraft}
                  onChange={(e) => setScheduleDraft(e.target.value)}
                  disabled={scheduleBusy}
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">{timezoneLabel}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={scheduleBusy || !scheduleDraft.trim()}
                    onClick={() => void saveSchedule()}
                  >
                    {scheduleBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={scheduleBusy}
                    onClick={cancelScheduleEdit}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className={cn("text-sm font-medium", overdue && "text-destructive")}>
                  {publishWhen}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {overdue
                    ? `Overdue · ${fmtRelative(item.publishAt)}`
                    : fmtRelative(item.publishAt)}
                </p>
              </>
            )}
          </div>
          <div className="rounded-md border bg-muted/20 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              Where
            </div>
            <p className="text-sm font-medium">
              {item.platforms.map((p) => CONTENT_PLATFORM_LABELS[p]).join(" · ")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {item.format ? CONTENT_FORMAT_LABELS[item.format] : "Format not set"}
              {brand?.name ? ` · ${brand.name}` : ""}
            </p>
          </div>
          <div className="rounded-md border bg-muted/20 px-3 py-2.5">
            <div className="mb-1 text-xs font-medium text-muted-foreground">What</div>
            <p className="line-clamp-2 text-sm font-medium">{item.title}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.angle}</p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Posting steps</p>
          <ul className="space-y-1.5">
            {item.platforms.map((platform) => {
              const draft =
                drafts[platform] ??
                variantToDraft(item.variants.find((v) => v.platform === platform));
              const ready = Boolean(draft.body.trim());
              return (
                <li
                  key={platform}
                  className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <Badge variant="outline" className="font-normal">
                    {CONTENT_PLATFORM_LABELS[platform]}
                  </Badge>
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {ready
                      ? `Copy draft → schedule for ${publishWhen}`
                      : "Draft still empty — finish Review copy first"}
                    {draft.firstComment.trim()
                      ? " · then paste first comment as your reply"
                      : ""}
                  </span>
                  {canEdit && ready ? (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void copy(platform)}
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy post
                      </Button>
                      {draft.firstComment.trim() ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void copyFirstComment(platform)}
                        >
                          <Copy className="h-3.5 w-3.5" /> Comment
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        {publishStepPending && item.status !== "published" ? (
          <p className="text-xs text-muted-foreground">
            After you schedule or publish on the platform
            {item.platforms.length > 1 ? "s" : ""}, mark the Publish checklist step done (or use Mark
            published above).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );

  const checklistCard = (
    <Card>
      <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Checklist</CardTitle>
        {nextPendingStep ? (
          <Badge variant={yourTurn ? "default" : "secondary"} className="font-normal">
            {yourTurn ? "Your turn · " : "Next · "}
            {CONTENT_CHECKLIST_STEP_LABELS[nextPendingStep.key]}
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal">
            All steps done
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {checklist.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checklist steps yet.</p>
        ) : (
          checklist.map((step) => {
            const isNext = nextPendingStep?.key === step.key;
            const isYours = isNext && step.assigneeUserId === data.currentUserId;
            return (
              <div
                key={step.key}
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
                  isNext && "border-primary/40 bg-primary/5",
                  step.status === "done" && "opacity-70",
                )}
              >
                {step.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : step.status === "skipped" ? (
                  <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Circle
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isNext ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "font-medium",
                    step.status === "done" && "line-through text-muted-foreground",
                  )}
                >
                  {CONTENT_CHECKLIST_STEP_LABELS[step.key]}
                </span>
                {isYours ? (
                  <Badge variant="default" className="h-5 px-1.5 text-[10px] font-normal">
                    You
                  </Badge>
                ) : null}
                <span className="text-xs capitalize text-muted-foreground">{step.status}</span>
                {step.key === "publish" ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-xs",
                      overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    {publishTiming}
                  </span>
                ) : step.dueAt ? (
                  <span className="text-xs text-muted-foreground">
                    Due {fmtDate(step.dueAt, "MMM d")}
                  </span>
                ) : null}
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
                      variant={isNext ? "default" : "outline"}
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
            );
          })
        )}
      </CardContent>
    </Card>
  );

  return (
    <AppPage>
      <PageHeader
        title={item.title}
        description={`${brand?.name ?? "Brand"} · ${publishWhen} · ${CONTENT_PILLAR_LABELS[item.pillarKey]}`}
        actions={
          <>
            <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              Calendar
            </Link>
            {canEdit && item.status !== "published" && (
              <>
                <Button
                  size="sm"
                  type="button"
                  variant={markPublishedPrimary ? "default" : "outline"}
                  onClick={() => void setStatus("published")}
                >
                  <Check className="h-3.5 w-3.5" /> Mark published
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => void setStatus("skipped")}
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </Button>
              </>
            )}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <Select
              value={item.status}
              onValueChange={(v) => void setStatus(v as ContentItemStatus)}
            >
              <SelectTrigger className="h-8 w-[150px]" aria-label="Content status">
                <SelectValue>{CONTENT_STATUS_LABELS[item.status]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CONTENT_STATUS_LABELS) as ContentItemStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {CONTENT_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant={overdue ? "destructive" : "secondary"}>
              {CONTENT_STATUS_LABELS[item.status]}
            </Badge>
          )}
          {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
          {item.format ? (
            <Badge variant="outline">{CONTENT_FORMAT_LABELS[item.format]}</Badge>
          ) : null}
          {item.platforms.map((p) => (
            <Badge key={p} variant="outline">
              {CONTENT_PLATFORM_LABELS[p]}
            </Badge>
          ))}
        </div>

        {posterFocused ? (
          <>
            {scheduleCard}
            {checklistCard}
          </>
        ) : (
          <>
            {checklistCard}
          </>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Angle</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>{item.angle}</p>
            {item.rationale ? (
              <p className="mt-2 text-xs text-muted-foreground">{item.rationale}</p>
            ) : null}
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
              publishAt={item.publishAt}
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
              onCopyFirstComment={() => void copyFirstComment(platform)}
            />
          );
        })}

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2.5 backdrop-blur supports-backdrop-filter:bg-background/80">
            <Button
              type="button"
              disabled={!draftsDirty}
              onClick={() => void saveBodies()}
            >
              Save drafts
            </Button>
            {draftsDirty ? (
              <span className="text-xs text-amber-500">Unsaved changes</span>
            ) : (
              <span className="text-xs text-muted-foreground">All drafts saved</span>
            )}
          </div>
        )}

        {canEdit && availableAdaptTargets.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                Adapt for another platform
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                AI rebuilds this idea natively for a new channel — same claim and proof, different
                hook, length, and structure. It is not a line-by-line rewrite.
              </p>
              {item.platforms.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Select
                    value={adaptSourcePlatform}
                    disabled={repurposeBusy !== null}
                    onValueChange={(v) => {
                      if (v) setAdaptSource(v as ContentPlatform);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue>
                        {adaptSourcePlatform
                          ? CONTENT_PLATFORM_LABELS[adaptSourcePlatform]
                          : "Pick source"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {item.platforms.map((p) => (
                        <SelectItem key={p} value={p}>
                          {CONTENT_PLATFORM_LABELS[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : adaptSourcePlatform ? (
                <p className="text-xs text-muted-foreground">
                  Source: {CONTENT_PLATFORM_LABELS[adaptSourcePlatform]} draft
                  {!adaptSourceReady ? " (review copy first)" : ""}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {availableAdaptTargets.map((p) => (
                  <Button
                    key={p}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={repurposeBusy !== null || !adaptSourceReady}
                    onClick={() => void repurpose(p)}
                  >
                    {repurposeBusy === p ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {repurposeBusy === p
                      ? `Adapting for ${CONTENT_PLATFORM_LABELS[p]}…`
                      : CONTENT_PLATFORM_LABELS[p]}
                  </Button>
                ))}
              </div>
              {!adaptSourceReady ? (
                <p className="text-xs text-amber-500">
                  Add draft copy on the source platform before adapting.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {!posterFocused ? scheduleCard : null}

        {needsGraphics ? (
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
                          disabled={
                            designDraft.trim() === (item.designInstructions ?? "").trim()
                          }
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
        ) : null}

        {item.ragCitations && item.ragCitations.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {item.ragCitations.map((c, i) => (
                <div key={i} className="rounded-md border px-3 py-2">
                  <div className="font-medium">{c.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{c.excerpt}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {canEdit ? (
          <div className="flex justify-end border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                if (
                  !window.confirm(
                    "Delete this content item? This cannot be undone.",
                  )
                ) {
                  return;
                }
                void data.deleteItem(item.id).then(() => router.push("/content"));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete item
            </Button>
          </div>
        ) : null}
      </PageBody>
    </AppPage>
  );
}
