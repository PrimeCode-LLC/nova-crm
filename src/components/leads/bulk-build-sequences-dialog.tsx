"use client";

import * as React from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  MinusCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
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
import { recordFollowupSuggestAccept } from "@/lib/ai/record-followup-suggest-accept-client";
import { dateInputForSequenceStep, isoFromDateInput } from "@/lib/followup-date";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import type {
  Followup,
  FollowupChannel,
  FollowupChannelMix,
  FollowupPlan,
  FollowupSequenceMode,
  LeadPriority,
  ScriptLibraryItem,
} from "@/lib/types";
import { leadHasLinkedIn } from "@/lib/email/bounce-recovery";
import {
  channelMixLabel,
  defaultFollowupChannelMix,
  getActiveFollowupPlanForLead,
} from "@/lib/followup-plans";
import { emitBulkLeadOrgActivity } from "@/lib/leads/record-bulk-lead-org-activity";
import { leadDisplayLabel } from "@/lib/leads/lead-display-label";

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

const CHANNEL_MIX_OPTIONS: {
  value: FollowupChannelMix;
  title: string;
  description: string;
}[] = [
  {
    value: "email",
    title: "Email only",
    description: "All steps on email.",
  },
  {
    value: "linkedin",
    title: "LinkedIn only",
    description: "Copy-ready LinkedIn touches.",
  },
  {
    value: "multi_channel",
    title: "Email + LinkedIn",
    description: "Interleaved LI → email cadence.",
  },
];

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
    organizationSendPolicy,
    deals,
    timelineByLead,
    touchpoints,
    leadTasks,
    crmLabels,
    addOrgActivityEvent,
  } = useWorkspace();
  const timeZone = useOrgTimezone();

  const [phase, setPhase] = React.useState<"setup" | "running" | "done">("setup");
  const [capacityHint, setCapacityHint] = React.useState<string | null>(null);
  const [sequenceMode, setSequenceMode] = React.useState<FollowupSequenceMode>("full");
  const [channelMix, setChannelMix] = React.useState<FollowupChannelMix>("multi_channel");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [scriptId, setScriptId] = React.useState("");
  const [selectedScript, setSelectedScript] = React.useState<ScriptLibraryItem | null>(null);
  const [rows, setRows] = React.useState<LeadRow[]>([]);
  const [progressIndex, setProgressIndex] = React.useState(0);
  const [runTotal, setRunTotal] = React.useState(0);
  const cancelRef = React.useRef(false);
  const wasOpenRef = React.useRef(false);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  // Keep latest workspace data in refs so the batch loop and open-init
  // don't reset UI when leads/plans update mid-run.
  const leadsRef = React.useRef(leads);
  const followupsRef = React.useRef(followups);
  const followupPlansRef = React.useRef(followupPlans);
  const notesRef = React.useRef(notes);
  const dealsRef = React.useRef(deals);
  const timelineByLeadRef = React.useRef(timelineByLead);
  const touchpointsRef = React.useRef(touchpoints);
  const leadTasksRef = React.useRef(leadTasks);
  const crmLabelsRef = React.useRef(crmLabels);
  const getContactByIdRef = React.useRef(getContactById);
  const getAccountByIdRef = React.useRef(getAccountById);
  const getCampaignByIdRef = React.useRef(getCampaignById);
  const getProfileByIdRef = React.useRef(getProfileById);
  const createPlanRef = React.useRef(createFollowupPlanWithFollowups);
  const onCompleteRef = React.useRef(onComplete);
  const leadIdsRef = React.useRef(leadIds);
  leadsRef.current = leads;
  followupsRef.current = followups;
  followupPlansRef.current = followupPlans;
  notesRef.current = notes;
  dealsRef.current = deals;
  timelineByLeadRef.current = timelineByLead;
  touchpointsRef.current = touchpoints;
  leadTasksRef.current = leadTasks;
  crmLabelsRef.current = crmLabels;
  getContactByIdRef.current = getContactById;
  getAccountByIdRef.current = getAccountById;
  getCampaignByIdRef.current = getCampaignById;
  getProfileByIdRef.current = getProfileById;
  createPlanRef.current = createFollowupPlanWithFollowups;
  onCompleteRef.current = onComplete;
  leadIdsRef.current = leadIds;

  // Only reset when the dialog opens (false → true). Do not reset when
  // leads/plans change mid-run — that was bouncing users back to setup
  // while the batch continued in the background.
  React.useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!justOpened) return;

    cancelRef.current = false;
    setPhase("setup");
    setSequenceMode("full");
    const ids = leadIdsRef.current;
    const first = leadsRef.current.find((l) => l.id === ids[0]);
    const hasLi = first
      ? leadHasLinkedIn(first, getContactByIdRef.current(first.contactId))
      : false;
    setChannelMix(
      first
        ? defaultFollowupChannelMix({
            leadChannel: first.channel,
            hasLinkedIn: hasLi,
          })
        : "multi_channel",
    );
    setUserPrompt("");
    setScriptId("");
    setSelectedScript(null);
    setProgressIndex(0);
    setRunTotal(0);
    setCapacityHint(null);
    void (async () => {
      try {
        const res = await fetch("/api/email/org-capacity?horizonDays=14");
        const data = (await res.json()) as {
          ok?: boolean;
          ceiling?: number | null;
          remainingByDay?: Record<string, number>;
          fromDayKey?: string;
        };
        if (!data.ok) return;
        const firstTouches = ids.length;
        const remainingToday =
          data.fromDayKey && data.remainingByDay
            ? data.remainingByDay[data.fromDayKey]
            : undefined;
        const ceiling = data.ceiling ?? organizationSendPolicy.dailyCeiling;
        if (ceiling != null && remainingToday != null && firstTouches > remainingToday) {
          setCapacityHint(
            `${firstTouches} first-touch emails vs ${remainingToday} org slots left today (cap ${ceiling}/day). Extra steps will spill to later working days when you schedule.`,
          );
        } else if (ceiling != null && firstTouches > ceiling) {
          setCapacityHint(
            `${firstTouches} sequences vs org cap ${ceiling}/day. Scheduling will spread overflow across later working days.`,
          );
        }
      } catch {
        /* ignore */
      }
    })();
    setRows(
      ids.map((id) => {
        const lead = leadsRef.current.find((l) => l.id === id);
        return {
          leadId: id,
          label: lead ? leadLabel(lead) : id,
          status: "pending" as const,
        };
      }),
    );
  }, [open]);

  function buildAiContext(leadId: string): LeadFollowupAiContext | null {
    const lead = leadsRef.current.find((l) => l.id === leadId);
    if (!lead) return null;
    return {
      lead,
      account: getAccountByIdRef.current(lead.accountId),
      contact: getContactByIdRef.current(lead.contactId),
      deal: dealsRef.current.find((d) => d.leadId === lead.id),
      notes: notesRef.current.filter((n) => n.leadId === lead.id),
      timeline: timelineByLeadRef.current[lead.id] ?? [],
      touchpoints: touchpointsRef.current.filter((t) => t.leadId === lead.id),
      followups: followupsRef.current.filter((f) => f.leadId === lead.id),
      tasks: leadTasksRef.current.filter((t) => t.leadId === lead.id),
      campaign: getCampaignByIdRef.current(lead.campaignId),
      profile: getProfileByIdRef.current(lead.profileId),
      labels: crmLabelsRef.current.filter((label) => lead.labelIds?.includes(label.id)),
    };
  }

  function patchRow(leadId: string, patch: Partial<LeadRow>) {
    setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, ...patch } : r)));
  }

  React.useEffect(() => {
    if (phase !== "running") return;
    const el = listRef.current?.querySelector('[data-status="running"]');
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [phase, progressIndex]);

  async function generateForLead(
    leadId: string,
    mode: FollowupSequenceMode,
    mix: FollowupChannelMix,
    prompt: string,
    tplId: string,
    script: ScriptLibraryItem | null,
  ): Promise<
    | {
        ok: true;
        planSummary: string;
        items: SuggestApiItem[];
        generationId?: string;
        configId?: string;
      }
    | { ok: false; error: string }
  > {
    const ctx = buildAiContext(leadId);
    if (!ctx) return { ok: false, error: "Lead not found" };
    const lead = ctx.lead;
    const leadPlans = followupPlansRef.current.filter((p) => p.leadId === leadId);

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
          channelMix: mix,
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
          const demo = demoFollowupSuggestions(lead, prompt, mode, mix);
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
        generationId:
          typeof data.generationId === "string" ? data.generationId : undefined,
        configId: typeof data.configId === "string" ? data.configId : undefined,
      };
    } catch {
      if (isDemo) {
        const demo = demoFollowupSuggestions(lead, prompt, mode, mix);
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
    mix: FollowupChannelMix,
    planSummary: string,
    items: SuggestApiItem[],
    tplId: string,
    provenance?: { generationId?: string; configId?: string },
  ): { ok: true; stepCount: number } | { ok: false; error: string } {
    const lead = leadsRef.current.find((l) => l.id === leadId);
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
      channelMix: mix,
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
      dueAt: isoFromDateInput(
        dateInputForSequenceStep(i, { includeInitial, timeZone }),
        timeZone,
      ),
      ownerId,
      priority: it.priority,
      auto: false,
    }));
    createPlanRef.current(plan, created, { skipTimeline: true });
    void recordFollowupSuggestAccept({
      generationId: provenance?.generationId,
      configId: provenance?.configId,
      planId,
      leadId: lead.id,
      steps: created.map((f, i) => ({
        followupId: f.id,
        stepIndex: i,
        channel: f.channel,
        subject: f.emailSubject,
        body: f.messageBody,
      })),
    });
    return { ok: true, stepCount: created.length };
  }

  async function runBatch() {
    cancelRef.current = false;
    const mode = sequenceMode;
    const mix = channelMix;
    const prompt = userPrompt;
    const tplId = scriptId;
    const script = selectedScript;
    const ids = leadIdsRef.current;
    setPhase("running");
    setProgressIndex(0);
    setRunTotal(ids.length);

    let success = 0;
    let skipped = 0;
    let failed = 0;
    const successLeadIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      if (cancelRef.current) {
        for (let j = i; j < ids.length; j++) {
          patchRow(ids[j]!, { status: "skipped", detail: "Cancelled" });
          skipped += 1;
        }
        break;
      }

      const leadId = ids[i]!;
      setProgressIndex(i + 1);
      patchRow(leadId, { status: "running", detail: undefined });

      const lead = leadsRef.current.find((l) => l.id === leadId);
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
      if (getActiveFollowupPlanForLead(followupPlansRef.current, leadId)) {
        patchRow(leadId, { status: "skipped", detail: "Already has an active sequence" });
        skipped += 1;
        continue;
      }

      const generated = await generateForLead(leadId, mode, mix, prompt, tplId, script);
      if (!generated.ok) {
        patchRow(leadId, { status: "failed", detail: generated.error });
        failed += 1;
        continue;
      }

      const activated = activatePlan(
        leadId,
        mode,
        mix,
        generated.planSummary,
        generated.items,
        tplId,
        {
          generationId: "generationId" in generated ? generated.generationId : undefined,
          configId: "configId" in generated ? generated.configId : undefined,
        },
      );
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
      successLeadIds.push(leadId);
    }

    setPhase("done");
    toast.success(
      `Built ${success} sequence${success === 1 ? "" : "s"}`,
      skipped || failed
        ? { description: `${skipped} skipped · ${failed} failed` }
        : undefined,
    );
    if (success > 0 && currentUserId) {
      const onlyId = success === 1 ? successLeadIds[0] : undefined;
      const onlyLead = onlyId
        ? leadsRef.current.find((l) => l.id === onlyId)
        : undefined;
      emitBulkLeadOrgActivity(addOrgActivityEvent, {
        type: "leads_sequences_built",
        actorId: currentUserId,
        count: success,
        leadId: onlyId,
        leadLabel: onlyLead ? leadDisplayLabel(onlyLead) : undefined,
      });
    }
    if (failed === 0 && skipped === 0 && success > 0) {
      onCompleteRef.current?.();
    }
  }

  function handleClose(next: boolean) {
    if (phase === "running") return;
    onOpenChange(next);
  }

  const successCount = rows.filter((r) => r.status === "success").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;
  const progressPct =
    runTotal > 0 ? Math.min(100, Math.round((progressIndex / runTotal) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Build sequences
          </DialogTitle>
          <DialogDescription className="text-xs">
            {phase === "setup"
              ? "Generate a personalized sequence for each selected prospect. Scheduling is a separate step — review samples on Follow-ups first if you want."
              : phase === "running"
                ? "Generating personalized sequences one by one. You can stop after the current prospect."
                : "All selected prospects have been processed."}
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
                    First touch through last step.
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
            <div className="grid gap-2">
              <Label className="text-xs">Channels</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {CHANNEL_MIX_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setChannelMix(opt.value)}
                    className={cn(
                      "rounded-md border px-3 py-2.5 text-left transition-colors",
                      channelMix === opt.value
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <p className="text-sm font-medium">{opt.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {opt.description}
                    </p>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Selected: {channelMixLabel(channelMix)}. LinkedIn steps stay as copy reminders;
                email steps can be scheduled later.
              </p>
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
                placeholder={
                  channelMix === "multi_channel"
                    ? 'e.g. "LinkedIn first, softer email CTA"'
                    : 'e.g. "Soft tone, 4 emails over 2 weeks"'
                }
                rows={3}
                className="resize-none text-sm"
                maxLength={500}
              />
            </div>
            {capacityHint ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
                {capacityHint}
              </p>
            ) : null}
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
            <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <p className="font-medium">
                  {phase === "running" ? (
                    <>
                      Building{" "}
                      <span className="tabular-nums">
                        {progressIndex} / {runTotal}
                      </span>
                    </>
                  ) : (
                    <>
                      Done ·{" "}
                      <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                        {successCount} built
                      </span>
                      {skippedCount > 0 ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {skippedCount} skipped
                        </span>
                      ) : null}
                      {failedCount > 0 ? (
                        <span className="text-destructive"> · {failedCount} failed</span>
                      ) : null}
                    </>
                  )}
                </p>
                {phase === "running" ? (
                  <p className="tabular-nums text-muted-foreground">
                    {successCount} done
                    {failedCount > 0 ? ` · ${failedCount} failed` : ""}
                  </p>
                ) : null}
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={phase === "done" ? 100 : progressPct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300 ease-out",
                    phase === "done" && failedCount === 0
                      ? "bg-emerald-500"
                      : phase === "done" && failedCount > 0
                        ? "bg-amber-500"
                        : "bg-primary",
                  )}
                  style={{ width: `${phase === "done" ? 100 : progressPct}%` }}
                />
              </div>
            </div>

            <ul
              ref={listRef}
              className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2"
            >
              {rows.map((row) => (
                <li
                  key={row.leadId}
                  data-status={row.status}
                  className={cn(
                    "flex items-start gap-2 rounded px-1.5 py-1 text-xs",
                    row.status === "running" && "bg-primary/5",
                    row.status === "pending" && "opacity-60",
                  )}
                >
                  {row.status === "running" ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                  ) : row.status === "pending" ? (
                    <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                  ) : row.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : row.status === "skipped" ? (
                    <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
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
