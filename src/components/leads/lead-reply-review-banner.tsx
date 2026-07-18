"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  acceptLeadReplyReview,
  dismissLeadReplyReview,
} from "@/lib/leads/accept-reply-review";
import {
  hasPendingReplyReview,
  replyReviewActionFor,
  replyReviewActionLabel,
  replyReviewDetail,
} from "@/lib/leads/reply-review";
import { fmtRelative } from "@/lib/format";
import type { Lead } from "@/lib/types";

export function LeadReplyReviewBanner({ lead }: { lead: Lead }) {
  const { currentUserId, patchLeadAsync, updateLeadStage, leads } = useWorkspace();
  const [busy, setBusy] = React.useState(false);

  if (!hasPendingReplyReview(lead)) return null;

  const action = replyReviewActionFor(lead);
  const label = replyReviewActionLabel(action, lead);

  async function onAccept() {
    if (!currentUserId) return;
    setBusy(true);
    try {
      await acceptLeadReplyReview({
        lead,
        leads,
        actorId: currentUserId,
        patchLeadAsync,
        updateLeadStage,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not update opportunity", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  async function onDismiss() {
    setBusy(true);
    try {
      await dismissLeadReplyReview({ lead, patchLeadAsync });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not dismiss", { description: msg });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <MessageSquareReply className="h-4 w-4 text-cyan-700 dark:text-cyan-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium">Reply received</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {replyReviewDetail(lead)}
            {lead.lastReplyAt ? ` · ${fmtRelative(lead.lastReplyAt)}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button type="button" size="sm" disabled={busy || action === "none"} onClick={() => void onAccept()}>
          {label}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/inbox" />}
        >
          Open inbox
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void onDismiss()}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
