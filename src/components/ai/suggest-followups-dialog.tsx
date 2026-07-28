"use client";

import * as React from "react";
import { Sparkles, Loader2, Copy, Check } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Account,
  Campaign,
  ChannelKey,
  Contact,
  CrmLabel,
  Deal,
  Followup,
  FollowupPlan,
  FollowupChannel,
  FollowupChannelMix,
  FollowupSequenceMode,
  Lead,
  LeadPriority,
  LeadTask,
  Note,
  Profile,
  ScriptLibraryItem,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import type {
  BuyerPersona,
  ProspectingStrategy,
  StrategyAssignment,
} from "@/lib/prospecting-strategy/types";
import { PRIORITY_TONE } from "@/lib/constants";
import { useChannelOptions } from "@/hooks/use-channel-options";
import { channelLabelFromValue } from "@/lib/channel-options";
import { dateInputForSequenceStep, isoFromDateInput } from "@/lib/followup-date";
import { demoFollowupSuggestions } from "@/lib/ai/demo-followup-suggestions";
import { leadHasLinkedIn } from "@/lib/email/bounce-recovery";
import {
  channelMixLabel,
  defaultFollowupChannelMix,
  canAutoScheduleFollowupEmail,
} from "@/lib/followup-plans";
import { cn } from "@/lib/utils";
import type { LeadAiContextInput } from "@/lib/ai/load-lead-ai-context-server";
import { toast } from "sonner";
import { ScriptTemplatePicker } from "@/components/ai/script-template-picker";

export type LeadFollowupAiContext = {
  lead: Lead;
  account?: Account;
  contact?: Contact;
  deal?: Deal;
  notes: Note[];
  timeline: TimelineEvent[];
  touchpoints: Touchpoint[];
  followups: Followup[];
  tasks: LeadTask[];
  emailThreads?: { subject: string; messages: { from: string; date: string; snippet: string }[] }[];
  campaign?: Campaign;
  profile?: Profile;
  strategy?: ProspectingStrategy;
  persona?: BuyerPersona;
  strategyAssignment?: StrategyAssignment;
  caseStudy?: ScriptLibraryItem;
  labels?: CrmLabel[];
};

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

type EditableItem = SuggestApiItem & {
  key: string;
  included: boolean;
  dueDate: string;
};

function newFollowupId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `f-local-${crypto.randomUUID()}`
    : `f-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function channelLabel(ch: FollowupChannel, options: { key: string; label: string }[]): string {
  if (ch === "other") return "Lead channel";
  return channelLabelFromValue(ch, options) || ch;
}

function showsEmailSubject(ch: FollowupChannel): boolean {
  return (
    ch === "cold_email" ||
    ch === "personalized_email" ||
    ch === "website_form" ||
    ch === "other"
  );
}

const CHANNEL_MIX_OPTIONS: {
  value: FollowupChannelMix;
  title: string;
  description: string;
}[] = [
  {
    value: "email",
    title: "Email only",
    description: "All steps on email — ready to schedule and send.",
  },
  {
    value: "linkedin",
    title: "LinkedIn only",
    description: "Copy-ready LinkedIn notes and connection touches.",
  },
  {
    value: "multi_channel",
    title: "Email + LinkedIn",
    description: "One interleaved strategy: LI → email → LI → email.",
  },
];

export function SuggestFollowupsDialog({
  open,
  onOpenChange,
  lead,
  aiContext,
  isDemo,
  currentUserId,
  onCreatePlanWithFollowups,
  regenerateFromPlan,
  followupPlans = [],
  initialSequenceMode = "full",
  /** Prefill channel (e.g. linkedin_outbound after email exhausted). */
  initialChannel,
  /** Prefill user prompt when opening for a specific recovery path. */
  initialUserPrompt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  aiContext: LeadFollowupAiContext;
  isDemo: boolean;
  currentUserId: string;
  onCreatePlanWithFollowups: (plan: FollowupPlan, followups: Followup[]) => void;
  /** When set, accept supersedes this paused plan and pre-fills regenerate context. */
  regenerateFromPlan?: FollowupPlan;
  followupPlans?: FollowupPlan[];
  initialSequenceMode?: FollowupSequenceMode;
  initialChannel?: ChannelKey;
  initialUserPrompt?: string;
}) {
  const channelOptions = useChannelOptions();
  const hasLinkedIn = leadHasLinkedIn(lead, aiContext.contact);
  const [phase, setPhase] = React.useState<"prompt" | "review">("prompt");
  const [sequenceMode, setSequenceMode] =
    React.useState<FollowupSequenceMode>(initialSequenceMode);
  const [channelMix, setChannelMix] = React.useState<FollowupChannelMix>("email");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [planSummary, setPlanSummary] = React.useState("");
  const [items, setItems] = React.useState<EditableItem[]>([]);
  const [leadChannel, setLeadChannel] = React.useState<ChannelKey>(lead.channel);
  const [scriptId, setScriptId] = React.useState("");
  const [selectedScript, setSelectedScript] = React.useState<ScriptLibraryItem | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setPhase("prompt");
    setSequenceMode(
      regenerateFromPlan?.sequenceMode ??
        (regenerateFromPlan ? "continue" : initialSequenceMode),
    );
    setChannelMix(
      regenerateFromPlan?.channelMix ??
        defaultFollowupChannelMix({
          leadChannel: lead.channel,
          hasLinkedIn,
          initialChannel,
        }),
    );
    setUserPrompt(
      initialUserPrompt?.trim()
        ? initialUserPrompt.trim()
        : regenerateFromPlan
          ? `Regenerate after lead reply. Prior plan: ${regenerateFromPlan.planSummary}. ${regenerateFromPlan.pausedReason ?? ""}`.trim()
          : "",
    );
    setError(null);
    setPlanSummary("");
    setItems([]);
    setLeadChannel(initialChannel ?? lead.channel);
    setScriptId(regenerateFromPlan?.sourceScriptId ?? "");
    setSelectedScript(null);
  }, [
    open,
    lead.id,
    lead.channel,
    regenerateFromPlan,
    initialSequenceMode,
    initialChannel,
    initialUserPrompt,
    hasLinkedIn,
  ]);

  function demoContextPayload(): LeadAiContextInput | undefined {
    if (!isDemo) return undefined;
    return {
      lead: aiContext.lead,
      account: aiContext.account,
      contact: aiContext.contact,
      deal: aiContext.deal,
      notes: aiContext.notes,
      timeline: aiContext.timeline,
      touchpoints: aiContext.touchpoints,
      followups: aiContext.followups,
      tasks: aiContext.tasks,
      emailThreads: aiContext.emailThreads,
      campaign: aiContext.campaign,
      profile: aiContext.profile,
      strategy: aiContext.strategy,
      persona: aiContext.persona,
      strategyAssignment: aiContext.strategyAssignment,
      caseStudy: aiContext.caseStudy,
      labels: aiContext.labels,
    };
  }

  function applyApiResult(
    data: {
      planSummary?: string;
      leadChannel?: ChannelKey;
      items?: SuggestApiItem[];
    },
    mode: FollowupSequenceMode = sequenceMode,
  ) {
    setPlanSummary(data.planSummary ?? "");
    setLeadChannel(data.leadChannel ?? lead.channel);
    const apiItems = (data.items ?? []) as SuggestApiItem[];
    const includeInitial = mode === "full";
    setItems(
      apiItems.map((it, i) => ({
        ...it,
        emailSubject: it.emailSubject ?? "",
        key: `s-${i}`,
        included: true,
        // Cadence: Initial Day 0 → +3 BD → +5 BD → +7 BD (weekends skipped)
        dueDate: dateInputForSequenceStep(i, { includeInitial }),
      })),
    );
    setPhase("review");
  }

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const demoBase = demoContextPayload();
      const demoContext =
        isDemo && demoBase
          ? {
              ...demoBase,
              ...(selectedScript
                ? {
                    selectedTemplate: {
                      id: selectedScript.id,
                      title: selectedScript.title,
                      category: selectedScript.category,
                      primaryText: selectedScript.primaryText,
                      secondaryText: selectedScript.secondaryText,
                    },
                  }
                : {}),
            }
          : undefined;
      const res = await fetch("/api/ai/followup-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          userPrompt: userPrompt.trim() || undefined,
          sequenceMode,
          channelMix,
          scriptId: scriptId || undefined,
          regenerateContext: regenerateFromPlan
            ? `${regenerateFromPlan.pausedReason ?? "Lead replied"}. Prior: ${regenerateFromPlan.planSummary}`
            : undefined,
          followupPlans: followupPlans.map((p) => ({
            id: p.id,
            status: p.status,
            planSummary: p.planSummary,
            pausedReason: p.pausedReason,
            pausedAt: p.pausedAt,
          })),
          emailThreads: aiContext.emailThreads,
          demoContext,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isDemo) {
          applyApiResult(demoFollowupSuggestions(lead, userPrompt, sequenceMode, channelMix));
          return;
        }
        setError(typeof data.error === "string" ? data.error : "Could not generate suggestions");
        return;
      }
      applyApiResult(data);
    } catch {
      if (isDemo) {
        applyApiResult(demoFollowupSuggestions(lead, userPrompt, sequenceMode, channelMix));
      } else {
        setError("Network error");
      }
    } finally {
      setLoading(false);
    }
  }

  function updateItem(key: string, patch: Partial<EditableItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function accept() {
    const selected = items.filter((it) => it.included);
    if (selected.length === 0) {
      toast.error("Select at least one step to activate");
      return;
    }
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
      sequenceMode,
      channelMix,
      createdAt: new Date().toISOString(),
      supersededByPlanId: undefined,
      sourceScriptId: scriptId || undefined,
    };
    const created: Followup[] = selected.map((it) => ({
      id: newFollowupId(),
      leadId: lead.id,
      title: it.title.trim(),
      description: it.description?.trim() || undefined,
      messageBody: it.messageBody.trim(),
      emailSubject: it.emailSubject?.trim() || undefined,
      channel: it.channel,
      planId,
      aiGenerated: true,
      dueAt: isoFromDateInput(it.dueDate),
      ownerId,
      priority: it.priority,
      auto: false,
    }));
    onCreatePlanWithFollowups(plan, created);
    const emailCount = created.filter((f) =>
      canAutoScheduleFollowupEmail(f, lead.channel),
    ).length;
    const remindCount = created.length - emailCount;
    toast.success(
      `Activated sequence · ${created.length} step${created.length === 1 ? "" : "s"}`,
      remindCount > 0
        ? {
            description: `${emailCount} email${emailCount === 1 ? "" : "s"} can be scheduled · ${remindCount} LinkedIn/other as copy reminders`,
          }
        : undefined,
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            {regenerateFromPlan ? "Regenerate sequence" : "Build sequence"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {regenerateFromPlan
              ? "Lead replied - draft a new cadence that reflects their message. Edit before activating."
              : "AI proposes a personalized multi-step cadence. Edit, then activate. Email steps can be scheduled; LinkedIn and other channels stay as copy-ready reminders."}
          </DialogDescription>
        </DialogHeader>

        {phase === "prompt" && (
          <div className="space-y-4">
            {!regenerateFromPlan ? (
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
                      First touch through last step - complete cadence.
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
                      Intro already sent - draft remaining touches.
                    </p>
                  </button>
                </div>
              </div>
            ) : null}
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
              {(channelMix === "linkedin" || channelMix === "multi_channel") && !hasLinkedIn ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  No LinkedIn URL on this lead — add one so reps can open the profile from reminders.
                </p>
              ) : null}
            </div>
            <ScriptTemplatePicker
              key={`tpl-${open ? "1" : "0"}-${regenerateFromPlan?.id ?? "new"}-${sequenceMode}`}
              isDemo={isDemo}
              viewerId={currentUserId}
              sequenceMode={sequenceMode}
              value={scriptId}
              preferredScriptId={regenerateFromPlan?.sourceScriptId}
              onChange={(id, item) => {
                setScriptId(id);
                setSelectedScript(item);
              }}
            />
            <div className="grid gap-2">
              <Label htmlFor="followup-ai-prompt" className="text-xs">
                Instructions (optional)
              </Label>
              <Textarea
                id="followup-ai-prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder={
                  channelMix === "multi_channel"
                    ? 'e.g. "Start with connection note, softer email CTA"'
                    : 'e.g. "Soft tone, 4 emails over 2 weeks"'
                }
                rows={3}
                className="resize-none text-sm"
                maxLength={500}
              />
              <p className="text-[10px] text-muted-foreground">
                Combined with full lead context: stage, notes, emails, open follow-ups, optional
                template above, and RAG scripts (when enabled).
              </p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="sm:justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={loading} onClick={() => void generate()}>
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> Generate sequence
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4">
            {planSummary && (
              <p className="text-sm text-muted-foreground leading-relaxed">{planSummary}</p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Mode:{" "}
              <span className="font-medium text-foreground">
                {sequenceMode === "continue" ? "Continue / follow-ups only" : "Full outreach"}
              </span>
              {" · "}
              Channels:{" "}
              <span className="font-medium text-foreground">{channelMixLabel(channelMix)}</span>
              . Due dates skip weekends
              {sequenceMode === "full"
                ? ": Day 0, then +3 / +5 / +7 business days."
                : " (+3 / +5 / +7 business days from today)."}{" "}
              Verify copy, then activate.
            </p>
            <ul className="space-y-4">
              {items.map((it, idx) => (
                <li
                  key={it.key}
                  className={cn(
                    "rounded-lg border p-3 space-y-3",
                    !it.included && "opacity-50",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={it.included}
                      onCheckedChange={(v) => updateItem(it.key, { included: v === true })}
                      aria-label={`Include ${it.title}`}
                      className="mt-1"
                    />
                    <div className="flex-1 grid gap-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
                          Step {idx + 1}
                        </span>
                        <Input
                          value={it.title}
                          onChange={(e) => updateItem(it.key, { title: e.target.value })}
                          className="h-8 text-sm font-medium"
                        />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="grid gap-1">
                          <Label className="text-[10px] text-muted-foreground">Due</Label>
                          <Input
                            type="date"
                            value={it.dueDate}
                            onChange={(e) => updateItem(it.key, { dueDate: e.target.value })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-[10px] text-muted-foreground">Priority</Label>
                          <Select
                            value={it.priority}
                            onValueChange={(v) => {
                              if (v) updateItem(it.key, { priority: v as LeadPriority });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(["low", "medium", "high", "urgent"] as const).map((p) => (
                                <SelectItem key={p} value={p}>
                                  {PRIORITY_TONE[p].label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1 col-span-2">
                          <Label className="text-[10px] text-muted-foreground">Channel</Label>
                          <Select
                            value={it.channel}
                            onValueChange={(v) => {
                              if (v) updateItem(it.key, { channel: v as FollowupChannel });
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue>{channelLabel(it.channel, channelOptions)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {channelOptions.map((c) => (
                                <SelectItem key={c.key} value={c.key}>
                                  {c.label}
                                </SelectItem>
                              ))}
                              <SelectItem value="other">
                                Same as lead ({channelLabel(leadChannel, channelOptions)})
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {it.rationale && (
                        <p className="text-[10px] text-muted-foreground italic">{it.rationale}</p>
                      )}
                      {showsEmailSubject(it.channel) ? (
                        <div className="grid gap-1">
                          <Label className="text-[10px] text-muted-foreground">Email subject</Label>
                          <Input
                            value={it.emailSubject ?? ""}
                            onChange={(e) => updateItem(it.key, { emailSubject: e.target.value })}
                            className="h-8 text-xs"
                            placeholder="Subject line for scheduled send"
                          />
                        </div>
                      ) : null}
                      <div className="grid gap-1">
                        <Label className="text-[10px] text-muted-foreground">Message to send</Label>
                        <Textarea
                          value={it.messageBody}
                          onChange={(e) => updateItem(it.key, { messageBody: e.target.value })}
                          rows={4}
                          className="resize-y text-xs font-mono"
                        />
                        <CopyMessageButton text={it.messageBody} />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setPhase("prompt");
                  setError(null);
                }}
              >
                Back
              </Button>
              <Button type="button" variant="outline" disabled={loading} onClick={() => void generate()}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Regenerate"}
              </Button>
              <Button type="button" onClick={accept}>
                Activate {items.filter((i) => i.included).length} step
                {items.filter((i) => i.included).length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy");
    }
  }
  return (
    <Button type="button" variant="secondary" size="sm" className="h-7 text-xs w-fit" onClick={() => void copy()}>
      {copied ? (
        <>
          <Check className="h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy message
        </>
      )}
    </Button>
  );
}
