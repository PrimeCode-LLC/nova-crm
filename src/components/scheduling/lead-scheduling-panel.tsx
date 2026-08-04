"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduleMeetingDialog } from "@/components/scheduling/schedule-meeting-dialog";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useCalendarConnections } from "@/lib/scheduling/use-calendar-connections";
import {
  useBookableHosts,
  useLeadMeetings,
  useSchedulingLinks,
} from "@/hooks/use-scheduling-queries";
import type { Lead, Meeting, SchedulingLink } from "@/lib/types";
import {
  demoDelegatedHosts,
  demoMeetings,
  demoSchedulingLinks,
  DEMO_ORG_SLUG,
  publicBookingUrl,
} from "@/lib/demo-scheduling";
import { fmtDate } from "@/lib/format";

export function LeadSchedulingPanel({ lead }: { lead: Lead }) {
  const { isDemo, users, currentUserId } = useWorkspace();
  const { connections, loading: calendarLoading } = useCalendarConnections(
    isDemo,
    currentUserId,
  );
  const liveEnabled = !isDemo;
  const hostsQuery = useBookableHosts(liveEnabled);
  const linksQuery = useSchedulingLinks(currentUserId, liveEnabled);
  const meetingsQuery = useLeadMeetings(lead.id, liveEnabled);

  const demoHosts = React.useMemo(
    () => (isDemo ? demoDelegatedHosts(users, currentUserId) : []),
    [isDemo, users, currentUserId],
  );
  const demoLinks = React.useMemo(
    () => (isDemo ? demoSchedulingLinks(users, currentUserId) : []),
    [isDemo, users, currentUserId],
  );
  const demoLeadMeetings = React.useMemo(
    () =>
      isDemo ? demoMeetings(users).filter((m) => m.leadId === lead.id) : [],
    [isDemo, users, lead.id],
  );

  const bookableHosts = isDemo ? demoHosts : (hostsQuery.data ?? []);
  const links: SchedulingLink[] = isDemo
    ? demoLinks
    : (linksQuery.data?.items ?? []);
  const [extraMeetings, setExtraMeetings] = React.useState<Meeting[]>([]);
  const meetings: Meeting[] = isDemo
    ? demoLeadMeetings
    : [...(meetingsQuery.data ?? []), ...extraMeetings];

  React.useEffect(() => {
    setExtraMeetings([]);
  }, [lead.id]);

  const [hostId, setHostId] = React.useState(currentUserId);
  const [bookOpen, setBookOpen] = React.useState(false);

  const hostOptions = React.useMemo(() => {
    const me = users.find((u) => u.id === currentUserId);
    const opts = [
      {
        id: currentUserId,
        label: me?.displayName ? `${me.displayName} (me)` : "My calendar",
      },
    ];
    for (const h of bookableHosts) {
      if (h.hostId !== currentUserId) opts.push({ id: h.hostId, label: h.hostName });
    }
    return opts;
  }, [bookableHosts, currentUserId, users]);

  const hostLabel =
    hostOptions.find((o) => o.id === hostId)?.label ?? "Selected calendar";

  const shareLink = links[0];
  const guestEmail = lead.contactEmail?.trim() || "";
  const myCalendarEmail = connections[0]?.accountEmail?.trim() || "";
  const bookingOnMyCalendar = hostId === currentUserId;

  function copySchedulingLink() {
    if (lead.doNotContact) {
      toast.error("Scheduling outreach is disabled for do-not-contact records.");
      return;
    }
    if (!shareLink) {
      toast.error("Create a scheduling link in Scheduling first");
      return;
    }
    const url = `${publicBookingUrl(DEMO_ORG_SLUG, shareLink.slug)}?email=${encodeURIComponent(lead.contactEmail ?? "")}&name=${encodeURIComponent(lead.contactName)}`;
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Scheduling link copied"),
      () => toast.error("Could not copy"),
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Meetings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {lead.doNotContact ? (
          <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Outreach is disabled because this record is marked do not contact.
          </p>
        ) : null}
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground/80">Guest · </span>
            {guestEmail || "No contact email on this lead"}
          </p>
          <p>
            <span className="font-medium text-foreground/80">Calendar · </span>
            {calendarLoading && bookingOnMyCalendar
              ? "Checking connected calendar…"
              : bookingOnMyCalendar
                ? myCalendarEmail || "No calendar connected — set one in Scheduling settings"
                : `${hostLabel}'s connected calendar`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={lead.doNotContact} onClick={() => setBookOpen(true)}>
            Book meeting
          </Button>
          <Button size="sm" variant="outline" disabled={lead.doNotContact} onClick={copySchedulingLink}>
            <Copy className="h-3.5 w-3.5" /> Send scheduling link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={
              <Link href="/scheduling">
                <ExternalLink className="h-3.5 w-3.5" /> Scheduling settings
              </Link>
            }
          />
        </div>

        {meetings.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {meetings.map((m) => (
              <li key={m.id} className="rounded-md border px-3 py-2">
                <p className="font-medium">{m.title}</p>
                <p className="text-muted-foreground">
                  {fmtDate(m.startAt, "MMM d, h:mm a")}
                  {m.hostName ? ` · ${m.hostName}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No meetings scheduled for this lead.</p>
        )}
      </CardContent>

      <ScheduleMeetingDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        hostId={hostId}
        hostLabel={hostLabel}
        calendarEmail={bookingOnMyCalendar ? myCalendarEmail || undefined : undefined}
        links={links}
        isDemo={isDemo}
        lead={lead}
        hostOptions={hostOptions}
        onHostChange={setHostId}
        onBooked={(meeting) => setExtraMeetings((prev) => [...prev, meeting])}
      />
    </Card>
  );
}
