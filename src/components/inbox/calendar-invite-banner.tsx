"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar, Check, HelpCircle, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useBookableHosts } from "@/hooks/use-scheduling-queries";
import { useEmailAccountStore, getActiveMailbox, isEmailAccountConfigured } from "@/stores/email-account-store";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import {
  looksLikeExternalBookingConfirmation,
  parseInviteFromAttachments,
} from "@/lib/scheduling/inbox-calendar-invite";
import type { MailInbound, MailInboundAttachment } from "@/lib/email-account-types";
import { cn } from "@/lib/utils";

type HostOption = { hostId: string; hostName: string };

function icsBase64(ics: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(ics, "utf8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(ics)));
}

export function CalendarInviteBanner({
  message,
  leadId,
  className,
  onExternalAdd,
}: {
  message: Pick<
    MailInbound,
    | "from"
    | "subject"
    | "bodyText"
    | "attachments"
    | "messageId"
    | "inReplyTo"
    | "referenceIds"
  >;
  leadId?: string;
  className?: string;
  /** Open schedule dialog for external booking confirmations without parseable ICS. */
  onExternalAdd?: () => void;
}) {
  const { currentUserId, isDemo } = useWorkspace();
  const account = useEmailAccountStore((s) => getActiveMailbox(s));
  const mailViewAsUid = useEmailAccountStore((s) => s.mailViewAsUid);
  const inboxWriteDisabled = useEmailAccountStore((s) => s.inboxWriteDisabled);
  const mailApiForUid = React.useMemo(
    () =>
      resolveMailApiForUserUid({
        mailViewAsUid,
        activeMailboxDataOwnerUid: account.dataOwnerUid,
        selfUid: currentUserId,
      }),
    [mailViewAsUid, account.dataOwnerUid, currentUserId],
  );

  const parsed = React.useMemo(
    () => parseInviteFromAttachments(message.attachments),
    [message.attachments],
  );

  const externalHint = React.useMemo(() => {
    if (parsed) return false;
    return looksLikeExternalBookingConfirmation({
      from: message.from,
      subject: message.subject,
      bodyText: message.bodyText,
      hasCalendarInvite: Boolean(
        message.attachments?.some((a) => a.isCalendarInvite),
      ),
    });
  }, [parsed, message.from, message.subject, message.bodyText, message.attachments]);

  const [busy, setBusy] = React.useState<"accept" | "decline" | "tentative" | null>(null);
  const [acceptOpen, setAcceptOpen] = React.useState(false);
  const [selectedHostIds, setSelectedHostIds] = React.useState<string[]>([]);
  const hostsQuery = useBookableHosts(acceptOpen && Boolean(currentUserId) && !isDemo);
  const hosts: HostOption[] = React.useMemo(() => {
    if (!currentUserId) return [];
    const delegated = hostsQuery.data ?? [];
    return [
      { hostId: currentUserId, hostName: "My calendar" },
      ...delegated
        .filter((h) => h.hostId !== currentUserId)
        .map((h) => ({ hostId: h.hostId, hostName: h.hostName })),
    ];
  }, [currentUserId, hostsQuery.data]);
  const loadingHosts = acceptOpen && !isDemo && hostsQuery.isLoading;

  React.useEffect(() => {
    if (!acceptOpen || !currentUserId) return;
    setSelectedHostIds([currentUserId]);
  }, [acceptOpen, currentUserId]);

  async function sendReplyIcs(input: {
    to: string;
    subject: string;
    ics: string;
    body: string;
  }) {
    if (!account) {
      toast.error("No mailbox selected.");
      return false;
    }
    if (isDemo) {
      toast.success("RSVP recorded (demo)", {
        description: "Outbound calendar reply is skipped in demo mode.",
      });
      return true;
    }
    if (!isEmailAccountConfigured(account)) {
      toast.error("Configure SMTP in Settings → Email to notify the organizer.");
      return false;
    }
    if (inboxWriteDisabled) {
      toast.error("Sending is disabled while viewing another member’s mailbox.");
      return false;
    }

    const url = appendMailDataOwnerParam("/api/email/send", mailApiForUid, currentUserId);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailboxId: account.id,
        leadId,
        from: account.emailAddress,
        displayName: account.displayName,
        replyTo: account.replyTo,
        to: input.to,
        subject: input.subject,
        text: input.body,
        html: `<p>${input.body.replace(/\n/g, "<br/>")}</p>`,
        inReplyTo: message.messageId,
        referenceIds: [
          ...(message.referenceIds ?? []),
          ...(message.messageId ? [message.messageId] : []),
        ].slice(-50),
        attachments: [
          {
            filename: "reply.ics",
            mimeType: "text/calendar; method=REPLY",
            contentBase64: icsBase64(input.ics),
          },
        ],
        smtp: {
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          user: account.smtp.user,
          pass: account.smtp.password,
        },
        imap: {
          host: account.imap.host,
          port: account.imap.port,
          secure: account.imap.secure,
          user: account.imap.user,
          pass: account.imap.password,
        },
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      toast.error(data.error || "Could not send calendar reply");
      return false;
    }
    return true;
  }

  async function runRsvp(action: "accept" | "decline" | "tentative", hostIds?: string[]) {
    if (!parsed || !account?.emailAddress) {
      toast.error("Calendar invite or mailbox email is missing.");
      return;
    }
    setBusy(action);
    try {
      const icsText =
        typeof Buffer !== "undefined"
          ? Buffer.from(parsed.attachment.contentBase64!, "base64").toString("utf8")
          : decodeURIComponent(escape(atob(parsed.attachment.contentBase64!)));
      const res = await fetch("/api/scheduling/meetings/from-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          icsText,
          hostIds,
          attendeeEmail: account.emailAddress.trim(),
          attendeeName: account.displayName?.trim() || undefined,
          leadId,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        replyIcs?: string;
        replyTo?: string;
        replySubject?: string;
        googleErrors?: { hostId: string; error: string }[];
      };
      if (!res.ok || !data.ok || !data.replyIcs || !data.replyTo) {
        toast.error(data.error || "Could not process invite");
        return;
      }

      const sent = await sendReplyIcs({
        to: data.replyTo,
        subject: data.replySubject || `${action}: ${parsed.invite.summary}`,
        ics: data.replyIcs,
        body:
          action === "accept"
            ? `Accepted: ${parsed.invite.summary}`
            : action === "decline"
              ? `Declined: ${parsed.invite.summary}`
              : `Tentative: ${parsed.invite.summary}`,
      });
      if (!sent) return;

      if (action === "accept") {
        const ge = data.googleErrors ?? [];
        if (ge.length) {
          toast.warning("Accepted - some calendars could not be updated", {
            description: ge.map((e) => e.error).join("; "),
          });
        } else {
          toast.success("Meeting accepted and added to selected calendars");
        }
        setAcceptOpen(false);
      } else if (action === "decline") {
        toast.success("Decline sent to organizer");
      } else {
        toast.success("Tentative reply sent to organizer");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "RSVP failed");
    } finally {
      setBusy(null);
    }
  }

  if (!parsed && !externalHint) return null;

  if (!parsed && externalHint) {
    return (
      <div
        className={cn(
          "rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 space-y-2",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Looks like a booking confirmation</p>
            <p className="text-xs text-muted-foreground">
              Add this meeting to your team calendars after the time is confirmed.
            </p>
          </div>
        </div>
        {onExternalAdd ? (
          <Button size="sm" variant="secondary" onClick={onExternalAdd} disabled={inboxWriteDisabled}>
            Add to team calendars
          </Button>
        ) : null}
      </div>
    );
  }

  if (!parsed) return null;

  const { invite } = parsed;
  const when = (() => {
    try {
      return format(new Date(invite.startAt), "EEE, MMM d · h:mm a");
    } catch {
      return invite.startAt;
    }
  })();

  return (
    <>
      <div
        className={cn(
          "rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2",
          className,
        )}
      >
        <div className="flex items-start gap-2">
          <Calendar className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-medium truncate">{invite.summary}</p>
            <p className="text-xs text-muted-foreground">{when}</p>
            {invite.organizerEmail ? (
              <p className="text-[11px] text-muted-foreground truncate">
                From {invite.organizerName || invite.organizerEmail}
              </p>
            ) : null}
            {invite.location ? (
              <p className="text-[11px] text-muted-foreground truncate">{invite.location}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            disabled={Boolean(busy) || inboxWriteDisabled}
            onClick={() => setAcceptOpen(true)}
          >
            {busy === "accept" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Accept
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5"
            disabled={Boolean(busy) || inboxWriteDisabled}
            onClick={() => void runRsvp("tentative")}
          >
            {busy === "tentative" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HelpCircle className="h-3.5 w-3.5" />
            )}
            Tentative
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={Boolean(busy) || inboxWriteDisabled}
            onClick={() => void runRsvp("decline")}
          >
            {busy === "decline" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            Decline
          </Button>
        </div>
      </div>

      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to calendars</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Accept <span className="font-medium text-foreground">{invite.summary}</span> and place it
            on the calendars you can book.
          </p>
          {loadingHosts ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading calendars…
            </p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {hosts.map((h) => {
                const checked = selectedHostIds.includes(h.hostId);
                return (
                  <label
                    key={h.hostId}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        setSelectedHostIds((prev) => {
                          if (v) return [...new Set([...prev, h.hostId])];
                          return prev.filter((id) => id !== h.hostId);
                        });
                      }}
                    />
                    <span>{h.hostName}</span>
                  </label>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedHostIds.length || busy === "accept"}
              onClick={() => void runRsvp("accept", selectedHostIds)}
            >
              {busy === "accept" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Accept & add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Lightweight attachment-only helper for mail reader dialog. */
export function CalendarInviteBannerFromAttachments({
  attachments,
  from,
  subject,
  bodyText,
  messageId,
  inReplyTo,
  referenceIds,
  leadId,
  onExternalAdd,
  className,
}: {
  attachments?: MailInboundAttachment[];
  from?: string;
  subject?: string;
  bodyText?: string;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  leadId?: string;
  onExternalAdd?: () => void;
  className?: string;
}) {
  return (
    <CalendarInviteBanner
      message={{
        from: from ?? "",
        subject: subject ?? "",
        bodyText: bodyText ?? "",
        attachments,
        messageId,
        inReplyTo,
        referenceIds,
      }}
      leadId={leadId}
      onExternalAdd={onExternalAdd}
      className={className}
    />
  );
}
