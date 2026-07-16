"use client";

import * as React from "react";
import { format } from "date-fns";
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
import { canAutoScheduleFollowupEmail } from "@/lib/followup-plans";
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
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
  const { isDemo } = useWorkspace();
  const mailboxes = useEmailAccountStore((s) => s.mailboxes);
  const activeMailboxId = useEmailAccountStore((s) => s.activeMailboxId);
  const addScheduled = useEmailAccountStore((s) => s.addScheduled);

  const mailboxOptions = React.useMemo(() => {
    if (mailboxes.length > 0) return mailboxes;
    return [getActiveMailbox({ mailboxes, activeMailboxId })];
  }, [mailboxes, activeMailboxId]);

  const [mailboxId, setMailboxId] = React.useState("");
  const [to, setTo] = React.useState("");
  const [steps, setSteps] = React.useState<StepDraft[]>([]);
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const account = React.useMemo(() => {
    return (
      mailboxOptions.find((mb) => mb.id === mailboxId) ??
      getActiveMailbox({ mailboxes, activeMailboxId })
    );
  }, [mailboxOptions, mailboxId, mailboxes, activeMailboxId]);

  const timezoneLabel = formatBrowserTimezoneLabel();

  const schedulable = React.useMemo(
    () =>
      followups
        .filter((f) => canAutoScheduleFollowupEmail(f, lead.channel))
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [followups, lead.channel],
  );

  React.useEffect(() => {
    if (!open) return;
    const defaultId =
      mailboxOptions.find((mb) => mb.id === activeMailboxId)?.id ?? mailboxOptions[0]?.id ?? "";
    setMailboxId(defaultId);
    setTo(lead.contactEmail?.trim() ?? "");
    setIncludeSignature(true);
    setSteps(
      schedulable.map((f) => ({
        followupId: f.id,
        title: f.title,
        subject: f.emailSubject?.trim() || f.title,
        scheduledAt: defaultScheduleDatetimeLocal(f.dueAt),
        body: f.messageBody ?? "",
        included: true,
      })),
    );
    setSubmitting(false);
  }, [open, lead.contactEmail, mailboxOptions, activeMailboxId, schedulable]);

  function updateStep(id: string, patch: Partial<StepDraft>) {
    setSteps((prev) => prev.map((s) => (s.followupId === id ? { ...s, ...patch } : s)));
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
          scheduledAtIso: new Date(step.scheduledAt).toISOString(),
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
        toast.success(
          `Scheduled ${okCount} email${okCount === 1 ? "" : "s"}`,
          okCount < selected.length
            ? { description: "Stopped after an error — remaining steps not scheduled." }
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
            </div>
            <MailboxSignaturePreview
              id="seq-include-mailbox-signature"
              signature={account.signature}
              includeSignature={includeSignature}
              onIncludeChange={setIncludeSignature}
              mailboxLabel={mailboxOptionLabel(account)}
            />
            <div className="space-y-1.5">
              <Label htmlFor="seq-schedule-to">To</Label>
              <Input
                id="seq-schedule-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="lead@example.com"
                autoComplete="email"
                required
              />
            </div>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No email steps ready to schedule.
              </p>
            ) : (
              <ul className="space-y-3">
                {steps.map((s, i) => (
                  <li key={s.followupId} className="rounded-md border p-3 space-y-2">
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
                        className="h-8 text-xs"
                        disabled={!s.included}
                      />
                      {s.included && s.scheduledAt ? (
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(s.scheduledAt), "MMM d, yyyy 'at' h:mm a")} ·{" "}
                          {timezoneLabel}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || steps.every((s) => !s.included)}>
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
