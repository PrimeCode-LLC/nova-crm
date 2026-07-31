"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  REPLY_CLASS_LABELS,
  replyActionNeedsDraft,
  type ReplyAction,
  type ReplyClass,
} from "@/lib/email/reply-action-types";
import {
  dispatchLeadReplySent,
  REPLY_REGENERATE_DIRECTIONS,
  type ReplyRegenerateDirectionId,
} from "@/lib/email/lead-reply-events";
import type { Lead } from "@/lib/types";

function hasPendingReplyAction(lead: Lead): boolean {
  return Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
}

function senderLabel(raw: string): string {
  const match = raw.match(/^([^<]+)</);
  return (match?.[1] ?? raw).trim().replace(/^["']|["']$/g, "") || "them";
}

export function LeadReplyActionBanner({
  lead,
  onOpenEmails,
}: {
  lead: Lead;
  onOpenEmails?: () => void;
}) {
  const { patchLeadAsync } = useWorkspace();
  const [busy, setBusy] = React.useState(false);
  const [action, setAction] = React.useState<ReplyAction | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [draftBody, setDraftBody] = React.useState("");
  const [draftSubject, setDraftSubject] = React.useState("");
  const [regenerateDirection, setRegenerateDirection] =
    React.useState<ReplyRegenerateDirectionId | null>(null);
  const [regeneratePrompt, setRegeneratePrompt] = React.useState("");
  const [confirmSend, setConfirmSend] = React.useState(false);
  const [optimisticPending, setOptimisticPending] = React.useState(false);
  const [streamReveal, setStreamReveal] = React.useState<string | null>(null);

  const actionId = lead.pendingReplyActionId?.trim() ?? "";
  const pending = hasPendingReplyAction(lead);

  const loadAction = React.useCallback(async () => {
    if (!pending || !actionId) {
      setAction(null);
      return;
    }
    const response = await fetch(`/api/email/reply-actions?id=${encodeURIComponent(actionId)}`, {
      credentials: "same-origin",
    });
    const data = (await response.json()) as { ok?: boolean; action?: ReplyAction; resolvedByManualSend?: boolean };
    if (response.ok && data.ok && data.action) {
      if (data.resolvedByManualSend || data.action.status === "sent") {
        await patchLeadAsync(lead.id, {
          pendingReplyActionId: undefined,
          replyActionStatus: "sent",
          nextAction: "Reply sent — wait for their response",
        });
        setAction(null);
        return;
      }
      setAction(data.action);
      setDraftBody(data.action.draftBody ?? "");
      setDraftSubject(data.action.draftSubject ?? "");
      if (data.action.draftStatus === "ready") {
        setOptimisticPending(false);
      }
    }
  }, [actionId, lead.id, patchLeadAsync, pending]);

  React.useEffect(() => {
    if (!pending || !actionId) {
      void Promise.resolve().then(() => {
        setAction(null);
        setOptimisticPending(false);
        setConfirmSend(false);
        setStreamReveal(null);
      });
      return;
    }
    let cancelled = false;
    void loadAction().catch(() => {
      if (!cancelled) {
        /* lead.nextAction still shows summary */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actionId, loadAction, pending]);

  // Poll briefly while draft is generating.
  React.useEffect(() => {
    if (!pending || !actionId) return;
    if (action?.draftStatus !== "pending" && !optimisticPending) return;
    const timer = window.setInterval(() => {
      void loadAction().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [action?.draftStatus, actionId, loadAction, optimisticPending, pending]);

  // Soft stream-in when a new draft arrives after regenerate / first generate.
  React.useEffect(() => {
    if (!draftBody.trim() || action?.draftStatus !== "ready" || busy) {
      setStreamReveal(null);
      return;
    }
    if (streamReveal === draftBody) return;
    if (draftBody.length < 40) {
      setStreamReveal(draftBody);
      return;
    }
    let i = Math.min(24, draftBody.length);
    setStreamReveal(draftBody.slice(0, i));
    const timer = window.setInterval(() => {
      i = Math.min(draftBody.length, i + Math.max(8, Math.floor(draftBody.length / 18)));
      setStreamReveal(draftBody.slice(0, i));
      if (i >= draftBody.length) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
    // Only animate when draftBody identity changes after ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftBody, action?.draftStatus]);

  if (!pending) return null;

  const classification = (action?.classification || lead.replyClass) as ReplyClass | undefined;
  const label = classification ? REPLY_CLASS_LABELS[classification] : "Reply analyzed";
  const rationale = action?.rationale?.trim() || "";
  const nextStep =
    action?.nextStepSummary?.trim() ||
    lead.nextAction?.replace(/^[^:]+:\s*/, "").replace(/\s·\sDraft.*$/, "").replace(/\s·\sRewriting.*$/, "") ||
    "Review the inbound reply and choose a next step.";
  const score = action?.potentialScore;
  const needsDraft = action
    ? replyActionNeedsDraft({
        classification: action.classification,
        recommendedAction: action.recommendedAction,
      })
    : Boolean(classification && classification !== "auto_reply" && classification !== "hard_no");
  const draftReady = action?.draftStatus === "ready" && Boolean(draftBody.trim()) && !optimisticPending;
  const draftPending =
    optimisticPending || action?.draftStatus === "pending" || Boolean(lead.nextAction?.includes("Draft generating"));
  const draftFailed = action?.draftStatus === "failed" && !optimisticPending;
  const inboundQuote = action?.inboundPreview?.trim() || "";
  const inboundFrom = action?.inboundFrom?.trim() || "";
  const displayBody =
    draftPending && !draftReady
      ? ""
      : streamReveal != null && streamReveal.length < draftBody.length
        ? streamReveal
        : draftBody;
  const isStreamingIn = Boolean(
    draftReady && streamReveal != null && streamReveal.length < draftBody.length && !editing,
  );

  async function patchDecision(
    decision: "accepted" | "dismissed" | "send" | "save_draft" | "regenerate",
    extra?: { draftBody?: string; draftSubject?: string; regenerateDirection?: string },
  ) {
    if (!actionId) return;
    setBusy(true);
    setConfirmSend(false);
    if (decision === "regenerate") {
      setOptimisticPending(true);
      setEditing(false);
      setStreamReveal(null);
      setDraftBody("");
    }
    try {
      const response = await fetch("/api/email/reply-actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: actionId, decision, ...extra }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        action?: ReplyAction;
        messageId?: string;
        subject?: string;
        to?: string;
        from?: string;
        body?: string;
        mailboxId?: string;
        mailboxOwnerUid?: string;
        sentAt?: string;
        inReplyTo?: string;
        referenceIds?: string[];
        leadId?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not update");

      if (decision === "regenerate" || decision === "save_draft") {
        if (data.action) {
          setAction(data.action);
          setDraftBody(data.action.draftBody ?? "");
          setDraftSubject(data.action.draftSubject ?? "");
          setOptimisticPending(data.action.draftStatus === "pending");
        } else {
          await loadAction();
        }
        if (decision === "regenerate") {
          setRegeneratePrompt("");
          setRegenerateDirection(null);
        }
        setEditing(false);
        toast.success(decision === "regenerate" ? "New draft ready" : "Draft saved");
        return;
      }

      if (decision === "send") {
        await patchLeadAsync(lead.id, {
          pendingReplyActionId: undefined,
          replyActionStatus: "sent",
          nextAction: "Reply sent — wait for their response",
        });
        dispatchLeadReplySent({
          leadId: data.leadId || lead.id,
          subject: data.subject || draftSubject,
          messageId: data.messageId,
          body: data.body || draftBody,
          to: data.to || action?.draftTo,
          from: data.from,
          mailboxId: data.mailboxId || action?.mailboxId,
          mailboxOwnerUid: data.mailboxOwnerUid || action?.mailboxOwnerUid,
          sentAt: data.sentAt || new Date().toISOString(),
          inReplyTo: data.inReplyTo || action?.draftInReplyTo,
          referenceIds: data.referenceIds || action?.draftReferenceIds,
        });
        onOpenEmails?.();
        toast.success("Reply sent in thread");
        return;
      }

      await patchLeadAsync(lead.id, {
        pendingReplyActionId: undefined,
        replyActionStatus: decision,
      });
      toast.success(decision === "accepted" ? "Next step confirmed" : "Suggestion dismissed");
    } catch (e) {
      if (decision === "regenerate") {
        setOptimisticPending(false);
        await loadAction().catch(() => undefined);
      }
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  function buildRegenerateDirection(): string | undefined {
    const preset = REPLY_REGENERATE_DIRECTIONS.find((d) => d.id === regenerateDirection)?.hint?.trim();
    const custom = regeneratePrompt.trim();
    if (preset && custom) return `${preset} Additional guidance: ${custom}`;
    return custom || preset || undefined;
  }

  function regenerateLabel(): string {
    const preset = REPLY_REGENERATE_DIRECTIONS.find((d) => d.id === regenerateDirection)?.label;
    const hasCustom = Boolean(regeneratePrompt.trim());
    if (preset && hasCustom) return ` · ${preset} + prompt`;
    if (preset) return ` · ${preset}`;
    if (hasCustom) return " · Custom prompt";
    return "";
  }

  function runRegenerate() {
    void patchDecision("regenerate", {
      regenerateDirection: buildRegenerateDirection(),
    });
  }

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {draftPending
                ? "AI is writing a reply…"
                : needsDraft
                  ? "AI reply ready for approval"
                  : "AI next step ready"}
            </p>
            <Badge variant="secondary">{label}</Badge>
            {typeof score === "number" && classification !== "auto_reply" ? (
              <Badge variant="outline">Potential {Math.round(score)}</Badge>
            ) : null}
            {draftPending ? <Badge variant="outline">Generating draft…</Badge> : null}
            {draftReady ? <Badge variant="outline">Draft ready</Badge> : null}
          </div>
          <p className="text-sm font-medium leading-snug">{nextStep}</p>
          {rationale ? (
            <p className="text-xs text-muted-foreground leading-relaxed">{rationale}</p>
          ) : null}
          {draftFailed && action?.draftError ? (
            <p className="text-xs text-destructive">{action.draftError}</p>
          ) : null}
        </div>
      </div>

      {inboundQuote ? (
        <div className="pl-6">
          <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2 space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Replying to {inboundFrom ? senderLabel(inboundFrom) : "their message"}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
              “{inboundQuote}”
            </p>
          </div>
        </div>
      ) : null}

      {needsDraft && draftPending ? (
        <div className="space-y-2 pl-6">
          <div className="h-8 w-full animate-pulse rounded-md bg-muted/80" />
          <div className="space-y-2 rounded-md border border-dashed border-violet-500/30 bg-background/40 p-3">
            <div className="h-3 w-[92%] animate-pulse rounded bg-muted" />
            <div className="h-3 w-[84%] animate-pulse rounded bg-muted" />
            <div className="h-3 w-[76%] animate-pulse rounded bg-muted" />
            <div className="h-3 w-[60%] animate-pulse rounded bg-muted" />
            <p className="pt-1 inline-flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Writing a reply from the thread and lead context…
            </p>
          </div>
        </div>
      ) : null}

      {needsDraft && (draftReady || editing || draftFailed) && !draftPending ? (
        <div className="space-y-2 pl-6">
          {editing || draftReady ? (
            <>
              <input
                className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                disabled={busy || (!editing && !draftReady)}
                placeholder="Subject"
                aria-label="Draft subject"
              />
              <Textarea
                value={editing || !isStreamingIn ? draftBody : displayBody}
                onChange={(e) => {
                  setDraftBody(e.target.value);
                  setStreamReveal(e.target.value);
                  if (!editing) setEditing(true);
                }}
                disabled={busy || isStreamingIn}
                rows={8}
                className="min-h-[140px] text-sm"
                placeholder="AI draft will appear here…"
              />
              {isStreamingIn ? (
                <p className="text-[11px] text-muted-foreground">Draft arriving…</p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {needsDraft && draftReady && !draftPending ? (
        <div className="pl-6 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Regenerate direction
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REPLY_REGENERATE_DIRECTIONS.map((dir) => {
              const active = regenerateDirection === dir.id;
              return (
                <Button
                  key={dir.id}
                  type="button"
                  size="sm"
                  variant={active ? "secondary" : "outline"}
                  className="h-7 text-xs"
                  disabled={busy}
                  onClick={() =>
                    setRegenerateDirection((prev) => (prev === dir.id ? null : dir.id))
                  }
                >
                  {dir.label}
                </Button>
              );
            })}
          </div>
          <Textarea
            value={regeneratePrompt}
            onChange={(e) => setRegeneratePrompt(e.target.value.slice(0, 400))}
            disabled={busy}
            rows={2}
            className="min-h-[56px] text-xs"
            placeholder="Or describe how to rewrite (tone, length, what to ask, what to avoid…)"
            aria-label="Custom regenerate prompt"
          />
          {regeneratePrompt.trim() ? (
            <p className="text-[11px] text-muted-foreground">
              {regeneratePrompt.trim().length}/400 · Applied with Regenerate
            </p>
          ) : null}
        </div>
      ) : null}

      {confirmSend && draftReady ? (
        <div className="pl-6 rounded-md border border-primary/30 bg-background/60 px-3 py-2 text-xs space-y-1">
          <p className="font-medium">Send this reply in the same thread?</p>
          <p className="text-muted-foreground">
            To {action?.draftTo || lead.contactEmail || "recipient"}
            {draftSubject ? ` · ${draftSubject}` : ""}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              disabled={busy || !draftBody.trim()}
              onClick={() =>
                void patchDecision("send", {
                  draftBody,
                  draftSubject,
                })
              }
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Confirm send
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmSend(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pl-6">
        {needsDraft && draftReady && !confirmSend ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy || !draftBody.trim() || isStreamingIn}
              onClick={() => setConfirmSend(true)}
            >
              Approve & send
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void patchDecision("save_draft", {
                  draftBody,
                  draftSubject,
                })
              }
            >
              Save edits
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => runRegenerate()}
            >
              {busy && optimisticPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Regenerate
              {regenerateLabel()}
            </Button>
          </>
        ) : needsDraft && (draftFailed || action?.draftStatus === "none") && !draftPending ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => runRegenerate()}
          >
            Generate draft
          </Button>
        ) : !needsDraft ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void patchDecision("accepted")}
          >
            Confirm next step
          </Button>
        ) : null}
        {onOpenEmails ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onOpenEmails}>
            Open emails
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void patchDecision("dismissed")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
