"use client";

import * as React from "react";
import { addMinutes, format } from "date-fns";
import { CalendarPlus, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useBookableHosts } from "@/hooks/use-scheduling-queries";
import { useEmailAccountStore, getActiveMailbox, isEmailAccountConfigured } from "@/stores/email-account-store";
import {
  appendMailDataOwnerParam,
  resolveMailApiForUserUid,
} from "@/lib/email/mail-data-owner-query";
import { DEFAULT_TIMEZONE } from "@/lib/scheduling/defaults";
import type { Meeting } from "@/lib/types";

type HostOption = { hostId: string; hostName: string };

function icsBase64(ics: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(ics, "utf8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(ics)));
}

function defaultEndTime(startTime: string, durationMin: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const base = new Date(2000, 0, 1, h || 0, m || 0);
  return format(addMinutes(base, durationMin), "HH:mm");
}

export function ScheduleFromThreadDialog({
  open,
  onOpenChange,
  defaultAttendeeName,
  defaultAttendeeEmail,
  defaultTitle,
  leadId,
  source = "email_thread",
  replyMessageId,
  replyReferenceIds,
  onScheduled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAttendeeName?: string;
  defaultAttendeeEmail?: string;
  defaultTitle?: string;
  leadId?: string;
  source?: "email_thread" | "external_booking";
  replyMessageId?: string;
  replyReferenceIds?: string[];
  onScheduled?: (meeting: Meeting) => void;
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

  const [title, setTitle] = React.useState("");
  const [dateYmd, setDateYmd] = React.useState("");
  const [startTime, setStartTime] = React.useState("10:00");
  const [endTime, setEndTime] = React.useState("10:30");
  const [attendeeName, setAttendeeName] = React.useState("");
  const [attendeeEmail, setAttendeeEmail] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [selectedHostIds, setSelectedHostIds] = React.useState<string[]>([]);
  const [sendInvite, setSendInvite] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const hostsQuery = useBookableHosts(open && Boolean(currentUserId) && !isDemo);
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

  // Seed once per open — prop identity churn must not reset guest / time fields.
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    const base = new Date();
    setTitle(defaultTitle?.trim() || "Meeting");
    setDateYmd(format(base, "yyyy-MM-dd"));
    setStartTime("10:00");
    setEndTime(defaultEndTime("10:00", 30));
    setAttendeeName(defaultAttendeeName ?? "");
    setAttendeeEmail(defaultAttendeeEmail ?? "");
    setNotes("");
    setSendInvite(source !== "external_booking");
    if (currentUserId) setSelectedHostIds([currentUserId]);
  }, [
    open,
    defaultAttendeeName,
    defaultAttendeeEmail,
    defaultTitle,
    currentUserId,
    source,
  ]);

  async function submit() {
    if (!selectedHostIds.length) {
      toast.error("Select at least one calendar");
      return;
    }
    if (!attendeeEmail.trim() || !attendeeName.trim()) {
      toast.error("Guest name and email are required");
      return;
    }
    const start = new Date(`${dateYmd}T${startTime}:00`);
    let end = new Date(`${dateYmd}T${endTime}:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      toast.error("Invalid date or time");
      return;
    }
    if (end <= start) end = addMinutes(end, 24 * 60);

    setBusy(true);
    try {
      if (isDemo) {
        toast.success("Meeting scheduled (demo)");
        onOpenChange(false);
        return;
      }

      const res = await fetch("/api/scheduling/meetings/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostIds: selectedHostIds,
          title: title.trim() || "Meeting",
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE,
          attendeeName: attendeeName.trim(),
          attendeeEmail: attendeeEmail.trim(),
          attendeeNotes: notes.trim() || undefined,
          source,
          leadId,
          includeIcs: sendInvite,
          sendClientGoogleInvite: sendInvite,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        meeting?: Meeting;
        inviteIcs?: string;
        googleErrors?: { hostId: string; error: string }[];
      };
      if (!res.ok || !data.ok || !data.meeting) {
        toast.error(data.error || "Could not schedule meeting");
        return;
      }

      if (sendInvite && data.inviteIcs && account && isEmailAccountConfigured(account)) {
        if (inboxWriteDisabled) {
          toast.warning("Meeting created, but invite email was not sent (mailbox read-only).");
        } else {
          const url = appendMailDataOwnerParam(
            "/api/email/send",
            mailApiForUid,
            currentUserId,
          );
          const when = format(start, "EEEE, MMMM d · h:mm a");
          const body = `Hi ${attendeeName.trim()},\n\nYou're invited to ${title.trim() || "Meeting"} on ${when}.\n\nA calendar invite is attached.\n`;
          const sendRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mailboxId: account.id,
              leadId,
              from: account.emailAddress,
              displayName: account.displayName,
              replyTo: account.replyTo,
              to: attendeeEmail.trim(),
              subject: `Invitation: ${title.trim() || "Meeting"}`,
              text: body,
              html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
              inReplyTo: replyMessageId,
              referenceIds: replyReferenceIds,
              attachments: [
                {
                  filename: "invite.ics",
                  mimeType: "text/calendar; method=REQUEST",
                  contentBase64: icsBase64(data.inviteIcs),
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
          const sendData = (await sendRes.json()) as { ok?: boolean; error?: string };
          if (!sendRes.ok || !sendData.ok) {
            toast.warning("Meeting created, but invite email failed", {
              description: sendData.error,
            });
          } else {
            toast.success("Meeting scheduled and invite sent");
          }
        }
      } else {
        const ge = data.googleErrors ?? [];
        if (ge.length) {
          toast.warning("Meeting saved - some calendars could not be updated", {
            description: ge.map((e) => e.error).join("; "),
          });
        } else {
          toast.success("Meeting scheduled");
        }
      }

      onScheduled?.(data.meeting);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule meeting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4" />
            {source === "external_booking" ? "Add to team calendars" : "Schedule meeting"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="sft-title">Title</Label>
            <Input id="sft-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5 col-span-1">
              <Label htmlFor="sft-date">Date</Label>
              <Input
                id="sft-date"
                type="date"
                value={dateYmd}
                onChange={(e) => setDateYmd(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sft-start">Start</Label>
              <Input
                id="sft-start"
                type="time"
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value);
                  setEndTime(defaultEndTime(e.target.value, 30));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sft-end">End</Label>
              <Input
                id="sft-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="sft-name">Guest name</Label>
              <Input
                id="sft-name"
                value={attendeeName}
                onChange={(e) => setAttendeeName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sft-email">Guest email</Label>
              <Input
                id="sft-email"
                type="email"
                value={attendeeEmail}
                onChange={(e) => setAttendeeEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sft-notes">Notes</Label>
            <Textarea
              id="sft-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Calendars</Label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
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
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={sendInvite} onCheckedChange={(v) => setSendInvite(Boolean(v))} />
            Send calendar invite to guest
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
