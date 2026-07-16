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
import { MailboxSignaturePreview } from "@/components/leads/mailbox-signature-preview";
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!followup) return;

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
                required
              />
              {scheduledAt ? (
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(scheduledAt), "MMM d, yyyy 'at' h:mm a")} · {timezoneLabel}
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
            <Button type="submit" disabled={submitting || !followup || !mailboxId}>
              {submitting ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
