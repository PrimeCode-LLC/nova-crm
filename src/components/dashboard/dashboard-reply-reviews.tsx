"use client";

import * as React from "react";
import Link from "next/link";
import { MessageSquareReply, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  acceptLeadReplyReview,
  dismissLeadReplyReview,
} from "@/lib/leads/accept-reply-review";
import {
  listPendingReplyReviews,
  replyReviewActionFor,
  replyReviewActionLabel,
  replyReviewDetail,
} from "@/lib/leads/reply-review";
import { hasPendingReplyAction } from "@/lib/email/reply-action-pending";
import { fmtRelative } from "@/lib/format";
import type { Lead } from "@/lib/types";

export function DashboardReplyReviews({ leads }: { leads: readonly Lead[] }) {
  const { currentUserId, patchLeadAsync, updateLeadStage, leads: allLeads } = useWorkspace();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const pending = React.useMemo(() => listPendingReplyReviews(leads).slice(0, 8), [leads]);

  async function onAccept(lead: Lead) {
    if (!currentUserId) return;
    setBusyId(lead.id);
    try {
      await acceptLeadReplyReview({
        lead,
        leads: allLeads,
        actorId: currentUserId,
        patchLeadAsync,
        updateLeadStage,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not update opportunity", { description: msg });
    } finally {
      setBusyId(null);
    }
  }

  async function onDismiss(lead: Lead) {
    setBusyId(lead.id);
    try {
      await dismissLeadReplyReview({ lead, patchLeadAsync });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("Could not dismiss", { description: msg });
    } finally {
      setBusyId(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <Card className="shrink-0 border-cyan-500/25 bg-cyan-500/[0.04]">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquareReply className="h-4 w-4 text-cyan-700 dark:text-cyan-400" aria-hidden />
              Replies to review
            </CardTitle>
            <CardDescription className="mt-1">
              Confirm promoting prospects into the pipeline or moving early-stage leads to Replied.
            </CardDescription>
          </div>
          <Badge variant="secondary">{pending.length}</Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y rounded-md border bg-background/60">
          {pending.map((lead) => {
            const action = replyReviewActionFor(lead);
            const label = replyReviewActionLabel(action, lead);
            const href =
              lead.intakeKind === "prospect"
                ? `/leads/${lead.id}?from=prospects`
                : `/leads/${lead.id}`;
            const busy = busyId === lead.id;
            return (
              <li key={lead.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Link
                    href={href}
                    className="block truncate text-xs font-medium hover:underline"
                  >
                    {lead.companyName || lead.contactName || "Untitled"}
                    {lead.contactName && lead.companyName ? (
                      <span className="font-normal text-muted-foreground"> · {lead.contactName}</span>
                    ) : null}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{replyReviewDetail(lead)}</p>
                  {hasPendingReplyAction(lead) ? (
                    <p className="truncate text-[11px] text-amber-700 dark:text-amber-400">
                      AI next step ready on the lead — send or confirm to clear this too.
                    </p>
                  ) : null}
                  {lead.lastReplyAt ? (
                    <p className="text-[11px] text-muted-foreground/80">
                      Reply {fmtRelative(lead.lastReplyAt)}
                      {lead.lastReplySource ? ` · ${lead.lastReplySource}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || action === "none"}
                    onClick={() => void onAccept(lead)}
                  >
                    {label}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void onDismiss(lead)}
                  >
                    Dismiss
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={href} />}
                  >
                    Open
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
