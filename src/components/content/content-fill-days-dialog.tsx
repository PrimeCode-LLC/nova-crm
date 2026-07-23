"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ContentBrand,
  ContentItem,
  ContentPlan,
  ContentPlanSlot,
  ContentPlatform,
} from "@/lib/content-calendar/types";
import {
  CONTENT_CTA_LABELS,
  CONTENT_FORMAT_LABELS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PLATFORM_LABELS,
  buildContentChecklist,
  firstPendingChecklistAssignee,
  resolveBrandResponsibility,
} from "@/lib/content-calendar/types";

type PlanSuggestResponse = {
  plan: ContentPlan;
};

function formatSlotWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ContentFillDaysDialog({
  open,
  onOpenChange,
  brands,
  initialBrandId,
  items,
  currentUserId,
  createItem,
  savePlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brands: ContentBrand[];
  initialBrandId?: string;
  items: ContentItem[];
  currentUserId: string;
  createItem: (
    item: Omit<ContentItem, "id" | "organizationId" | "createdAt" | "updatedAt">,
  ) => Promise<ContentItem | null>;
  savePlan: (plan: ContentPlan, isNew: boolean) => Promise<void>;
}) {
  const [brandId, setBrandId] = React.useState(initialBrandId ?? "");
  const [dayCount, setDayCount] = React.useState<"7" | "10" | "14">("7");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [step, setStep] = React.useState<"setup" | "plan" | "drafting">("setup");
  const [busy, setBusy] = React.useState(false);
  const [plan, setPlan] = React.useState<ContentPlan | null>(null);
  const [draftProgress, setDraftProgress] = React.useState<{
    current: number;
    total: number;
    slotId: string;
    title: string;
  } | null>(null);

  // Reset only on closed→open. Parent re-renders after savePlan with a new brands
  // array reference; depending on brands here used to wipe the review step.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      setBrandId(initialBrandId ?? brands[0]?.id ?? "");
      setStep("setup");
      setPlan(null);
      setUserPrompt("");
      setBusy(false);
      setDraftProgress(null);
    }
    wasOpen.current = open;
  }, [open, initialBrandId, brands]);

  const brand = brands.find((b) => b.id === brandId);
  const approvedCount = plan?.slots.filter((s) => s.approved).length ?? 0;
  const draftedCount = plan?.slots.filter((s) => s.contentItemId).length ?? 0;
  const pendingDraftCount =
    plan?.slots.filter((s) => s.approved && !s.contentItemId).length ?? 0;

  function toastApiError(error: unknown, fallback: string) {
    if (typeof error === "string" && error.trim()) {
      toast.error(error);
      return;
    }
    toast.error(fallback);
  }

  function handleOpenChange(next: boolean) {
    if (busy && !next) return;
    onOpenChange(next);
  }

  async function suggestPlan() {
    if (!brand) {
      toast.error("Select a brand");
      return;
    }
    if (brand.platforms.length === 0) {
      toast.error("This brand has no platforms. Add at least one in brand settings.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/content-plan-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          brandId: brand.id,
          dayCount: Number(dayCount),
          platforms: brand.platforms,
          userPrompt: userPrompt.trim() || undefined,
          recentAngles: items
            .filter((i) => i.brandId === brand.id)
            .slice(0, 20)
            .map((i) => i.angle.slice(0, 300)),
        }),
      });
      const data = (await res.json()) as PlanSuggestResponse & { error?: unknown };
      if (!res.ok) {
        toastApiError(data.error, "Plan generation failed");
        return;
      }
      setPlan(data.plan);
      setStep("plan");
      await savePlan(data.plan, true);
    } catch {
      toast.error("Plan generation failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleSlot(slotId: string, approved: boolean) {
    if (!plan || busy) return;
    setPlan({
      ...plan,
      slots: plan.slots.map((s) => (s.id === slotId ? { ...s, approved } : s)),
    });
  }

  function approveAll(approved: boolean) {
    if (!plan || busy) return;
    setPlan({
      ...plan,
      slots: plan.slots.map((s) =>
        s.contentItemId ? s : { ...s, approved },
      ),
    });
  }

  async function generateDrafts() {
    if (!plan || !brand) return;
    const approved = plan.slots.filter((s) => s.approved && !s.contentItemId);
    if (approved.length === 0) {
      if (draftedCount > 0) {
        toast.success("All selected slots already have drafts");
        onOpenChange(false);
        return;
      }
      toast.error("Select at least one topic to draft");
      return;
    }
    setBusy(true);
    setStep("drafting");
    let createdCount = 0;
    let failedCount = 0;
    try {
      const updatedSlots: ContentPlanSlot[] = [];
      let draftIndex = 0;
      for (const slot of plan.slots) {
        if (!slot.approved) {
          updatedSlots.push(slot);
          continue;
        }
        if (slot.contentItemId) {
          updatedSlots.push(slot);
          createdCount += 1;
          continue;
        }

        draftIndex += 1;
        setDraftProgress({
          current: draftIndex,
          total: approved.length,
          slotId: slot.id,
          title: slot.title,
        });

        const format = slot.format ?? "text_post";
        const res = await fetch("/api/ai/content-draft-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            brandId: brand.id,
            platform: slot.platform,
            pillarKey: slot.pillarKey,
            title: slot.title,
            angle: slot.angle,
            proofHint: slot.proofHint,
            ctaType: slot.ctaType,
          }),
        });
        const data = (await res.json()) as {
          error?: unknown;
          hook?: string;
          body?: string;
          citations?: { title: string; excerpt: string }[];
        };
        if (!res.ok) {
          failedCount += 1;
          toastApiError(data.error, `Draft failed for ${slot.title}`);
          updatedSlots.push(slot);
          continue;
        }

        const checklist = buildContentChecklist({
          brand,
          format,
          dueAt: slot.publishAt,
          fallbackUserId: currentUserId,
        });
        const ownerUserId =
          resolveBrandResponsibility(brand, "planner") || brand.ownerUserId || currentUserId;
        const assigneeUserId = firstPendingChecklistAssignee(checklist, currentUserId);

        const item = await createItem({
          brandId: brand.id,
          pillarKey: slot.pillarKey,
          publishAt: slot.publishAt,
          dueAt: slot.publishAt,
          status: brand.approvalRequired ? "review" : "draft",
          title: slot.title,
          angle: slot.angle,
          rationale: slot.rationale,
          format,
          platforms: [slot.platform],
          variants: [
            {
              platform: slot.platform,
              body: data.body || slot.angle,
              hook: data.hook,
              format,
            },
          ],
          ctaType: slot.ctaType,
          ragCitations: data.citations,
          verifiedFromKnowledge: Boolean(data.citations?.length),
          checklist,
          assigneeUserId,
          ownerUserId,
          planId: plan.id,
        });

        if (item?.id) createdCount += 1;
        else failedCount += 1;

        updatedSlots.push({
          ...slot,
          format,
          contentItemId: item?.id,
        });
      }

      const nextPlan: ContentPlan = {
        ...plan,
        slots: updatedSlots,
        status: createdCount > 0 && failedCount === 0 ? "completed" : plan.status,
        updatedAt: new Date().toISOString(),
      };
      await savePlan(nextPlan, false);
      setPlan(nextPlan);

      if (createdCount === 0) {
        toast.error("No drafts were created. Fix errors and try again.");
        return;
      }
      if (failedCount > 0) {
        toast.message(`${createdCount} draft(s) added; ${failedCount} failed. Retry the rest.`);
        return;
      }
      toast.success(`${createdCount} draft${createdCount === 1 ? "" : "s"} added to calendar`);
      onOpenChange(false);
    } catch {
      toast.error("Draft generation failed");
    } finally {
      setBusy(false);
      setDraftProgress(null);
      setStep("plan");
    }
  }

  const header =
    step === "setup"
      ? {
          title: "Generate content plan",
          description:
            "Pick a brand and window. Posts land on preferred weekdays, with multiple platforms per day when cadence calls for it.",
        }
      : step === "drafting"
        ? {
            title: "Writing drafts",
            description: draftProgress
              ? `Draft ${draftProgress.current} of ${draftProgress.total}: ${draftProgress.title}`
              : "Turning approved topics into calendar-ready posts…",
          }
        : {
            title: "Review plan",
            description:
              "Uncheck anything you don’t want. Then generate drafts for the selected topics.",
          };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4">
          <DialogTitle>{header.title}</DialogTitle>
          <DialogDescription>{header.description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === "setup" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Brand</Label>
                <Select value={brandId} onValueChange={(v) => setBrandId(v ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select brand">
                      {brand ? `${brand.name} (${brand.kind})` : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.kind})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Days</Label>
                <Select
                  value={dayCount}
                  onValueChange={(v) => {
                    if (v === "7" || v === "10" || v === "14") setDayCount(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {dayCount === "7"
                        ? "Next 7 days"
                        : dayCount === "10"
                          ? "Next 10 days"
                          : "Next 14 days"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Next 7 days</SelectItem>
                    <SelectItem value="10">Next 10 days</SelectItem>
                    <SelectItem value="14">Next 14 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {brand && (
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">Platforms</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {brand.platforms.map((p: ContentPlatform) => (
                      <Badge key={p} variant="secondary">
                        {CONTENT_PLATFORM_LABELS[p]}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Prefers{" "}
                    {(brand.cadence.preferredWeekdays?.length
                      ? brand.cadence.preferredWeekdays
                      : [1, 2, 3, 4, 5]
                    )
                      .map(
                        (d) =>
                          ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] ?? String(d),
                      )
                      .join(", ")}
                    . Weekend days are skipped unless enabled on the brand.
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>Optional notes</Label>
                <Textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="Themes, launches, or angles to emphasize…"
                  rows={3}
                />
              </div>
            </div>
          )}

          {(step === "plan" || step === "drafting") && plan && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="text-sm leading-relaxed">{plan.planSummary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  <span>
                    {plan.slots.length} topic{plan.slots.length === 1 ? "" : "s"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {plan.startDate} → {plan.endDate}
                  </span>
                  {brand ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{brand.name}</span>
                    </>
                  ) : null}
                </div>
              </div>

              {step === "drafting" && draftProgress ? (
                <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Writing drafts
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {draftProgress.current}/{draftProgress.total}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{
                        width: `${Math.round(
                          (draftProgress.current / Math.max(draftProgress.total, 1)) * 100,
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{draftProgress.title}</p>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{approvedCount}</span> of{" "}
                    {plan.slots.length} selected
                    {draftedCount > 0 ? (
                      <span className="ml-1">
                        · {draftedCount} already drafted
                      </span>
                    ) : null}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => approveAll(true)}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => approveAll(false)}
                    >
                      Deselect all
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {plan.slots.map((slot) => {
                  const done = Boolean(slot.contentItemId);
                  const active =
                    step === "drafting" &&
                    draftProgress?.slotId === slot.id &&
                    !done &&
                    slot.approved;

                  return (
                    <label
                      key={slot.id}
                      className={cn(
                        "flex gap-3 rounded-lg border p-3 text-sm transition-colors",
                        busy ? "cursor-default" : "cursor-pointer",
                        slot.approved
                          ? "border-border bg-card"
                          : "border-transparent bg-muted/20 opacity-60",
                        active && "border-primary/40 ring-1 ring-primary/20",
                        done && "border-emerald-500/30 bg-emerald-500/5 opacity-100",
                      )}
                    >
                      <div className="pt-0.5">
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-label="Drafted" />
                        ) : (
                          <Checkbox
                            checked={slot.approved}
                            onCheckedChange={(c) => toggleSlot(slot.id, c === true)}
                            disabled={busy}
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="font-medium leading-snug">{slot.title}</div>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="font-normal">
                            {formatSlotWhen(slot.publishAt)}
                          </Badge>
                          <Badge variant="secondary" className="font-normal">
                            {CONTENT_PLATFORM_LABELS[slot.platform]}
                          </Badge>
                          <Badge variant="secondary" className="font-normal">
                            {CONTENT_PILLAR_LABELS[slot.pillarKey] ?? slot.pillarKey}
                          </Badge>
                          {slot.format ? (
                            <Badge variant="outline" className="font-normal">
                              {CONTENT_FORMAT_LABELS[slot.format] ?? slot.format}
                            </Badge>
                          ) : null}
                          {slot.ctaType && slot.ctaType !== "none" ? (
                            <Badge variant="outline" className="font-normal">
                              {CONTENT_CTA_LABELS[slot.ctaType] ?? slot.ctaType}
                            </Badge>
                          ) : null}
                          {done ? (
                            <Badge className="font-normal">Drafted</Badge>
                          ) : null}
                        </div>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {slot.angle}
                        </p>
                        {(slot.rationale || slot.proofHint || slot.targetAudienceHint) && (
                          <dl className="grid gap-1 text-[11px] text-muted-foreground/90">
                            {slot.rationale ? (
                              <div>
                                <dt className="inline font-medium text-muted-foreground">
                                  Why:{" "}
                                </dt>
                                <dd className="inline">{slot.rationale}</dd>
                              </div>
                            ) : null}
                            {slot.proofHint ? (
                              <div>
                                <dt className="inline font-medium text-muted-foreground">
                                  Source:{" "}
                                </dt>
                                <dd className="inline">{slot.proofHint}</dd>
                              </div>
                            ) : null}
                            {slot.targetAudienceHint ? (
                              <div>
                                <dt className="inline font-medium text-muted-foreground">
                                  Audience:{" "}
                                </dt>
                                <dd className="inline">{slot.targetAudienceHint}</dd>
                              </div>
                            ) : null}
                          </dl>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4 sm:justify-between">
          {step === "setup" ? (
            <>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Usually takes 10–20 seconds
              </p>
              <Button type="button" onClick={() => void suggestPlan()} disabled={busy || !brandId}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {busy ? "Generating plan…" : "Generate plan"}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setStep("setup");
                  setDraftProgress(null);
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void generateDrafts()}
                disabled={busy || (pendingDraftCount === 0 && draftedCount === 0)}
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {step === "drafting"
                  ? "Writing drafts…"
                  : pendingDraftCount > 0
                    ? `Generate ${pendingDraftCount} draft${pendingDraftCount === 1 ? "" : "s"}`
                    : draftedCount > 0
                      ? "Done — close"
                      : "Generate drafts"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
