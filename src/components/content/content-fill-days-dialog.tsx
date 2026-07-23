"use client";

import * as React from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

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
import type {
  ContentBrand,
  ContentItem,
  ContentPlan,
  ContentPlanSlot,
  ContentPlatform,
} from "@/lib/content-calendar/types";
import {
  CONTENT_FORMAT_LABELS,
  CONTENT_PILLAR_LABELS,
  CONTENT_PLATFORM_LABELS,
} from "@/lib/content-calendar/types";

type PlanSuggestResponse = {
  plan: ContentPlan;
};

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

  React.useEffect(() => {
    if (open) {
      setBrandId(initialBrandId ?? brands[0]?.id ?? "");
      setStep("setup");
      setPlan(null);
      setUserPrompt("");
    }
  }, [open, initialBrandId, brands]);

  const brand = brands.find((b) => b.id === brandId);

  async function suggestPlan() {
    if (!brand) {
      toast.error("Select a brand");
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
            .map((i) => i.angle),
        }),
      });
      const data = (await res.json()) as PlanSuggestResponse & { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Plan generation failed");
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
    if (!plan) return;
    setPlan({
      ...plan,
      slots: plan.slots.map((s) => (s.id === slotId ? { ...s, approved } : s)),
    });
  }

  function approveAll(approved: boolean) {
    if (!plan) return;
    setPlan({
      ...plan,
      slots: plan.slots.map((s) => ({ ...s, approved })),
    });
  }

  async function generateDrafts() {
    if (!plan || !brand) return;
    const approved = plan.slots.filter((s) => s.approved);
    if (approved.length === 0) {
      toast.error("Approve at least one slot");
      return;
    }
    setBusy(true);
    setStep("drafting");
    try {
      const updatedSlots: ContentPlanSlot[] = [];
      for (const slot of plan.slots) {
        if (!slot.approved) {
          updatedSlots.push(slot);
          continue;
        }
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
          error?: string;
          hook?: string;
          body?: string;
          citations?: { title: string; excerpt: string }[];
        };
        if (!res.ok) {
          toast.error(data.error || `Draft failed for ${slot.title}`);
          updatedSlots.push(slot);
          continue;
        }

        const item = await createItem({
          brandId: brand.id,
          pillarKey: slot.pillarKey,
          publishAt: slot.publishAt,
          dueAt: slot.publishAt,
          status: brand.approvalRequired ? "review" : "approved",
          title: slot.title,
          angle: slot.angle,
          rationale: slot.rationale,
          format: slot.format,
          platforms: [slot.platform],
          variants: [
            {
              platform: slot.platform,
              body: data.body || slot.angle,
              hook: data.hook,
              format: slot.format,
            },
          ],
          ctaType: slot.ctaType,
          ragCitations: data.citations,
          verifiedFromKnowledge: Boolean(data.citations?.length),
          assigneeUserId: currentUserId,
          ownerUserId: currentUserId,
          planId: plan.id,
        });

        updatedSlots.push({
          ...slot,
          contentItemId: item?.id,
        });
      }

      const nextPlan: ContentPlan = {
        ...plan,
        slots: updatedSlots,
        status: "completed",
        updatedAt: new Date().toISOString(),
      };
      await savePlan(nextPlan, false);
      setPlan(nextPlan);
      toast.success("Drafts added to calendar");
      onOpenChange(false);
    } catch {
      toast.error("Draft generation failed");
    } finally {
      setBusy(false);
      setStep("plan");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate content plan</DialogTitle>
          <DialogDescription>
            Review topics, sources, pillars, and outcomes before drafts are added to the calendar.
            The AI should fill strategic gaps - not empty dates.
          </DialogDescription>
        </DialogHeader>

        {step === "setup" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Brand</Label>
              <Select value={brandId} onValueChange={(v) => setBrandId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select brand" />
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
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Next 7 days</SelectItem>
                  <SelectItem value="10">Next 10 days</SelectItem>
                  <SelectItem value="14">Next 14 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {brand && (
              <div className="flex flex-wrap gap-1">
                {brand.platforms.map((p: ContentPlatform) => (
                  <Badge key={p} variant="secondary">
                    {CONTENT_PLATFORM_LABELS[p]}
                  </Badge>
                ))}
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
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{plan.planSummary}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => approveAll(true)}>
                Approve all
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => approveAll(false)}>
                Clear
              </Button>
            </div>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {plan.slots.map((slot) => (
                <label
                  key={slot.id}
                  className="flex gap-3 rounded-md border p-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={slot.approved}
                    onCheckedChange={(c) => toggleSlot(slot.id, c === true)}
                    disabled={busy}
                  />
                  <div className="min-w-0">
                    <div className="font-medium">{slot.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(slot.publishAt).toLocaleString()} ·{" "}
                      {CONTENT_PLATFORM_LABELS[slot.platform]} ·{" "}
                      {CONTENT_PILLAR_LABELS[slot.pillarKey]}
                      {slot.format
                        ? ` · ${CONTENT_FORMAT_LABELS[slot.format] ?? slot.format}`
                        : ""}
                    </div>
                    <div className="text-xs mt-1">{slot.angle}</div>
                    {slot.rationale ? (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Why: {slot.rationale}
                      </div>
                    ) : null}
                    {slot.proofHint && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Source: {slot.proofHint}
                      </div>
                    )}
                    {slot.targetAudienceHint ? (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Audience: {slot.targetAudienceHint}
                      </div>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "setup" ? (
            <Button type="button" onClick={() => void suggestPlan()} disabled={busy || !brandId}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Generate plan
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStep("setup")}
              >
                Back
              </Button>
              <Button type="button" onClick={() => void generateDrafts()} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Generate drafts
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
