"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { shouldOfferReplyIntelligenceRun } from "@/lib/email/reply-intelligence-run-visibility";
import type { Lead } from "@/lib/types";

export { shouldOfferReplyIntelligenceRun };

export function LeadReplyIntelligenceTrigger({
  lead,
  canEdit,
  onOpenEmails,
  variant = "banner",
}: {
  lead: Lead;
  canEdit: boolean;
  onOpenEmails?: () => void;
  variant?: "banner" | "inline";
}) {
  const { patchLeadAsync } = useWorkspace();
  const [busy, setBusy] = React.useState(false);

  if (!canEdit || lead.doNotContact || !shouldOfferReplyIntelligenceRun(lead)) {
    return null;
  }

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
      };

      if (!response.ok || !data.ok) {
        const description = typeof data.error === "string" ? data.error : "Request failed";
        toast.error("Could not generate next step", { description });
        if (data.code === "no_body" || data.code === "no_inbound") {
          onOpenEmails?.();
        }
        return;
      }

      await patchLeadAsync(lead.id, {
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

      toast.success("Next step generated", {
        description: "Review the reply intelligence suggestion on this lead.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not generate next step", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  if (variant === "inline") {
    return (
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onRun()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? "Generating…" : "Generate next step"}
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium">Reply intelligence</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A reply is on this lead, but no AI next step is ready. Run reply intelligence to
            classify it and generate the next step.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button type="button" size="sm" disabled={busy} onClick={() => void onRun()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? "Generating…" : "Generate next step"}
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
