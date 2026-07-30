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
import type { Lead } from "@/lib/types";

function hasPendingReplyAction(lead: Lead): boolean {
  return Boolean(lead.pendingReplyActionId?.trim()) && lead.replyActionStatus === "pending";
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
    const data = (await response.json()) as { ok?: boolean; action?: ReplyAction };
    if (response.ok && data.ok && data.action) {
      setAction(data.action);
      setDraftBody(data.action.draftBody ?? "");
      setDraftSubject(data.action.draftSubject ?? "");
    }
  }, [actionId, pending]);

  React.useEffect(() => {
    if (!pending || !actionId) {
      void Promise.resolve().then(() => setAction(null));
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
    if (action?.draftStatus !== "pending") return;
    const timer = window.setInterval(() => {
      void loadAction().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [action?.draftStatus, actionId, loadAction, pending]);

  if (!pending) return null;

  const classification = (action?.classification || lead.replyClass) as ReplyClass | undefined;
  const label = classification ? REPLY_CLASS_LABELS[classification] : "Reply analyzed";
  const rationale = action?.rationale?.trim() || "";
  const nextStep =
    action?.nextStepSummary?.trim() ||
    lead.nextAction?.replace(/^[^:]+:\s*/, "").replace(/\s·\sDraft.*$/, "") ||
    "Review the inbound reply and choose a next step.";
  const score = action?.potentialScore;
  const needsDraft = action
    ? replyActionNeedsDraft({
        classification: action.classification,
        recommendedAction: action.recommendedAction,
      })
    : Boolean(classification && classification !== "auto_reply" && classification !== "hard_no");
  const draftReady = action?.draftStatus === "ready" && Boolean(draftBody.trim());
  const draftPending = action?.draftStatus === "pending";
  const draftFailed = action?.draftStatus === "failed";

  async function patchDecision(
    decision: "accepted" | "dismissed" | "send" | "save_draft" | "regenerate",
    extra?: { draftBody?: string; draftSubject?: string },
  ) {
    if (!actionId) return;
    setBusy(true);
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
      };
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not update");

      if (decision === "regenerate" || decision === "save_draft") {
        if (data.action) {
          setAction(data.action);
          setDraftBody(data.action.draftBody ?? "");
          setDraftSubject(data.action.draftSubject ?? "");
        } else {
          await loadAction();
        }
        setEditing(false);
        toast.success(decision === "regenerate" ? "Draft regenerated" : "Draft saved");
        return;
      }

      if (decision === "send") {
        await patchLeadAsync(lead.id, {
          pendingReplyActionId: undefined,
          replyActionStatus: "sent",
          nextAction: "Reply sent — wait for their response",
        });
        toast.success("Reply sent");
        return;
      }

      await patchLeadAsync(lead.id, {
        pendingReplyActionId: undefined,
        replyActionStatus: decision,
      });
      toast.success(decision === "accepted" ? "Next step confirmed" : "Suggestion dismissed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">
              {needsDraft ? "AI reply ready for approval" : "AI next step ready"}
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

      {needsDraft && (draftReady || editing || draftFailed) ? (
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
                value={draftBody}
                onChange={(e) => {
                  setDraftBody(e.target.value);
                  if (!editing) setEditing(true);
                }}
                disabled={busy}
                rows={8}
                className="min-h-[140px] text-sm"
                placeholder="AI draft will appear here…"
              />
            </>
          ) : null}
        </div>
      ) : null}

      {draftPending ? (
        <p className="pl-6 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Writing a reply from the thread and lead context…
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pl-6">
        {needsDraft && draftReady ? (
          <>
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
              onClick={() => void patchDecision("regenerate")}
            >
              Regenerate
            </Button>
          </>
        ) : needsDraft && (draftFailed || action?.draftStatus === "none") ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void patchDecision("regenerate")}
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
