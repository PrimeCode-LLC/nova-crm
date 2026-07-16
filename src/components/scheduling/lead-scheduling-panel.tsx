"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScheduleMeetingDialog } from "@/components/scheduling/schedule-meeting-dialog";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
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
  const [bookableHosts, setBookableHosts] = React.useState<
    { hostId: string; hostName: string }[]
  >([]);
  const [links, setLinks] = React.useState<SchedulingLink[]>([]);
  const [meetings, setMeetings] = React.useState<Meeting[]>([]);
  const [hostId, setHostId] = React.useState(currentUserId);
  const [bookOpen, setBookOpen] = React.useState(false);

  React.useEffect(() => {
    if (isDemo) {
      const hosts = demoDelegatedHosts(users, currentUserId);
      React.startTransition(() => {
        setBookableHosts(hosts);
        setLinks(demoSchedulingLinks(users, currentUserId));
        setMeetings(demoMeetings(users).filter((m) => m.leadId === lead.id));
      });
      return;
    }
    void (async () => {
      const [hRes, lRes, mRes] = await Promise.all([
        fetch("/api/scheduling/delegations?mode=bookable_hosts"),
        fetch(`/api/scheduling/links?hostId=${encodeURIComponent(currentUserId)}`),
        fetch(`/api/scheduling/meetings?leadId=${encodeURIComponent(lead.id)}`),
      ]);
      const [hj, lj, mj] = await Promise.all([hRes.json(), lRes.json(), mRes.json()]);
      if (hj.ok) setBookableHosts(hj.hosts ?? []);
      if (lj.ok) setLinks(lj.items ?? []);
      if (mj.ok) setMeetings(mj.items ?? []);
    })();
  }, [isDemo, users, currentUserId, lead.id]);

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
        links={links}
        isDemo={isDemo}
        lead={lead}
        hostOptions={hostOptions}
        onHostChange={setHostId}
        onBooked={(meeting) => setMeetings((prev) => [...prev, meeting])}
      />
    </Card>
  );
}
