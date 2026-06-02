"use client";

import Link from "next/link";
import { AlertCircle, Mail, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FollowupPlan } from "@/lib/types";
import { fmtRelative } from "@/lib/format";

export function FollowupPlanPausedBanner({
  plan,
  onRegenerate,
  onDismiss,
}: {
  plan: FollowupPlan;
  onRegenerate: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm font-medium">Follow-up plan paused</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {plan.pausedReason ?? "A reply was detected on this lead."}
            {plan.pausedAt ? ` · ${fmtRelative(plan.pausedAt)}` : ""}
          </p>
          {plan.planSummary && (
            <p className="text-xs text-muted-foreground/90 line-clamp-2">{plan.planSummary}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button type="button" size="sm" onClick={onRegenerate}>
          <Sparkles className="h-3.5 w-3.5" />
          Regenerate follow-ups
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link href="/inbox">Respond in Inbox</Link>}
        >
          <Mail className="h-3.5 w-3.5" />
          Open inbox
        </Button>
        {onDismiss ? (
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}
