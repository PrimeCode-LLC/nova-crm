"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Check,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Followup, Lead } from "@/lib/types";
import { CHANNEL_LIST, PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserChip } from "@/components/common/user-chip";
import { NewFollowupDialog } from "@/components/followups/new-followup-dialog";
import {
  SuggestFollowupsDialog,
  type LeadFollowupAiContext,
} from "@/components/ai/suggest-followups-dialog";
import { FollowupPlanPausedBanner } from "@/components/leads/followup-plan-paused-banner";
import { getPausedFollowupPlanForLead, mergeFollowupPlans } from "@/lib/followup-plans";
import type { FollowupPlan } from "@/lib/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { viewerHasElevatedWorkspaceRole } from "@/lib/viewer-elevated";
import { toast } from "sonner";

function channelBadgeLabel(channel: Followup["channel"]): string | null {
  if (!channel || channel === "other") return null;
  return CHANNEL_LIST.find((c) => c.key === channel)?.label ?? channel;
}

function CopyBodyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 text-xs"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            toast.success("Copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
          },
          () => toast.error("Could not copy"),
        );
      }}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy
        </>
      )}
    </Button>
  );
}

function FollowupRow({
  f,
  overdue,
  onComplete,
  onDelete,
  canDelete,
}: {
  f: Followup;
  overdue: boolean;
  onComplete: (done: boolean) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const chLabel = channelBadgeLabel(f.channel);

  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2 bg-card",
        overdue && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-center gap-3">
        <Checkbox
          checked={false}
          onCheckedChange={(v) => {
            if (v === true) onComplete(true);
          }}
          aria-label={`Mark ${f.title} complete`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{f.title}</span>
            <Badge
              className={cn(
                "rounded-md border-transparent text-[10px]",
                PRIORITY_TONE[f.priority].className,
              )}
            >
              {PRIORITY_TONE[f.priority].label}
            </Badge>
            {f.aiGenerated && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Sparkles className="h-2.5 w-2.5" /> AI
              </Badge>
            )}
            {f.pausedAt && (
              <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400">
                Paused
              </Badge>
            )}
            {f.auto && !f.aiGenerated && (
              <Badge variant="outline" className="text-[10px] gap-1">
                <Sparkles className="h-2.5 w-2.5" /> Auto
              </Badge>
            )}
            {chLabel && (
              <Badge variant="secondary" className="text-[10px]">
                {chLabel}
              </Badge>
            )}
          </div>
          {f.description && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{f.description}</p>
          )}
          {f.messageBody && !expanded && (
            <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">
              {f.messageBody.slice(0, 80)}
              {f.messageBody.length > 80 ? "…" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <UserChip userId={f.ownerId} size="xs" nameOnly />
          <span
            className={cn(
              "flex items-center gap-1 text-xs tabular-nums",
              overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            <Clock className="h-3 w-3" />
            {fmtDate(f.dueAt, "MMM d")} · {fmtRelative(f.dueAt)}
          </span>
          {f.messageBody ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={expanded ? "Collapse message" : "Expand message"}
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label="Delete followup"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>
      {expanded && f.messageBody && (
        <div className="mt-2 ml-9 space-y-2 border-t pt-2">
          <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/90 max-h-40 overflow-y-auto">
            {f.messageBody}
          </pre>
          <CopyBodyButton text={f.messageBody} />
        </div>
      )}
    </li>
  );
}

export function LeadFollowups({
  followups,
  lead,
  aiContext,
}: {
  followups: Followup[];
  lead: Lead;
  aiContext?: LeadFollowupAiContext;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [regeneratePlan, setRegeneratePlan] = React.useState<FollowupPlan | undefined>();
  const [dismissedPlanId, setDismissedPlanId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Followup | null>(null);
  const {
    addFollowup,
    createFollowupPlanWithFollowups,
    supersedeFollowupPlan,
    setFollowupCompleted,
    removeFollowup,
    currentUserId,
    leads,
    users,
    isDemo,
    followupPlans,
  } = useWorkspace();

  const plans = React.useMemo(
    () => mergeFollowupPlans(followupPlans, followups),
    [followupPlans, followups],
  );
  const pausedPlan = React.useMemo(
    () => getPausedFollowupPlanForLead(plans, lead.id),
    [plans, lead.id],
  );
  const showPausedBanner =
    pausedPlan && pausedPlan.id !== dismissedPlanId && !regeneratePlan;

  const open = followups.filter((f) => !f.completedAt);
  const done = followups.filter((f) => f.completedAt);

  const canDelete =
    !isDemo && viewerHasElevatedWorkspaceRole(users.find((u) => u.id === currentUserId));

  const contextForAi: LeadFollowupAiContext | undefined =
    aiContext ??
    ({
      lead,
      notes: [],
      timeline: [],
      touchpoints: [],
      followups,
      tasks: [],
    } satisfies LeadFollowupAiContext);

  function confirmDelete() {
    if (!deleteTarget) return;
    removeFollowup(deleteTarget.id);
    toast.success("Followup deleted");
    setDeleteTarget(null);
  }

  function handleCreatePlan(plan: FollowupPlan, batch: Followup[]) {
    if (regeneratePlan) {
      supersedeFollowupPlan(regeneratePlan.id, plan.id);
    }
    createFollowupPlanWithFollowups(plan, batch);
    setRegeneratePlan(undefined);
    setDismissedPlanId(null);
  }

  function openSuggest(regenerate?: FollowupPlan) {
    setRegeneratePlan(regenerate);
    setSuggestOpen(true);
  }

  return (
    <div className="space-y-4">
      {showPausedBanner && pausedPlan ? (
        <FollowupPlanPausedBanner
          plan={pausedPlan}
          onRegenerate={() => openSuggest(pausedPlan)}
          onDismiss={() => setDismissedPlanId(pausedPlan.id)}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">Open followups</p>
          <p className="text-xs text-muted-foreground">
            Manual reminders, AI plans with copy-ready messages, and idle warnings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" type="button" variant="outline" onClick={() => openSuggest()}>
            <Sparkles className="h-3.5 w-3.5" /> Suggest with AI
          </Button>
          <Button size="sm" type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add followup
          </Button>
        </div>
      </div>

      <NewFollowupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leads={leads}
        currentUserId={currentUserId}
        fixedLeadId={lead.id}
        onCreate={addFollowup}
      />

      <SuggestFollowupsDialog
        open={suggestOpen}
        onOpenChange={(o) => {
          setSuggestOpen(o);
          if (!o) setRegeneratePlan(undefined);
        }}
        lead={lead}
        aiContext={contextForAi}
        isDemo={isDemo}
        currentUserId={currentUserId}
        followupPlans={plans}
        regenerateFromPlan={regeneratePlan}
        onCreatePlanWithFollowups={handleCreatePlan}
      />

      <ul className="space-y-2">
        {open.map((f) => {
          const due = new Date(f.dueAt);
          const overdue = due.getTime() < Date.now();
          return (
            <FollowupRow
              key={f.id}
              f={f}
              overdue={overdue}
              onComplete={(done) => setFollowupCompleted(f.id, done)}
              onDelete={() => setDeleteTarget(f)}
              canDelete={canDelete}
            />
          );
        })}
        {open.length === 0 && (
          <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto h-5 w-5 mb-2 opacity-60" />
            No open followups. Add one or use AI to suggest a cadence.
          </div>
        )}
      </ul>

      {done.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">
            Completed
          </p>
          <ul className="space-y-1 mt-2">
            {done.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-md border px-3 py-1.5 bg-muted/20 opacity-70"
              >
                <Checkbox
                  checked
                  onCheckedChange={(v) => {
                    if (v !== true) setFollowupCompleted(f.id, false);
                  }}
                  aria-label={`Mark ${f.title} incomplete`}
                />
                <span className="text-sm line-through text-muted-foreground truncate flex-1">
                  {f.title}
                </span>
                <span className="text-xs text-muted-foreground">{fmtRelative(f.completedAt)}</span>
                {canDelete ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Delete followup"
                    onClick={() => setDeleteTarget(f)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this followup?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the reminder from the workspace for everyone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
