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
  ChannelKey,
  Contact,
  Deal,
  Followup,
  FollowupPlan,
  FollowupChannel,
  FollowupSequenceMode,
  Lead,
  LeadPriority,
  LeadTask,
  Note,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import { CHANNEL_LIST, PRIORITY_TONE } from "@/lib/constants";
import { dateInputForSequenceStep, isoFromDateInput } from "@/lib/followup-date";
import { demoFollowupSuggestions } from "@/lib/ai/demo-followup-suggestions";
import { cn } from "@/lib/utils";
import type { LeadAiContextInput } from "@/lib/ai/load-lead-ai-context-server";
import { toast } from "sonner";

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

function channelLabel(ch: FollowupChannel): string {
  if (ch === "other") return "Lead channel";
  return CHANNEL_LIST.find((c) => c.key === ch)?.label ?? ch;
}

function showsEmailSubject(ch: FollowupChannel): boolean {
  return (
    ch === "cold_email" ||
    ch === "personalized_email" ||
    ch === "website_form" ||
    ch === "other"
  );
}

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
}) {
  const [phase, setPhase] = React.useState<"prompt" | "review">("prompt");
  const [sequenceMode, setSequenceMode] =
    React.useState<FollowupSequenceMode>(initialSequenceMode);
  const [userPrompt, setUserPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [planSummary, setPlanSummary] = React.useState("");
  const [items, setItems] = React.useState<EditableItem[]>([]);
  const [leadChannel, setLeadChannel] = React.useState<ChannelKey>(lead.channel);

  React.useEffect(() => {
    if (!open) return;
    setPhase("prompt");
    setSequenceMode(
      regenerateFromPlan?.sequenceMode ??
        (regenerateFromPlan ? "continue" : initialSequenceMode),
    );
    setUserPrompt(
      regenerateFromPlan
        ? `Regenerate after lead reply. Prior plan: ${regenerateFromPlan.planSummary}. ${regenerateFromPlan.pausedReason ?? ""}`.trim()
        : "",
    );
    setError(null);
    setPlanSummary("");
    setItems([]);
    setLeadChannel(lead.channel);
  }, [open, lead.id, lead.channel, regenerateFromPlan, initialSequenceMode]);

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
      const res = await fetch("/api/ai/followup-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          userPrompt: userPrompt.trim() || undefined,
          sequenceMode,
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
          demoContext: demoContextPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isDemo) {
          applyApiResult(demoFollowupSuggestions(lead, userPrompt, sequenceMode));
          return;
        }
        setError(typeof data.error === "string" ? data.error : "Could not generate suggestions");
        return;
      }
      applyApiResult(data);
    } catch {
      if (isDemo) {
        applyApiResult(demoFollowupSuggestions(lead, userPrompt, sequenceMode));
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
      createdAt: new Date().toISOString(),
      supersededByPlanId: undefined,
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
    toast.success(
      `Activated sequence · ${created.length} step${created.length === 1 ? "" : "s"}`,
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
              ? "Lead replied — draft a new cadence that reflects their message. Edit before activating."
              : "AI proposes a personalized multi-step cadence. Edit, then activate. Email steps can be scheduled; other channels stay as copy-ready reminders."}
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
                      First touch through last email — complete autopilot sequence.
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
                      Intro already sent — draft remaining touches starting from the next email.
                    </p>
                  </button>
                </div>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="followup-ai-prompt" className="text-xs">
                Instructions (optional)
              </Label>
              <Textarea
                id="followup-ai-prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder='e.g. "Soft tone, 4 emails over 2 weeks" or "LinkedIn first, then email"'
                rows={3}
                className="resize-none text-sm"
                maxLength={500}
              />
              <p className="text-[10px] text-muted-foreground">
                Combined with full lead context: stage, notes, emails, open follow-ups, and scripts
                (when RAG is enabled).
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
                              <SelectValue>{channelLabel(it.channel)}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {CHANNEL_LIST.map((c) => (
                                <SelectItem key={c.key} value={c.key}>
                                  {c.label}
                                </SelectItem>
                              ))}
                              <SelectItem value="other">
                                Same as lead ({channelLabel(leadChannel)})
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
