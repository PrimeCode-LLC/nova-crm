"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  shouldHighlightMissingReplyNextStep,
  shouldOfferReplyIntelligenceRun,
} from "@/lib/email/reply-intelligence-run-visibility";
import type { Lead } from "@/lib/types";

export { shouldOfferReplyIntelligenceRun, shouldHighlightMissingReplyNextStep };

export function LeadReplyIntelligenceTrigger({
  lead,
  canEdit,
  onOpenEmails,
  variant = "auto",
}: {
  lead: Lead;
  /** Kept for callers; button is available to anyone who can open the record. */
  canEdit?: boolean;
  onOpenEmails?: () => void;
  variant?: "auto" | "banner" | "inline";
}) {
  const { applyLeadLocalPatch } = useWorkspace();
  const [busy, setBusy] = React.useState(false);

  if (!shouldOfferReplyIntelligenceRun(lead)) {
    return null;
  }

  const highlight = shouldHighlightMissingReplyNextStep(lead);
  const resolvedVariant =
    variant === "auto" ? (highlight ? "banner" : "inline") : variant;

  async function onRun() {
    setBusy(true);
    try {
      const response = await fetch("/api/email/reply-actions/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        actionId?: string;
        nextAction?: string;
        replyClass?: string;
        mode?: "reattached" | "classified";
      };

      if (!response.ok || !data.ok) {
        const description = typeof data.error === "string" ? data.error : "Request failed";
        toast.error("Could not generate next step", { description });
        if (data.code === "no_body" || data.code === "no_inbound") {
          onOpenEmails?.();
        }
        return;
      }

      // Server already wrote Firestore; hydrate local session without edit-permission gate.
      applyLeadLocalPatch(lead.id, {
        ...(data.actionId
          ? {
              pendingReplyActionId: data.actionId,
              replyActionStatus: "pending" as const,
            }
          : {}),
        ...(data.nextAction ? { nextAction: data.nextAction } : {}),
        ...(data.replyClass
          ? { replyClass: data.replyClass as Lead["replyClass"] }
          : {}),
      });

      toast.success(
        data.mode === "reattached" ? "Next step restored" : "Next step generated",
        {
          description:
            data.mode === "reattached"
              ? "Reply intelligence was already available — attached it to this record."
              : "Review the suggestion and draft on this lead.",
        },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not generate next step", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  if (resolvedVariant === "inline") {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onRun()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Checking…" : "Detect reply & next step"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium">Missing next step</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Reply intelligence may already have this reply, but this record has no next step yet.
            Click to detect the reply and attach the suggestion (and draft when available).
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button type="button" size="sm" disabled={busy} onClick={() => void onRun()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Checking…" : "Detect reply & next step"}
        </Button>
        {onOpenEmails ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onOpenEmails}>
            Open Emails
          </Button>
        ) : null}
      </div>
    </div>
  );
}
