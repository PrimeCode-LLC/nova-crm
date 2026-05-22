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
import { Badge } from "@/components/ui/badge";
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
  FollowupChannel,
  Lead,
  LeadPriority,
  LeadTask,
  Note,
  TimelineEvent,
  Touchpoint,
} from "@/lib/types";
import { CHANNEL_LIST, PRIORITY_TONE } from "@/lib/constants";
import { dateInputFromOffsetDays, isoFromDateInput } from "@/lib/followup-date";
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

function resolveChannel(ch: FollowupChannel, leadChannel: ChannelKey): ChannelKey {
  return ch === "other" ? leadChannel : ch;
}

export function SuggestFollowupsDialog({
  open,
  onOpenChange,
  lead,
  aiContext,
  isDemo,
  currentUserId,
  onCreateMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead;
  aiContext: LeadFollowupAiContext;
  isDemo: boolean;
  currentUserId: string;
  onCreateMany: (followups: Followup[]) => void;
}) {
  const [phase, setPhase] = React.useState<"prompt" | "review">("prompt");
  const [userPrompt, setUserPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [planSummary, setPlanSummary] = React.useState("");
  const [items, setItems] = React.useState<EditableItem[]>([]);
  const [leadChannel, setLeadChannel] = React.useState<ChannelKey>(lead.channel);

  React.useEffect(() => {
    if (!open) return;
    setPhase("prompt");
    setUserPrompt("");
    setError(null);
    setPlanSummary("");
    setItems([]);
    setLeadChannel(lead.channel);
  }, [open, lead.id, lead.channel]);

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

  function applyApiResult(data: {
    planSummary?: string;
    leadChannel?: ChannelKey;
    items?: SuggestApiItem[];
  }) {
    setPlanSummary(data.planSummary ?? "");
    setLeadChannel(data.leadChannel ?? lead.channel);
    const apiItems = (data.items ?? []) as SuggestApiItem[];
    setItems(
      apiItems.map((it, i) => ({
        ...it,
        key: `s-${i}`,
        included: true,
        dueDate: dateInputFromOffsetDays(it.offsetDays),
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
          demoContext: demoContextPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (isDemo) {
          applyApiResult(demoFollowupSuggestions(lead, userPrompt));
          return;
        }
        setError(typeof data.error === "string" ? data.error : "Could not generate suggestions");
        return;
      }
      applyApiResult(data);
    } catch {
      if (isDemo) {
        applyApiResult(demoFollowupSuggestions(lead, userPrompt));
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
      toast.error("Select at least one follow-up to create");
      return;
    }
    const planId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `fp-${crypto.randomUUID()}`
        : `fp-${Date.now()}`;
    const ownerId = lead.ownerId ?? currentUserId;
    const created: Followup[] = selected.map((it) => ({
      id: newFollowupId(),
      leadId: lead.id,
      title: it.title.trim(),
      description: it.description?.trim() || undefined,
      messageBody: it.messageBody.trim(),
      channel: it.channel,
      planId,
      aiGenerated: true,
      dueAt: isoFromDateInput(it.dueDate),
      ownerId,
      priority: it.priority,
      auto: false,
    }));
    onCreateMany(created);
    toast.success(`Created ${created.length} follow-up${created.length === 1 ? "" : "s"}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Suggest follow-ups
          </DialogTitle>
          <DialogDescription className="text-xs">
            AI analyzes this lead and proposes a cadence with copy-ready messages. Edit anything
            before creating.
          </DialogDescription>
        </DialogHeader>

        {phase === "prompt" && (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="followup-ai-prompt" className="text-xs">
                Instructions (optional)
              </Label>
              <Textarea
                id="followup-ai-prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder='e.g. "Focus on Upwork proposal follow-up" or "Soft tone, 3 steps over 2 weeks"'
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
                    <Sparkles className="h-3.5 w-3.5" /> Generate suggestions
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
            <ul className="space-y-4">
              {items.map((it) => (
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
                      <Input
                        value={it.title}
                        onChange={(e) => updateItem(it.key, { title: e.target.value })}
                        className="h-8 text-sm font-medium"
                      />
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
                Create {items.filter((i) => i.included).length} follow-up
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
