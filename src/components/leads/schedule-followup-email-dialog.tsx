"use client";

import * as React from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import type { Followup, Lead } from "@/lib/types";
import type { EmailMailboxSettings } from "@/lib/email-account-types";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import {
  getActiveMailbox,
  isEmailAccountConfigured,
  useEmailAccountStore,
} from "@/stores/email-account-store";
import { normalizeRecipientList } from "@/lib/email/parse-outbound-recipients";
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toDatetimeLocalValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function defaultScheduleDatetimeLocal(preferIso?: string): string {
  const min = new Date(Date.now() + 60_000);
  if (preferIso) {
    const preferred = new Date(preferIso);
    if (!Number.isNaN(preferred.getTime()) && preferred.getTime() >= min.getTime()) {
      return toDatetimeLocalValue(preferred);
    }
  }
  const inOneHour = new Date(Date.now() + 60 * 60_000);
  return toDatetimeLocalValue(inOneHour);
}

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
  const [submitting, setSubmitting] = React.useState(false);

  const account = React.useMemo(() => {
    return (
      mailboxOptions.find((mb) => mb.id === mailboxId) ??
      getActiveMailbox({ mailboxes, activeMailboxId })
    );
  }, [mailboxOptions, mailboxId, mailboxes, activeMailboxId]);

  React.useEffect(() => {
    if (!open || !followup) return;
    const defaultId =
      mailboxOptions.find((mb) => mb.id === activeMailboxId)?.id ?? mailboxOptions[0]?.id ?? "";
    setMailboxId(defaultId);
    setTo(lead.contactEmail?.trim() ?? "");
    setSubject("");
    setScheduledAt(defaultScheduleDatetimeLocal(followup.dueAt));
    setBody(followup.messageBody ?? "");
    setSubmitting(false);
  }, [open, followup, lead.contactEmail, mailboxOptions, activeMailboxId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!followup) return;

    const toParsed = normalizeRecipientList(to, "To");
    if (!toParsed.ok) {
      toast.error(toParsed.error);
      return;
    }
    const subjectTrimmed = subject.trim();
    if (!subjectTrimmed) {
      toast.error("Subject is required");
      return;
    }
    if (!body.trim()) {
      toast.error("Email body is required");
      return;
    }
    if (!scheduledAt.trim()) {
      toast.error("Pick a date and time");
      return;
    }
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      toast.error("Invalid schedule time");
      return;
    }
    if (scheduledDate.getTime() < Date.now() + 60_000) {
      toast.error("Schedule time must be at least 1 minute in the future");
      return;
    }

    const toLine = toParsed.addresses.join(", ");
    const emailScheduledAt = scheduledDate.toISOString();

    if (isDemo) {
      setSubmitting(true);
      try {
        const id = addScheduled({
          mailboxId: account.id,
          from: account.emailAddress.trim() || "demo@nova.local",
          displayName: account.displayName || undefined,
          replyTo: account.replyTo || undefined,
          to: toLine,
          subject: subjectTrimmed,
          body,
          text: body,
          scheduledAt: emailScheduledAt,
          followupId: followup.id,
          leadId: lead.id,
        });
        onScheduled(followup.id, {
          scheduledEmailId: id,
          emailScheduledAt,
        });
        toast.success("Email scheduled (demo)", {
          description: `Will move to Sent after ${format(scheduledDate, "MMM d, h:mm a")}.`,
        });
        onOpenChange(false);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!isEmailAccountConfigured(account)) {
      toast.error("Configure SMTP in Settings → Email first.");
      return;
    }

    setSubmitting(true);
    try {
      const text = body;
      const html = body.split("\n").map((l) => `<p>${escapeHtml(l) || "<br/>"}</p>`).join("");
      const res = await fetch("/api/email/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: account.id,
          from: account.emailAddress,
          displayName: account.displayName,
          replyTo: account.replyTo,
          to: toLine,
          subject: subjectTrimmed,
          text,
          html,
          scheduledAt: emailScheduledAt,
          followupId: followup.id,
          leadId: lead.id,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; id?: string };
      if (!data.ok || !data.id) {
        toast.error(data.error ?? "Could not schedule email");
        return;
      }
      onScheduled(followup.id, {
        scheduledEmailId: data.id,
        emailScheduledAt,
      });
      toast.success("Email scheduled", {
        description: `Sending ${format(scheduledDate, "MMM d, yyyy 'at' h:mm a")}`,
      });
      onOpenChange(false);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <DialogHeader>
            <DialogTitle>Schedule email</DialogTitle>
            <DialogDescription>
              Queue this follow-up message to send automatically at the time you choose.
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
              <Label htmlFor="followup-schedule-at">Send at</Label>
              <Input
                id="followup-schedule-at"
                type="datetime-local"
                value={scheduledAt}
                min={toDatetimeLocalValue(new Date(Date.now() + 60_000))}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
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
