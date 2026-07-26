"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { ScriptTemplatePicker } from "@/components/ai/script-template-picker";
import type { LeadFollowupAiContext } from "@/components/ai/suggest-followups-dialog";
import { demoFollowupSuggestions } from "@/lib/ai/demo-followup-suggestions";
import { dateInputForSequenceStep, isoFromDateInput } from "@/lib/followup-date";
import { getActiveFollowupPlanForLead } from "@/lib/followup-plans";
import type {
  Followup,
  FollowupChannel,
  FollowupPlan,
  FollowupSequenceMode,
  LeadPriority,
  ScriptLibraryItem,
} from "@/lib/types";

type SuggestApiItem = {
  title: string;
  offsetDays: number;
  priority: LeadPriority;
  channel: FollowupChannel;
  emailSubject?: string;
  messageBody: string;
  description?: string;
  rationale?: string;
};

type RowStatus = "pending" | "running" | "success" | "skipped" | "failed";

type LeadRow = {
  leadId: string;
  label: string;
  status: RowStatus;
  detail?: string;
};

function newFollowupId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `f-local-${crypto.randomUUID()}`
    : `f-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function leadLabel(lead: { contactName?: string; companyName?: string; id: string }): string {
  const name = lead.contactName?.trim();
  const company = lead.companyName?.trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || lead.id;
}

export function BulkBuildSequencesDialog({
  open,
  onOpenChange,
  leadIds,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onComplete?: () => void;
}) {
  const {
    isDemo,
    currentUserId,
    leads,
    followups,
    followupPlans,
    notes,
    createFollowupPlanWithFollowups,
    getContactById,
    getAccountById,
    getCampaignById,
    getProfileById,
    deals,
    timelineByLead,
    touchpoints,
    leadTasks,
    crmLabels,
  } = useWorkspace();

  const [phase, setPhase] = React.useState<"setup" | "running" | "done">("setup");
  const [sequenceMode, setSequenceMode] = React.useState<FollowupSequenceMode>("full");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [scriptId, setScriptId] = React.useState("");
  const [selectedScript, setSelectedScript] = React.useState<ScriptLibraryItem | null>(null);
  const [rows, setRows] = React.useState<LeadRow[]>([]);
  const [progressIndex, setProgressIndex] = React.useState(0);
  const cancelRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    setPhase("setup");
    setSequenceMode("full");
    setUserPrompt("");
    setScriptId("");
    setSelectedScript(null);
    setProgressIndex(0);
    setRows(
      leadIds.map((id) => {
        const lead = leads.find((l) => l.id === id);
        return {
          leadId: id,
          label: lead ? leadLabel(lead) : id,
          status: "pending" as const,
        };
      }),
    );
  }, [open, leadIds, leads]);

  function buildAiContext(leadId: string): LeadFollowupAiContext | null {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return null;
    return {
      lead,
      account: getAccountById(lead.accountId),
      contact: getContactById(lead.contactId),
      deal: deals.find((d) => d.leadId === lead.id),
      notes: notes.filter((n) => n.leadId === lead.id),
      timeline: timelineByLead[lead.id] ?? [],
      touchpoints: touchpoints.filter((t) => t.leadId === lead.id),
      followups: followups.filter((f) => f.leadId === lead.id),
      tasks: leadTasks.filter((t) => t.leadId === lead.id),
      campaign: getCampaignById(lead.campaignId),
      profile: getProfileById(lead.profileId),
      labels: crmLabels.filter((label) => lead.labelIds?.includes(label.id)),
    };
  }

  function patchRow(leadId: string, patch: Partial<LeadRow>) {
    setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, ...patch } : r)));
  }

  async function generateForLead(
    leadId: string,
    mode: FollowupSequenceMode,
    prompt: string,
    tplId: string,
    script: ScriptLibraryItem | null,
  ): Promise<
    | { ok: true; planSummary: string; items: SuggestApiItem[] }
    | { ok: false; error: string }
  > {
    const ctx = buildAiContext(leadId);
    if (!ctx) return { ok: false, error: "Lead not found" };
    const lead = ctx.lead;
    const leadPlans = followupPlans.filter((p) => p.leadId === leadId);

    const demoContext = isDemo
      ? {
          lead: ctx.lead,
          account: ctx.account,
          contact: ctx.contact,
          deal: ctx.deal,
          notes: ctx.notes,
          timeline: ctx.timeline,
          touchpoints: ctx.touchpoints,
          followups: ctx.followups,
          tasks: ctx.tasks,
          campaign: ctx.campaign,
          profile: ctx.profile,
          labels: ctx.labels,
          ...(script
            ? {
                selectedTemplate: {
                  id: script.id,
                  title: script.title,
                  category: script.category,
                  primaryText: script.primaryText,
                  secondaryText: script.secondaryText,
                },
              }
            : {}),
        }
      : undefined;

    try {
      const res = await fetch("/api/ai/followup-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          userPrompt: prompt.trim() || undefined,
          sequenceMode: mode,
          scriptId: tplId || undefined,
          followupPlans: leadPlans.map((p) => ({
            id: p.id,
            status: p.status,
            planSummary: p.planSummary,
            pausedReason: p.pausedReason,
            pausedAt: p.pausedAt,
          })),
          demoContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isDemo) {
          const demo = demoFollowupSuggestions(lead, prompt, mode);
          return {
            ok: true,
            planSummary: demo.planSummary ?? "Personalized sequence",
            items: (demo.items ?? []) as SuggestApiItem[],
          };
        }
        return {
          ok: false,
          error: typeof data.error === "string" ? data.error : "Could not generate suggestions",
        };
      }
      return {
        ok: true,
        planSummary: typeof data.planSummary === "string" ? data.planSummary : "Personalized sequence",
        items: (data.items ?? []) as SuggestApiItem[],
      };
    } catch {
      if (isDemo) {
        const demo = demoFollowupSuggestions(lead, prompt, mode);
        return {
          ok: true,
          planSummary: demo.planSummary ?? "Personalized sequence",
          items: (demo.items ?? []) as SuggestApiItem[],
        };
      }
      return { ok: false, error: "Network error" };
    }
  }

  function activatePlan(
    leadId: string,
    mode: FollowupSequenceMode,
    planSummary: string,
    items: SuggestApiItem[],
    tplId: string,
  ): { ok: true; stepCount: number } | { ok: false; error: string } {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return { ok: false, error: "Lead not found" };
    if (items.length === 0) return { ok: false, error: "AI returned no steps" };

    const includeInitial = mode === "full";
    const planId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `fp-${crypto.randomUUID()}`
        : `fp-${Date.now()}`;
    const ownerId = lead.ownerId ?? currentUserId;
    const plan: FollowupPlan = {
      id: planId,
      leadId: lead.id,
      ownerId,
      status: "active",
      planSummary: planSummary.trim() || "Personalized sequence",
      kind: "sequence",
      sequenceMode: mode,
      createdAt: new Date().toISOString(),
      supersededByPlanId: undefined,
      sourceScriptId: tplId || undefined,
    };
    const created: Followup[] = items.map((it, i) => ({
      id: newFollowupId(),
      leadId: lead.id,
      title: it.title.trim(),
      description: it.description?.trim() || undefined,
      messageBody: it.messageBody.trim(),
      emailSubject: it.emailSubject?.trim() || undefined,
      channel: it.channel,
      planId,
      aiGenerated: true,
      dueAt: isoFromDateInput(dateInputForSequenceStep(i, { includeInitial })),
      ownerId,
      priority: it.priority,
      auto: false,
    }));
    createFollowupPlanWithFollowups(plan, created);
    return { ok: true, stepCount: created.length };
  }

  async function runBatch() {
    cancelRef.current = false;
    const mode = sequenceMode;
    const prompt = userPrompt;
    const tplId = scriptId;
    const script = selectedScript;
    setPhase("running");
    setProgressIndex(0);

    let success = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < leadIds.length; i++) {
      if (cancelRef.current) {
        for (let j = i; j < leadIds.length; j++) {
          patchRow(leadIds[j]!, { status: "skipped", detail: "Cancelled" });
          skipped += 1;
        }
        break;
      }

      const leadId = leadIds[i]!;
      setProgressIndex(i + 1);
      patchRow(leadId, { status: "running", detail: undefined });

      const lead = leads.find((l) => l.id === leadId);
      if (!lead) {
        patchRow(leadId, { status: "skipped", detail: "Lead not found" });
        skipped += 1;
        continue;
      }
      if (lead.doNotContact) {
        patchRow(leadId, { status: "skipped", detail: "Do not contact" });
        skipped += 1;
        continue;
      }
      if (getActiveFollowupPlanForLead(followupPlans, leadId)) {
        patchRow(leadId, { status: "skipped", detail: "Already has an active sequence" });
        skipped += 1;
        continue;
      }

      const generated = await generateForLead(leadId, mode, prompt, tplId, script);
      if (!generated.ok) {
        patchRow(leadId, { status: "failed", detail: generated.error });
        failed += 1;
        continue;
      }

      const activated = activatePlan(leadId, mode, generated.planSummary, generated.items, tplId);
      if (!activated.ok) {
        patchRow(leadId, { status: "failed", detail: activated.error });
        failed += 1;
        continue;
      }

      patchRow(leadId, {
        status: "success",
        detail: `${activated.stepCount} step${activated.stepCount === 1 ? "" : "s"}`,
      });
      success += 1;
    }

    setPhase("done");
    toast.success(
      `Built ${success} sequence${success === 1 ? "" : "s"}`,
      skipped || failed
        ? { description: `${skipped} skipped · ${failed} failed` }
        : undefined,
    );
    if (failed === 0 && skipped === 0 && success > 0) {
      onComplete?.();
    }
  }

  function handleClose(next: boolean) {
    if (phase === "running") return;
    onOpenChange(next);
  }

  const successCount = rows.filter((r) => r.status === "success").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Build sequences
          </DialogTitle>
          <DialogDescription className="text-xs">
            Generate a personalized sequence for each selected prospect. Scheduling is a separate
            step — review samples on Follow-ups first if you want.
          </DialogDescription>
        </DialogHeader>

        {phase === "setup" ? (
          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">
              {leadIds.length} prospect{leadIds.length === 1 ? "" : "s"} selected
            </p>
            <div className="grid gap-2">
              <Label className="text-xs">Sequence type</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setSequenceMode("full")}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors",
                    sequenceMode === "full"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <p className="text-sm font-medium">Full outreach</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    First touch through last email.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setSequenceMode("continue")}
                  className={cn(
                    "rounded-md border px-3 py-2.5 text-left transition-colors",
                    sequenceMode === "continue"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <p className="text-sm font-medium">Continue / follow-ups only</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Remaining touches after an intro.
                  </p>
                </button>
              </div>
            </div>
            <ScriptTemplatePicker
              key={`bulk-tpl-${open ? "1" : "0"}-${sequenceMode}`}
              isDemo={isDemo}
              viewerId={currentUserId}
              sequenceMode={sequenceMode}
              value={scriptId}
              onChange={(id, item) => {
                setScriptId(id);
                setSelectedScript(item);
              }}
            />
            <div className="grid gap-2">
              <Label htmlFor="bulk-build-prompt" className="text-xs">
                Instructions (optional)
              </Label>
              <Textarea
                id="bulk-build-prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder='e.g. "Soft tone, 4 emails over 2 weeks"'
                rows={3}
                className="resize-none text-sm"
                maxLength={500}
              />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={leadIds.length === 0}
                onClick={() => void runBatch()}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Build {leadIds.length} sequence{leadIds.length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {phase === "running" || phase === "done" ? (
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              {phase === "running"
                ? `Building ${progressIndex} / ${leadIds.length}…`
                : `Done · ${successCount} built · ${skippedCount} skipped · ${failedCount} failed`}
            </p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {rows.map((row) => (
                <li
                  key={row.leadId}
                  className="flex items-start gap-2 rounded px-1.5 py-1 text-xs"
                >
                  {row.status === "running" || row.status === "pending" ? (
                    <Loader2
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground",
                        row.status === "running" && "animate-spin text-primary",
                      )}
                    />
                  ) : row.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        row.status === "skipped"
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.label}</p>
                    {row.detail ? (
                      <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <DialogFooter className="gap-2 sm:justify-between">
              {phase === "running" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Stop after current
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              )}
              {phase === "done" ? (
                <p className="text-[11px] text-muted-foreground self-center">
                  Open leads → Follow-ups to review, then use Schedule sequences.
                </p>
              ) : (
                <span />
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
