"use client";

import * as React from "react";
import { CalendarClock, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  getActiveMailbox,
  isEmailAccountConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import {
  assignProspectSchedule,
  loadMailboxCapacityStates,
  type MailboxCapacityState,
} from "@/lib/email/bulk-mailbox-assign";
import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import {
  loadLastUsedMailboxPrefs,
  rememberLastUsedMailboxPool,
  resolveDefaultScheduleMailboxPool,
} from "@/lib/email/last-used-mailbox-prefs";
import {
  canAutoScheduleFollowupEmail,
  getActiveFollowupPlanForLead,
  openFollowupsForPlan,
  resolveFollowupChannel,
} from "@/lib/followup-plans";
import {
  defaultScheduleDatetimeLocal,
  scheduleFollowupEmailClient,
} from "@/lib/schedule-followup-email-client";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
import { GlobalEmailFooterPreview } from "@/components/leads/global-email-footer-preview";
import { cn } from "@/lib/utils";

type RowStatus = "pending" | "running" | "success" | "skipped" | "failed";

type LeadRow = {
  leadId: string;
  label: string;
  status: RowStatus;
  detail?: string;
};

type PreflightBucket = "ready" | "already_scheduled" | "skipped";

function mailboxOptionLabel(mb: EmailMailboxSettings): string {
  const label = mb.label?.trim();
  const email = mb.emailAddress?.trim();
  if (label && email) return `${label} · ${email}`;
  if (email) return email;
  if (label) return label;
  const name = mb.displayName?.trim();
  if (name) return name;
  return "Mailbox";
}

function leadLabel(lead: { contactName?: string; companyName?: string; id: string }): string {
  const name = lead.contactName?.trim();
  const company = lead.companyName?.trim();
  if (name && company) return `${name} · ${company}`;
  return name || company || lead.id;
}

export function BulkScheduleSequencesDialog({
  open,
  onOpenChange,
  leadIds,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadIds: string[];
  onComplete?: () => void;
}) {
  const {
    isDemo,
    leads,
    followups,
    followupPlans,
    getContactById,
    setFollowupEmailSchedule,
    currentUserId,
    organizationId,
  } = useWorkspace();

  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);

  const sendableMailboxes = React.useMemo(() => {
    const list = mailboxes.length > 0 ? mailboxes : [getActiveMailbox({ mailboxes, activeMailboxId })];
    if (isDemo) return list;
    return list.filter((mb) => isEmailAccountConfigured(mb));
  }, [mailboxes, activeMailboxId, isDemo]);

  const [phase, setPhase] = React.useState<"setup" | "running" | "done">("setup");
  const [selectedMailboxIds, setSelectedMailboxIds] = React.useState<string[]>([]);
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [includeFooter, setIncludeFooter] = React.useState(true);
  const [rows, setRows] = React.useState<LeadRow[]>([]);
  const [progressIndex, setProgressIndex] = React.useState(0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const cancelRef = React.useRef(false);

  const classifyLead = React.useCallback(
    (leadId: string): { bucket: PreflightBucket; reason?: string } => {
      const lead = leads.find((l) => l.id === leadId);
      if (!lead) return { bucket: "skipped", reason: "Lead not found" };
      if (lead.doNotContact) return { bucket: "skipped", reason: "Do not contact" };

      const plan = getActiveFollowupPlanForLead(followupPlans, leadId);
      if (!plan) return { bucket: "skipped", reason: "No active sequence" };

      const contact = getContactById(lead.contactId);
      const recipient = defaultContactRecipientEmail(
        buildContactRecipientOptions(lead, contact),
      );
      if (!recipient) return { bucket: "skipped", reason: "No recipient email" };

      const openSteps = openFollowupsForPlan(followups, plan.id);
      const readySteps = openSteps.filter((f) => canAutoScheduleFollowupEmail(f, lead.channel));
      if (readySteps.length > 0) return { bucket: "ready" };

      // Email-capable steps that are already queued (canAutoSchedule excludes scheduledEmailId).
      const emailCapableQueued = openSteps.filter((f) => {
        if (!f.messageBody?.trim() || !f.scheduledEmailId) return false;
        if (f.pausedAt || f.completedAt) return false;
        const ch = resolveFollowupChannel(f.channel, lead.channel);
        return !(
          ch === "linkedin_outbound" ||
          ch === "linkedin_1to1" ||
          ch === "upwork" ||
          ch === "job_apply"
        );
      });
      if (emailCapableQueued.length > 0) {
        return { bucket: "already_scheduled" };
      }
      return { bucket: "skipped", reason: "No email steps to schedule" };
    },
    [leads, followupPlans, followups, getContactById],
  );

  const preflight = React.useMemo(() => {
    let ready = 0;
    let already = 0;
    let skipped = 0;
    for (const id of leadIds) {
      const c = classifyLead(id);
      if (c.bucket === "ready") ready += 1;
      else if (c.bucket === "already_scheduled") already += 1;
      else skipped += 1;
    }
    return { ready, already, skipped };
  }, [leadIds, classifyLead]);

  React.useEffect(() => {
    if (!open) return;
    cancelRef.current = false;
    setPhase("setup");
    setIncludeSignature(true);
    setIncludeFooter(true);
    setLoadError(null);
    setProgressIndex(0);
    const prefs = loadLastUsedMailboxPrefs(organizationId, currentUserId);
    const defaults = resolveDefaultScheduleMailboxPool({
      mailboxIds: sendableMailboxes.map((m) => m.id),
      lastPoolIds: prefs.lastMailboxPoolIds,
    });
    setSelectedMailboxIds(defaults);
    setRows(
      leadIds.map((id) => {
        const lead = leads.find((l) => l.id === id);
        return {
          leadId: id,
          label: lead ? leadLabel(lead) : id,
          status: "pending" as const,
        };
      }),
    );
  }, [open, leadIds, leads, sendableMailboxes, organizationId, currentUserId]);

  function toggleMailbox(id: string, checked: boolean) {
    setSelectedMailboxIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  function patchRow(leadId: string, patch: Partial<LeadRow>) {
    setRows((prev) => prev.map((r) => (r.leadId === leadId ? { ...r, ...patch } : r)));
  }

  async function runBatch() {
    const selected = sendableMailboxes.filter((m) => selectedMailboxIds.includes(m.id));
    if (selected.length === 0) {
      toast.error("Select at least one mailbox");
      return;
    }
    if (preflight.ready === 0) {
      toast.error("No prospects are ready to schedule");
      return;
    }

    cancelRef.current = false;
    setPhase("running");
    setProgressIndex(0);
    setLoadError(null);
    rememberLastUsedMailboxPool(
      organizationId,
      currentUserId,
      selected.map((m) => m.id),
    );

    const loaded = await loadMailboxCapacityStates({
      mailboxes: selected,
      isDemo,
      scheduled,
    });
    if (!loaded.ok) {
      setLoadError(loaded.error);
      setPhase("setup");
      toast.error(loaded.error);
      return;
    }

    let states: MailboxCapacityState[] = loaded.states;
    let rr = 0;
    let success = 0;
    let skipped = 0;
    let failed = 0;
    const mailboxById = new Map(selected.map((m) => [m.id, m]));

    for (let i = 0; i < leadIds.length; i++) {
      if (cancelRef.current) {
        for (let j = i; j < leadIds.length; j++) {
          patchRow(leadIds[j]!, { status: "skipped", detail: "Cancelled" });
          skipped += 1;
        }
        break;
      }

      const leadId = leadIds[i]!;
      setProgressIndex(i + 1);
      patchRow(leadId, { status: "running", detail: undefined });

      const classified = classifyLead(leadId);
      if (classified.bucket !== "ready") {
        patchRow(leadId, {
          status: classified.bucket === "already_scheduled" ? "skipped" : "skipped",
          detail:
            classified.bucket === "already_scheduled"
              ? "Already scheduled"
              : classified.reason ?? "Skipped",
        });
        skipped += 1;
        continue;
      }

      const lead = leads.find((l) => l.id === leadId)!;
      const plan = getActiveFollowupPlanForLead(followupPlans, leadId)!;
      const contact = getContactById(lead.contactId);
      const to = defaultContactRecipientEmail(buildContactRecipientOptions(lead, contact));
      const schedulable = openFollowupsForPlan(followups, plan.id)
        .filter((f) => canAutoScheduleFollowupEmail(f, lead.channel))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

      const draftSteps = schedulable.map((f) => ({
        id: f.id,
        scheduledAt: defaultScheduleDatetimeLocal(f.dueAt),
        included: true,
      }));

      const assigned = assignProspectSchedule({
        states,
        steps: draftSteps,
        roundRobinIndex: rr,
      });
      rr = assigned.nextRoundRobinIndex;
      states = assigned.nextStates;

      if (!assigned.ok) {
        patchRow(leadId, {
          status: "failed",
          detail: assigned.error,
        });
        failed += 1;
        continue;
      }

      const mailbox = mailboxById.get(assigned.mailboxId);
      if (!mailbox) {
        patchRow(leadId, { status: "failed", detail: "Mailbox missing" });
        failed += 1;
        continue;
      }

      let okCount = 0;
      let lastError = "";
      for (const step of assigned.steps.filter((s) => s.included)) {
        const followup = schedulable.find((f) => f.id === step.id);
        if (!followup) continue;
        const result = await scheduleFollowupEmailClient({
          followupId: followup.id,
          leadId: lead.id,
          mailbox,
          to,
          subject: followup.emailSubject?.trim() || followup.title,
          body: followup.messageBody ?? "",
          includeSignature,
          globalEmailFooter,
          includeFooter,
          scheduledAtIso: new Date(step.scheduledAt).toISOString(),
          isDemo,
          addDemoScheduled: addScheduled,
        });
        if (!result.ok) {
          lastError = result.error;
          break;
        }
        setFollowupEmailSchedule(followup.id, {
          scheduledEmailId: result.scheduledEmailId,
          emailScheduledAt: result.emailScheduledAt,
        });
        okCount += 1;
      }

      if (okCount === 0) {
        patchRow(leadId, {
          status: "failed",
          detail: lastError || "Could not schedule",
        });
        failed += 1;
        continue;
      }

      patchRow(leadId, {
        status: "success",
        detail: `${okCount} email${okCount === 1 ? "" : "s"} · ${mailboxOptionLabel(mailbox)}${
          okCount < schedulable.length ? " (partial)" : ""
        }`,
      });
      success += 1;
    }

    setPhase("done");
    toast.success(
      `Scheduled ${success} prospect${success === 1 ? "" : "s"}`,
      skipped || failed
        ? { description: `${skipped} skipped · ${failed} failed` }
        : undefined,
    );
    if (failed === 0 && success > 0) {
      onComplete?.();
    }
  }

  function handleClose(next: boolean) {
    if (phase === "running") return;
    onOpenChange(next);
  }

  const successCount = rows.filter((r) => r.status === "success").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  const signatureMailbox =
    sendableMailboxes.find((m) => m.id === selectedMailboxIds[0]) ?? sendableMailboxes[0];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="h-4 w-4 text-primary" />
            Schedule sequences
          </DialogTitle>
          <DialogDescription className="text-xs">
            Queue email steps from existing active sequences across selected inboxes, using each
            mailbox&apos;s daily send limit.
          </DialogDescription>
        </DialogHeader>

        {phase === "setup" ? (
          <div className="space-y-4 py-1">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
              <p>
                <span className="font-medium">{preflight.ready}</span> ready to schedule
              </p>
              <p className="text-muted-foreground">
                {preflight.already} already scheduled · {preflight.skipped} skipped
              </p>
            </div>

            {sendableMailboxes.length === 0 ? (
              <p className="text-sm text-destructive">
                No send-capable mailboxes. Configure SMTP in Settings → Email.
              </p>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Mailboxes</Label>
                <ul className="space-y-2 rounded-md border p-2">
                  {sendableMailboxes.map((mb) => {
                    const checked = selectedMailboxIds.includes(mb.id);
                    return (
                      <li key={mb.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleMailbox(mb.id, v === true)}
                          id={`bulk-sched-mb-${mb.id}`}
                        />
                        <label
                          htmlFor={`bulk-sched-mb-${mb.id}`}
                          className="cursor-pointer truncate"
                        >
                          {mailboxOptionLabel(mb)}
                          {mb.dailySendLimit != null ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {mb.dailySendLimit}/day
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {signatureMailbox ? (
              <MailboxSignaturePreview
                id="bulk-sched-include-signature"
                signature={signatureMailbox.signature}
                includeSignature={includeSignature}
                onIncludeChange={setIncludeSignature}
                mailboxLabel={mailboxOptionLabel(signatureMailbox)}
              />
            ) : null}
            <GlobalEmailFooterPreview
              id="bulk-sched-include-footer"
              footer={globalEmailFooter}
              includeFooter={includeFooter}
              onIncludeChange={setIncludeFooter}
            />

            {loadError ? (
              <p className="text-xs text-destructive">{loadError}</p>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  selectedMailboxIds.length === 0 ||
                  preflight.ready === 0 ||
                  sendableMailboxes.length === 0
                }
                onClick={() => void runBatch()}
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Schedule {preflight.ready} ready
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {phase === "running" || phase === "done" ? (
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              {phase === "running"
                ? `Scheduling ${progressIndex} / ${leadIds.length}…`
                : `Done · ${successCount} scheduled · ${skippedCount} skipped · ${failedCount} failed`}
            </p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {rows.map((row) => (
                <li
                  key={row.leadId}
                  className="flex items-start gap-2 rounded px-1.5 py-1 text-xs"
                >
                  {row.status === "running" || row.status === "pending" ? (
                    <Loader2
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground",
                        row.status === "running" && "animate-spin text-primary",
                      )}
                    />
                  ) : row.status === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <XCircle
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        row.status === "skipped"
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{row.label}</p>
                    {row.detail ? (
                      <p className="text-[11px] text-muted-foreground">{row.detail}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <DialogFooter className="gap-2 sm:justify-between">
              {phase === "running" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  Stop after current
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              )}
              <span />
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
