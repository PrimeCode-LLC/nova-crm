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
import { formatBrowserTimezoneLabel } from "@/lib/scheduling/timezone-options";
import {
  autoFixScheduleDates,
  buildDemoMailboxDayLoads,
  fetchMailboxScheduleLoad,
  formatUtcDayLabel,
  projectStepCapacity,
  type MailboxDayLoadClient,
} from "@/lib/email/mailbox-schedule-capacity";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export function ScheduleFollowupEmailDialog({
  open,
  onOpenChange,
  followup,
  lead,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followup: Followup | null;
  lead: Lead;
  onScheduled: (
    followupId: string,
    schedule: { scheduledEmailId: string; emailScheduledAt: string },
  ) => void;
}) {
  const { isDemo } = useWorkspace();
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);
  const scheduled = useEmailAccountStore((s) => s.scheduled);

  const mailboxOptions = React.useMemo(() => {
    if (mailboxes.length > 0) return mailboxes;
    return [getActiveMailbox({ mailboxes, activeMailboxId })];
  }, [mailboxes, activeMailboxId]);

  const [mailboxId, setMailboxId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [scheduledAt, setScheduledAt] = React.useState("");
  const [body, setBody] = React.useState("");
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [loadByDay, setLoadByDay] = React.useState<Record<string, MailboxDayLoadClient>>({});
  const [loadLimit, setLoadLimit] = React.useState<number | null>(null);

  const account = React.useMemo(() => {
    return (
      mailboxOptions.find((mb) => mb.id === mailboxId) ??
      getActiveMailbox({ mailboxes, activeMailboxId })
    );
  }, [mailboxOptions, mailboxId, mailboxes, activeMailboxId]);

  const timezoneLabel = formatBrowserTimezoneLabel();

  React.useEffect(() => {
    if (!open || !followup) return;
    const defaultId =
      mailboxOptions.find((mb) => mb.id === activeMailboxId)?.id ?? mailboxOptions[0]?.id ?? "";
    setMailboxId(defaultId);
    setTo(lead.contactEmail?.trim() ?? "");
    setSubject(followup.emailSubject?.trim() || followup.title || "");
    setScheduledAt(defaultScheduleDatetimeLocal(followup.dueAt));
    setBody(followup.messageBody ?? "");
    setIncludeSignature(true);
    setSubmitting(false);
  }, [open, followup, lead.contactEmail, mailboxOptions, activeMailboxId]);

  React.useEffect(() => {
    if (!open || !mailboxId) {
      setLoadByDay({});
      setLoadLimit(null);
      return;
    }
    let cancelled = false;
    async function loadCapacity() {
      if (isDemo) {
        const demo = buildDemoMailboxDayLoads({
          scheduled,
          mailboxId,
          dailySendLimit: account.dailySendLimit,
        });
        if (!cancelled) {
          setLoadByDay(demo.byDay);
          setLoadLimit(demo.limit);
        }
        return;
      }
      const result = await fetchMailboxScheduleLoad({
        mailboxId,
        dataOwnerUid: account.dataOwnerUid,
      });
      if (cancelled) return;
      if (result.ok) {
        setLoadByDay(result.byDay);
        setLoadLimit(result.limit);
      } else {
        setLoadByDay({});
        setLoadLimit(account.dailySendLimit ?? null);
      }
    }
    void loadCapacity();
    return () => {
      cancelled = true;
    };
  }, [open, mailboxId, isDemo, scheduled, account.dailySendLimit, account.dataOwnerUid]);

  const capacity = React.useMemo(
    () =>
      projectStepCapacity({
        steps: [{ id: "single", scheduledAt, included: Boolean(scheduledAt) }],
        byDay: loadByDay,
        limit: loadLimit,
      }),
    [scheduledAt, loadByDay, loadLimit],
  );

  const info = capacity.byStepId.single;
  const overLimit = Boolean(info?.overLimit);

  function handleAutoFix() {
    const result = autoFixScheduleDates(
      [{ id: "single", scheduledAt, included: true }],
      loadByDay,
      loadLimit,
    );
    const next = result.steps[0]?.scheduledAt;
    if (!next || (!result.changed && result.unresolvedIds.length === 0)) {
      toast.message("Date already fits within the daily limit");
      return;
    }
    if (result.unresolvedIds.length > 0) {
      toast.error("No free day within 60 days", {
        description: "Raise the daily limit or use another mailbox.",
      });
      return;
    }
    setScheduledAt(next);
    toast.success("Moved to the next free day");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!followup) return;
    if (overLimit) {
      toast.error("That day is over the send limit", {
        description: "Change the date, use Auto-fix, or pick another mailbox.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await scheduleFollowupEmailClient({
        followupId: followup.id,
        leadId: lead.id,
        mailbox: account,
        to,
        subject,
        body,
        includeSignature,
        scheduledAtIso: new Date(scheduledAt).toISOString(),
        isDemo,
        addDemoScheduled: addScheduled,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onScheduled(followup.id, {
        scheduledEmailId: result.scheduledEmailId,
        emailScheduledAt: result.emailScheduledAt,
      });
      toast.success(isDemo ? "Email scheduled (demo)" : "Email scheduled", {
        description: isDemo
          ? `Will move to Sent after ${format(new Date(result.emailScheduledAt), "MMM d, h:mm a")}.`
          : `Sending ${format(new Date(result.emailScheduledAt), "MMM d, yyyy 'at' h:mm a")}`,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Schedule email</DialogTitle>
            <DialogDescription>
              Queue this follow-up message to send automatically. The selected mailbox signature is
              appended when you schedule (body stays signature-free for editing).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {overLimit ? (
              <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                <AlertTriangle className="text-amber-700 dark:text-amber-400" />
                <AlertTitle>Daily send limit full</AlertTitle>
                <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
                  <p>
                    {info?.dayKey ? `${formatUtcDayLabel(info.dayKey)} UTC` : "That day"} is at
                    capacity for {mailboxOptionLabel(account)}
                    {loadLimit != null && info
                      ? ` (${info.booked}/${loadLimit} booked)`
                      : ""}
                    . Change the date, use Auto-fix, or pick another mailbox.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 border-amber-500/40 bg-background/60"
                    onClick={handleAutoFix}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    Auto-fix date
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="followup-schedule-from">From</Label>
              <Select
                value={mailboxId || undefined}
                onValueChange={(v) => {
                  if (v) setMailboxId(v);
                }}
              >
                <SelectTrigger id="followup-schedule-from" className="w-full">
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
              {!isDemo && account.emailAddress?.trim() ? (
                <p className="text-[11px] text-muted-foreground">
                  Sends via {account.emailAddress.trim()}
                  {account.displayName?.trim() ? ` (${account.displayName.trim()})` : ""}
                  {loadLimit != null ? ` · limit ${loadLimit}/UTC day` : ""}
                </p>
              ) : null}
            </div>
            <MailboxSignaturePreview
              signature={account.signature}
              includeSignature={includeSignature}
              onIncludeChange={setIncludeSignature}
              mailboxLabel={mailboxOptionLabel(account)}
            />
            <div className="space-y-1.5">
              <Label htmlFor="followup-schedule-to">To</Label>
              <Input
                id="followup-schedule-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="lead@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-schedule-subject">Subject</Label>
              <Input
                id="followup-schedule-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-schedule-at">
                Send at · {timezoneLabel}
              </Label>
              <Input
                id="followup-schedule-at"
                type="datetime-local"
                value={scheduledAt}
                min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                onChange={(e) => setScheduledAt(e.target.value)}
                className={
                  overLimit
                    ? "border-amber-500/50 focus-visible:ring-amber-500/40"
                    : undefined
                }
                required
              />
              {scheduledAt ? (
                <p
                  className={
                    overLimit
                      ? "text-[10px] text-amber-800 dark:text-amber-300"
                      : "text-[10px] text-muted-foreground"
                  }
                >
                  {format(new Date(scheduledAt), "MMM d, yyyy 'at' h:mm a")} · {timezoneLabel}
                  {loadLimit != null && info ? (
                    <>
                      {" "}
                      · UTC {info.dayKey}
                      {overLimit
                        ? ` · over limit (${info.booked}/${loadLimit} booked)`
                        : info.remainingBefore != null
                          ? ` · ${info.remainingBefore} slot${info.remainingBefore === 1 ? "" : "s"} left`
                          : ""}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="followup-schedule-body">Body</Label>
              <Textarea
                id="followup-schedule-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                required
              />
              <p className="text-[10px] text-muted-foreground">
                Do not paste a signature here — it is added from the mailbox above when scheduled.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !followup || !mailboxId || overLimit}>
              {submitting ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
