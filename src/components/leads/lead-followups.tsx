"use client";

import * as React from "react";
import { format } from "date-fns";
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
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Followup, Lead } from "@/lib/types";
import { CHANNEL_LIST, PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserChip } from "@/components/common/user-chip";
import {
  NewFollowupDialog,
  type FollowupEditableFields,
} from "@/components/followups/new-followup-dialog";
import {
  SuggestFollowupsDialog,
  type LeadFollowupAiContext,
} from "@/components/ai/suggest-followups-dialog";
import { FollowupPlanPausedBanner } from "@/components/leads/followup-plan-paused-banner";
import { ScheduleFollowupEmailDialog } from "@/components/leads/schedule-followup-email-dialog";
import { ScheduleSequenceEmailsDialog } from "@/components/leads/schedule-sequence-emails-dialog";
import {
  canAutoScheduleFollowupEmail,
  getActiveFollowupPlanForLead,
  getPausedFollowupPlanForLead,
  mergeFollowupPlans,
  sequenceModeLabel,
} from "@/lib/followup-plans";
import type { FollowupPlan } from "@/lib/types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { canMutateFollowup } from "@/lib/can-mutate-followup";
import { cancelScheduledEmailClient } from "@/lib/cancel-followup-scheduled-email-client";
import {
  getActiveMailbox,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import {
  globalEmailFooterTrimmed,
  mailboxSignatureTrimmed,
} from "@/lib/email/append-mailbox-signature";
import { toast } from "sonner";

function channelBadgeLabel(channel: Followup["channel"]): string | null {
  if (!channel || channel === "other") return null;
  return CHANNEL_LIST.find((c) => c.key === channel)?.label ?? channel;
}

/**
 * Shows how mailbox signature + shared footer will sit under the draft body
 * (same blank-line gap as schedule/send append).
 */
function OutboundTrailersPreview() {
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);
  const mailbox = getActiveMailbox({ mailboxes, activeMailboxId });
  const signature = mailboxSignatureTrimmed(mailbox.signature);
  const footer = globalEmailFooterTrimmed(globalEmailFooter);
  const mailboxLabel =
    mailbox.label?.trim() ||
    mailbox.emailAddress?.trim() ||
    mailbox.displayName?.trim() ||
    "Active mailbox";

  return (
    <div
      className="rounded-md border border-dashed border-muted-foreground/25 bg-muted/10 px-2.5 py-2"
      aria-label="Outbound email preview trailers"
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
        How it lands in inbox · {mailboxLabel}
      </p>
      {/* Blank line after body — matches `\n\n` before signature at schedule time */}
      <div className="h-5 border-t border-dotted border-muted-foreground/20" aria-hidden />
      {signature ? (
        <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground/90">
          {signature}
        </pre>
      ) : (
        <div className="space-y-1">
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground/50 italic">
            {`Best regards,\nYour Name\nTitle · Company`}
          </pre>
          <p className="text-[10px] text-amber-700 dark:text-amber-400">
            Placeholder — set a real signature in Settings → Email
          </p>
        </div>
      )}
      {footer ? (
        <>
          <div className="h-5 border-t border-dotted border-muted-foreground/20 mt-2" aria-hidden />
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground/80">
            {footer}
          </pre>
        </>
      ) : null}
    </div>
  );
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
  onEdit,
  onDelete,
  canMutate,
  onSchedule,
  onCancelSchedule,
  cancellingSchedule,
  stepIndex,
  leadChannel,
}: {
  f: Followup;
  overdue: boolean;
  onComplete: (done: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  canMutate: boolean;
  onSchedule: () => void;
  onCancelSchedule: () => void;
  cancellingSchedule: boolean;
  stepIndex?: number;
  leadChannel: Lead["channel"];
}) {
  const [expanded, setExpanded] = React.useState(false);
  const chLabel = channelBadgeLabel(f.channel);
  const isScheduled = Boolean(f.scheduledEmailId && f.emailScheduledAt);
  const channelSupportsEmail = canAutoScheduleFollowupEmail(
    { ...f, scheduledEmailId: undefined, completedAt: undefined, pausedAt: undefined },
    leadChannel,
  );
  const canScheduleNow = canAutoScheduleFollowupEmail(f, leadChannel);

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
            {stepIndex != null ? (
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Step {stepIndex}
              </span>
            ) : null}
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
            {isScheduled && (
              <Badge variant="outline" className="text-[10px] gap-1 border-sky-500/40 text-sky-700 dark:text-sky-400">
                <CalendarClock className="h-2.5 w-2.5" />
                Scheduled
                {f.emailScheduledAt
                  ? ` ${format(new Date(f.emailScheduledAt), "MMM d, h:mm a")}`
                  : ""}
              </Badge>
            )}
            {!isScheduled && !f.pausedAt && channelSupportsEmail && f.messageBody ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Email-ready
              </Badge>
            ) : null}
            {!channelSupportsEmail && f.messageBody && !isScheduled ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Reminder + copy
              </Badge>
            ) : null}
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
          {f.emailSubject && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              Subject: {f.emailSubject}
            </p>
          )}
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
          {canMutate ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="Edit followup"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
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
            </>
          ) : null}
        </div>
      </div>
      {expanded && f.messageBody && (
        <div className="mt-2 ml-9 space-y-2 border-t pt-2">
          <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/90 max-h-52 overflow-y-auto">
            {f.messageBody}
          </pre>
          {channelSupportsEmail ? <OutboundTrailersPreview /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <CopyBodyButton text={f.messageBody} />
            {isScheduled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={cancellingSchedule}
                onClick={onCancelSchedule}
              >
                {cancellingSchedule ? "Cancelling…" : "Cancel schedule"}
              </Button>
            ) : canScheduleNow ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onSchedule}
              >
                <CalendarClock className="h-3 w-3" /> Schedule
              </Button>
            ) : null}
          </div>
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
  const [editTarget, setEditTarget] = React.useState<Followup | null>(null);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [regeneratePlan, setRegeneratePlan] = React.useState<FollowupPlan | undefined>();
  const [dismissedPlanId, setDismissedPlanId] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Followup | null>(null);
  const [scheduleTarget, setScheduleTarget] = React.useState<Followup | null>(null);
  const [scheduleAllOpen, setScheduleAllOpen] = React.useState(false);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  /** Live optimistic schedule chip until Firestore listener catches up (or clears after send). */
  const [optimisticSchedule, setOptimisticSchedule] = React.useState<
    Record<string, { scheduledEmailId: string; emailScheduledAt: string } | null>
  >({});
  const {
    addFollowup,
    createFollowupPlanWithFollowups,
    supersedeFollowupPlan,
    setFollowupCompleted,
    setFollowupEmailSchedule,
    clearFollowupEmailSchedule,
    removeFollowup,
    updateFollowup,
    currentUserId,
    leads,
    users,
    isDemo,
    followupPlans,
  } = useWorkspace();

  const scheduledEmails = useEmailAccountStore((s) => s.scheduled);
  const cancelScheduled = useEmailAccountStore((s) => s.cancelScheduled);
  const viewer = users.find((u) => u.id === currentUserId);

  const plans = React.useMemo(
    () => mergeFollowupPlans(followupPlans, followups),
    [followupPlans, followups],
  );
  const activePlan = React.useMemo(
    () => getActiveFollowupPlanForLead(plans, lead.id),
    [plans, lead.id],
  );
  const pausedPlan = React.useMemo(
    () => getPausedFollowupPlanForLead(plans, lead.id),
    [plans, lead.id],
  );
  const showPausedBanner =
    pausedPlan && pausedPlan.id !== dismissedPlanId && !regeneratePlan;

  const displayFollowups = React.useMemo(() => {
    return followups.map((f) => {
      if (!Object.prototype.hasOwnProperty.call(optimisticSchedule, f.id)) return f;
      const o = optimisticSchedule[f.id];
      if (o === null) {
        return { ...f, scheduledEmailId: undefined, emailScheduledAt: undefined };
      }
      return {
        ...f,
        scheduledEmailId: o.scheduledEmailId,
        emailScheduledAt: o.emailScheduledAt,
      };
    });
  }, [followups, optimisticSchedule]);

  React.useEffect(() => {
    setOptimisticSchedule((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        const o = prev[id];
        const f = followups.find((x) => x.id === id);
        if (!f) continue;
        if (o === null && !f.scheduledEmailId) {
          delete next[id];
          changed = true;
        } else if (
          o &&
          f.scheduledEmailId === o.scheduledEmailId &&
          f.emailScheduledAt === o.emailScheduledAt
        ) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [followups]);

  const open = displayFollowups.filter((f) => !f.completedAt);
  const done = displayFollowups.filter((f) => f.completedAt);

  const planOpen = React.useMemo(() => {
    if (!activePlan) return [];
    return open
      .filter((f) => f.planId === activePlan.id)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }, [activePlan, open]);

  const reminderOpen = React.useMemo(() => {
    if (!activePlan) return open;
    return open.filter((f) => f.planId !== activePlan.id);
  }, [activePlan, open]);

  const scheduleAllCandidates = React.useMemo(
    () => planOpen.filter((f) => canAutoScheduleFollowupEmail(f, lead.channel)),
    [planOpen, lead.channel],
  );

  function canMutateRow(f: Followup): boolean {
    return canMutateFollowup({
      currentUserId,
      viewer,
      lead,
      followup: f,
    });
  }

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

  // Demo cleanup: clear schedule link once the queued email is no longer pending.
  React.useEffect(() => {
    if (!isDemo) return;
    for (const f of displayFollowups) {
      if (!f.scheduledEmailId) continue;
      const row = scheduledEmails.find((s) => s.id === f.scheduledEmailId);
      if (!row || row.status === "pending" || row.status === "processing") continue;
      clearFollowupEmailSchedule(f.id);
      setOptimisticSchedule((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, f.id)) return prev;
        const next = { ...prev };
        delete next[f.id];
        return next;
      });
    }
  }, [isDemo, displayFollowups, scheduledEmails, clearFollowupEmailSchedule]);

  function applyScheduleOptimistic(
    id: string,
    schedule: { scheduledEmailId: string; emailScheduledAt: string } | null,
  ) {
    setFollowupEmailSchedule(id, schedule);
    if (!isDemo) {
      setOptimisticSchedule((prev) => ({ ...prev, [id]: schedule }));
    }
  }

  async function cancelLinkedSchedule(f: Followup): Promise<boolean> {
    if (!f.scheduledEmailId) return true;
    const result = await cancelScheduledEmailClient({
      scheduledEmailId: f.scheduledEmailId,
      isDemo,
      cancelDemo: cancelScheduled,
    });
    if ("error" in result) {
      toast.error(result.error);
      return false;
    }
    applyScheduleOptimistic(f.id, null);
    return true;
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (target.scheduledEmailId) {
      const ok = await cancelLinkedSchedule(target);
      if (!ok) return;
    }
    removeFollowup(target.id);
    toast.success("Followup deleted");
  }

  async function handleUpdate(id: string, patch: Partial<FollowupEditableFields>) {
    const existing = displayFollowups.find((f) => f.id === id);
    const dueChanged =
      patch.dueAt !== undefined && existing != null && patch.dueAt !== existing.dueAt;
    const bodyChanged =
      patch.messageBody !== undefined &&
      existing != null &&
      (patch.messageBody || undefined) !== (existing.messageBody || undefined);
    if (existing?.scheduledEmailId && (dueChanged || bodyChanged)) {
      const ok = await cancelLinkedSchedule(existing);
      if (!ok) return;
    }
    updateFollowup(id, patch);
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

  async function handleCancelSchedule(f: Followup) {
    if (!f.scheduledEmailId) return;
    setCancellingId(f.id);
    try {
      const ok = await cancelLinkedSchedule(f);
      if (ok) toast.success("Schedule cancelled");
    } finally {
      setCancellingId(null);
    }
  }

  function renderOpenRow(f: Followup, stepIndex?: number) {
    const due = new Date(f.dueAt);
    const overdue = due.getTime() < Date.now();
    const mutate = canMutateRow(f);
    return (
      <FollowupRow
        key={f.id}
        f={f}
        overdue={overdue}
        stepIndex={stepIndex}
        leadChannel={lead.channel}
        onComplete={(done) => setFollowupCompleted(f.id, done)}
        onEdit={() => setEditTarget(f)}
        onDelete={() => setDeleteTarget(f)}
        canMutate={mutate}
        onSchedule={() => setScheduleTarget(f)}
        onCancelSchedule={() => void handleCancelSchedule(f)}
        cancellingSchedule={cancellingId === f.id}
      />
    );
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
          <p className="text-sm font-medium">Reminders & sequences</p>
          <p className="text-xs text-muted-foreground">
            One-off reminders, or AI sequences you can edit, verify, and schedule — email
            autopilot or copy-ready steps for LinkedIn and other channels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" type="button" variant="outline" onClick={() => openSuggest()}>
            <Sparkles className="h-3.5 w-3.5" /> Build sequence
          </Button>
          <Button size="sm" type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add reminder
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

      <NewFollowupDialog
        open={editTarget != null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        leads={leads}
        currentUserId={currentUserId}
        fixedLeadId={lead.id}
        editFollowup={editTarget}
        onUpdate={(id, patch) => {
          void handleUpdate(id, patch);
        }}
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

      <ScheduleFollowupEmailDialog
        open={scheduleTarget != null}
        onOpenChange={(o) => {
          if (!o) setScheduleTarget(null);
        }}
        followup={scheduleTarget}
        lead={lead}
        onScheduled={(followupId, schedule) => {
          applyScheduleOptimistic(followupId, schedule);
        }}
      />

      <ScheduleSequenceEmailsDialog
        open={scheduleAllOpen}
        onOpenChange={setScheduleAllOpen}
        followups={planOpen}
        lead={lead}
        onScheduled={(followupId, schedule) => {
          applyScheduleOptimistic(followupId, schedule);
        }}
      />

      {activePlan && planOpen.length > 0 ? (
        <div className="rounded-md border bg-card/50 p-3 space-y-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium">Active sequence</p>
                <Badge variant="secondary" className="text-[10px]">
                  {sequenceModeLabel(activePlan.sequenceMode)}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {planOpen.length} step{planOpen.length === 1 ? "" : "s"}
                </Badge>
              </div>
              {activePlan.planSummary ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {activePlan.planSummary}
                </p>
              ) : null}
            </div>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onClick={() => setScheduleAllOpen(true)}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule all emails
              {scheduleAllCandidates.length > 0
                ? ` (${scheduleAllCandidates.length})`
                : ""}
            </Button>
          </div>
          <ul className="space-y-2">{planOpen.map((f, i) => renderOpenRow(f, i + 1))}</ul>
        </div>
      ) : null}

      {reminderOpen.length > 0 ? (
        <div className="space-y-2">
          {activePlan && planOpen.length > 0 ? (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Reminders
            </p>
          ) : null}
          <ul className="space-y-2">{reminderOpen.map((f) => renderOpenRow(f))}</ul>
        </div>
      ) : null}

      {open.length === 0 && (
        <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          <CalendarClock className="mx-auto h-5 w-5 mb-2 opacity-60" />
          No open reminders or sequences. Add a reminder or build a personalized sequence.
        </div>
      )}

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
                {canMutateRow(f) ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      aria-label="Edit followup"
                      onClick={() => setEditTarget(f)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
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
                  </>
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
              This removes the reminder from the workspace for everyone
              {deleteTarget?.scheduledEmailId
                ? " and cancels any pending scheduled email."
                : "."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
