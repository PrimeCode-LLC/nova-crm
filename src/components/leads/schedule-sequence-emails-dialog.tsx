"use client";

import * as React from "react";
import { format } from "date-fns";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import type { Followup, Lead } from "@/lib/types";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  getActiveMailbox,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import {
  defaultScheduleDatetimeLocal,
  scheduleFollowupEmailClient,
  toDatetimeLocalValue,
} from "@/lib/schedule-followup-email-client";
import { formatTimezoneDisplayLabel, isoFromDatetimeLocalInZone } from "@/lib/org-timezone";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { canAutoScheduleFollowupEmail } from "@/lib/followup-plans";
import {
  autoFixScheduleDates,
  buildDemoMailboxDayLoads,
  fetchMailboxScheduleLoad,
  formatUtcDayLabel,
  projectStepCapacity,
  type MailboxDayLoadClient,
} from "@/lib/email/mailbox-schedule-capacity";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
import { GlobalEmailFooterPreview } from "@/components/leads/global-email-footer-preview";
import { ContactRecipientSelect } from "@/components/leads/contact-recipient-select";
import {
  buildContactRecipientOptions,
  defaultContactRecipientEmail,
} from "@/lib/email/contact-recipient-options";
import {
  loadLastUsedMailboxPrefs,
  rememberLastUsedMailbox,
  resolveDefaultScheduleMailboxId,
} from "@/lib/email/last-used-mailbox-prefs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type StepDraft = {
  followupId: string;
  title: string;
  subject: string;
  scheduledAt: string;
  body: string;
  included: boolean;
};

export function ScheduleSequenceEmailsDialog({
  open,
  onOpenChange,
  followups,
  lead,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followups: Followup[];
  lead: Lead;
  onScheduled: (
    followupId: string,
    schedule: { scheduledEmailId: string; emailScheduledAt: string },
  ) => void;
}) {
  const { isDemo, getContactById, currentUserId, organizationId } = useWorkspace();
  const contact = getContactById(lead.contactId);
  const recipientOptions = React.useMemo(
    () => buildContactRecipientOptions(lead, contact),
    [lead, contact],
  );
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const scheduled = useEmailAccountStore((s) => s.scheduled);
  const globalEmailFooter = useEmailAccountStore((s) => s.globalEmailFooter);

  const mailboxOptions = React.useMemo(() => {
    if (mailboxes.length > 0) return mailboxes;
    return [getActiveMailbox({ mailboxes, activeMailboxId })];
  }, [mailboxes, activeMailboxId]);

  const [mailboxId, setMailboxId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [steps, setSteps] = React.useState<StepDraft[]>([]);
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [includeFooter, setIncludeFooter] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [loadByDay, setLoadByDay] = React.useState<Record<string, MailboxDayLoadClient>>({});
  const [loadLimit, setLoadLimit] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loadLoading, setLoadLoading] = React.useState(false);

  const account = React.useMemo(() => {
    return (
      mailboxOptions.find((mb) => mb.id === mailboxId) ??
      getActiveMailbox({ mailboxes, activeMailboxId })
    );
  }, [mailboxOptions, mailboxId, mailboxes, activeMailboxId]);

  const timezone = useOrgTimezone();
  const timezoneLabel = formatTimezoneDisplayLabel(timezone);

  const schedulable = React.useMemo(
    () =>
      followups
        .filter((f) => canAutoScheduleFollowupEmail(f, lead.channel))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [followups, lead.channel],
  );

  React.useEffect(() => {
    if (!open) return;
    const prefs = loadLastUsedMailboxPrefs(organizationId, currentUserId);
    const defaultId = resolveDefaultScheduleMailboxId({
      mailboxIds: mailboxOptions.map((mb) => mb.id),
      lastUsedId: prefs.lastMailboxId,
      activeMailboxId,
    });
    setMailboxId(defaultId);
    setTo(defaultContactRecipientEmail(recipientOptions));
    setIncludeSignature(true);
    setIncludeFooter(true);
    setSteps(
      schedulable.map((f) => ({
        followupId: f.id,
        title: f.title,
        subject: f.emailSubject?.trim() || f.title,
        scheduledAt: defaultScheduleDatetimeLocal(f.dueAt, timezone),
        body: f.messageBody ?? "",
        included: true,
      })),
    );
    setSubmitting(false);
  }, [
    open,
    recipientOptions,
    mailboxOptions,
    activeMailboxId,
    schedulable,
    timezone,
    organizationId,
    currentUserId,
  ]);

  React.useEffect(() => {
    if (!open || !mailboxId) {
      setLoadByDay({});
      setLoadLimit(null);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    async function loadCapacity() {
      setLoadLoading(true);
      setLoadError(null);
      if (isDemo) {
        const demo = buildDemoMailboxDayLoads({
          scheduled,
          mailboxId,
          dailySendLimit: account.dailySendLimit,
        });
        if (!cancelled) {
          setLoadByDay(demo.byDay);
          setLoadLimit(demo.limit);
          setLoadLoading(false);
        }
        return;
      }
      const result = await fetchMailboxScheduleLoad({
        mailboxId,
        dataOwnerUid: account.dataOwnerUid,
      });
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        setLoadByDay({});
        setLoadLimit(account.dailySendLimit ?? null);
      } else {
        setLoadByDay(result.byDay);
        setLoadLimit(result.limit);
      }
      setLoadLoading(false);
    }
    void loadCapacity();
    return () => {
      cancelled = true;
    };
  }, [open, mailboxId, isDemo, scheduled, account.dailySendLimit, account.dataOwnerUid]);

  const capacity = React.useMemo(
    () =>
      projectStepCapacity({
        steps: steps.map((s) => ({
          id: s.followupId,
          scheduledAt: s.scheduledAt,
          included: s.included,
        })),
        byDay: loadByDay,
        limit: loadLimit,
      }),
    [steps, loadByDay, loadLimit],
  );

  const overLimit = capacity.overLimitStepIds.length > 0;

  function updateStep(id: string, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.followupId === id ? { ...s, ...patch } : s)));
  }

  function handleAutoFix() {
    const result = autoFixScheduleDates(
      steps.map((s) => ({
        id: s.followupId,
        scheduledAt: s.scheduledAt,
        included: s.included,
      })),
      loadByDay,
      loadLimit,
    );
    if (!result.changed && result.unresolvedIds.length === 0) {
      toast.message("Dates already fit within the daily limit");
      return;
    }
    setSteps((prev) =>
      prev.map((s) => {
        const fixed = result.steps.find((r) => r.id === s.followupId);
        return fixed ? { ...s, scheduledAt: fixed.scheduledAt } : s;
      }),
    );
    if (result.unresolvedIds.length > 0) {
      toast.error("Could not fit every step within 60 days", {
        description: "Raise the daily limit or use another mailbox.",
      });
    } else {
      toast.success("Moved over-limit steps to free days");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const selected = steps.filter((s) => s.included);
    if (selected.length === 0) {
      toast.error("Select at least one email to schedule");
      return;
    }
    if (!mailboxId) {
      toast.error("Pick a mailbox");
      return;
    }
    if (!to.trim()) {
      toast.error("Pick a recipient email");
      return;
    }
    if (overLimit) {
      toast.error("Some days are over the send limit", {
        description: "Change dates, use Auto-fix, or pick another mailbox.",
      });
      return;
    }

    setSubmitting(true);
    let okCount = 0;
    try {
      for (const step of selected) {
        const result = await scheduleFollowupEmailClient({
          followupId: step.followupId,
          leadId: lead.id,
          mailbox: account,
          to,
          subject: step.subject,
          body: step.body,
          includeSignature,
          globalEmailFooter,
          includeFooter,
          scheduledAtIso: isoFromDatetimeLocalInZone(step.scheduledAt, timezone),
          isDemo,
          addDemoScheduled: addScheduled,
        });
        if (!result.ok) {
          toast.error(result.error, { description: step.title });
          break;
        }
        onScheduled(step.followupId, {
          scheduledEmailId: result.scheduledEmailId,
          emailScheduledAt: result.emailScheduledAt,
        });
        okCount += 1;
      }
      if (okCount > 0) {
        rememberLastUsedMailbox(organizationId, currentUserId, account.id);
        toast.success(
          `Scheduled ${okCount} email${okCount === 1 ? "" : "s"}`,
          okCount < selected.length
            ? { description: "Stopped after an error - remaining steps not scheduled." }
            : undefined,
        );
        if (okCount === selected.length) onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Schedule all emails</DialogTitle>
            <DialogDescription>
              Queue every email-capable step from one mailbox. That mailbox&apos;s signature is
              appended to each email when scheduled.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {overLimit ? (
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                <AlertTriangle className="text-amber-700 dark:text-amber-400" />
                <AlertTitle>Daily send limit full</AlertTitle>
                <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
                  <p>
                    {capacity.overLimitDayKeys
                      .map((d) => `${formatUtcDayLabel(d)} UTC`)
                      .join(", ")}{" "}
                    {capacity.overLimitDayKeys.length === 1 ? "is" : "are"} at capacity for{" "}
                    {mailboxOptionLabel(account)}
                    {loadLimit != null ? ` (${loadLimit}/day)` : ""}. Change a date, use Auto-fix,
                    or pick another mailbox.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 border-amber-500/40 bg-background/60"
                    onClick={handleAutoFix}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    Auto-fix dates
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            {loadError ? (
              <p className="text-[11px] text-muted-foreground">
                Could not refresh capacity: {loadError}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="seq-schedule-from">From</Label>
              <Select
                value={mailboxId || undefined}
                onValueChange={(v) => {
                  if (v) setMailboxId(v);
                }}
              >
                <SelectTrigger id="seq-schedule-from" className="w-full">
                  <SelectValue placeholder="Select mailbox">
                    {account ? mailboxOptionLabel(account) : "Select mailbox"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {mailboxOptions.map((mb) => (
                    <SelectItem key={mb.id} value={mb.id}>
                      {mailboxOptionLabel(mb)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {loadLimit != null && !loadLoading ? (
                <p className="text-[11px] text-muted-foreground">
                  Daily limit {loadLimit} (UTC day). Capacity updates when you change the mailbox or
                  dates.
                </p>
              ) : null}
            </div>
            <MailboxSignaturePreview
              id="seq-include-mailbox-signature"
              signature={account.signature}
              includeSignature={includeSignature}
              onIncludeChange={setIncludeSignature}
              mailboxLabel={mailboxOptionLabel(account)}
            />
            <GlobalEmailFooterPreview
              id="seq-include-global-email-footer"
              footer={globalEmailFooter}
              includeFooter={includeFooter}
              onIncludeChange={setIncludeFooter}
            />
            <ContactRecipientSelect
              id="seq-schedule-to"
              options={recipientOptions}
              value={to}
              onValueChange={setTo}
              hint={
                recipientOptions.some((o) => o.kind === "personal")
                  ? "Defaults to company email. Switch to personal if the company address bounces."
                  : undefined
              }
            />
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No email steps ready to schedule.
              </p>
            ) : (
              <ul className="space-y-3">
                {steps.map((s, i) => {
                  const info = capacity.byStepId[s.followupId];
                  const stepOver = Boolean(s.included && info?.overLimit);
                  return (
                    <li
                      key={s.followupId}
                      className={
                        stepOver
                          ? "rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2"
                          : "rounded-md border p-3 space-y-2"
                      }
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={s.included}
                          onChange={(e) => updateStep(s.followupId, { included: e.target.checked })}
                          aria-label={`Include ${s.title}`}
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          Step {i + 1}
                        </span>
                        <span className="text-sm font-medium truncate">{s.title}</span>
                      </div>
                      <div className="grid gap-1.5 pl-6">
                        <Label className="text-[10px] text-muted-foreground">Subject</Label>
                        <Input
                          value={s.subject}
                          onChange={(e) => updateStep(s.followupId, { subject: e.target.value })}
                          className="h-8 text-xs"
                          disabled={!s.included}
                        />
                        <Label className="text-[10px] text-muted-foreground">
                          Send at · {timezoneLabel}
                        </Label>
                        <Input
                          type="datetime-local"
                          value={s.scheduledAt}
                          min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                          onChange={(e) => updateStep(s.followupId, { scheduledAt: e.target.value })}
                          className={
                            stepOver
                              ? "h-8 text-xs border-amber-500/50 focus-visible:ring-amber-500/40"
                              : "h-8 text-xs"
                          }
                          disabled={!s.included}
                        />
                        {s.included && s.scheduledAt ? (
                          <p
                            className={
                              stepOver
                                ? "text-[10px] text-amber-800 dark:text-amber-300"
                                : "text-[10px] text-muted-foreground"
                            }
                          >
                            {format(new Date(s.scheduledAt), "MMM d, yyyy 'at' h:mm a")} ·{" "}
                            {timezoneLabel}
                            {loadLimit != null && info ? (
                              <>
                                {" "}
                                · UTC {info.dayKey}
                                {stepOver
                                  ? ` · over limit (${info.booked}/${loadLimit} booked)`
                                  : info.remainingBefore != null
                                    ? ` · ${info.remainingBefore} slot${info.remainingBefore === 1 ? "" : "s"} left`
                                    : ""}
                              </>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                submitting ||
                !to.trim() ||
                steps.every((s) => !s.included) ||
                overLimit
              }
            >
              {submitting
                ? "Scheduling…"
                : `Schedule ${steps.filter((s) => s.included).length} email${steps.filter((s) => s.included).length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
