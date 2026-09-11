"use client";

import * as React from "react";
import Link from "next/link";
import {
  Calendar,
  Copy,
  ExternalLink,
  Link2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageBody, PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { AvailabilityScheduleEditor } from "@/components/scheduling/availability-schedule-editor";
import { CalendarConnectionsPanel } from "@/components/scheduling/calendar-connections-panel";
import { SchedulingCalendarView } from "@/components/scheduling/scheduling-calendar-view";
import {
  bookableHostsQueryKey,
  useBookableHosts,
} from "@/hooks/use-scheduling-queries";
import {
  buildWorkspaceOwnerPickerOptions,
  ownerPickerTriggerLabel,
} from "@/lib/owner-scope";
import type {
  AvailabilitySchedule,
  CalendarDelegation,
  Meeting,
  SchedulingLink,
  User,
  WeekdayKey,
} from "@/lib/types";
import {
  demoAvailabilitySchedule,
  demoDelegations,
  demoMeetings,
  demoSchedulingLinks,
  DEMO_ORG_SLUG,
  publicBookingUrl,
} from "@/lib/demo-scheduling";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import { DELEGATION_ROLE_PRESETS } from "@/lib/scheduling/delegation-presets";
import { seedCalendarConnectionsCache } from "@/lib/scheduling/use-calendar-connections";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const LOCATION_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  phone: "Phone",
  in_person: "In person",
  custom: "Custom",
};

function linkPublicUrl(orgSlug: string, link: SchedulingLink): string {
  return publicBookingUrl(orgSlug, link.slug);
}

function formatDelegationLabel(d: CalendarDelegation, users: readonly User[]): string {
  if (d.granteeType === "user") {
    return d.granteeIds
      .map((id) => users.find((u) => u.id === id)?.displayName ?? id)
      .join(", ");
  }
  if (d.granteeType === "role") {
    const preset = DELEGATION_ROLE_PRESETS.find(
      (p) =>
        p.roles.length === d.granteeIds.length &&
        p.roles.every((r) => d.granteeIds.includes(r)),
    );
    if (preset) return preset.label;
    return d.granteeIds.join(", ");
  }
  if (d.granteeType === "org") return "Everyone in organization";
  return d.granteeIds.join(", ") || d.granteeType;
}

export function SchedulingHub() {
  const { isDemo, users, currentUserId, organizationId } = useWorkspace();
  const queryClient = useQueryClient();
  const hostsQuery = useBookableHosts(!isDemo);
  const [orgSlug, setOrgSlug] = React.useState(isDemo ? DEMO_ORG_SLUG : "");
  const [orgName, setOrgName] = React.useState("");

  const [links, setLinks] = React.useState<SchedulingLink[]>([]);
  const [meetings, setMeetings] = React.useState<Meeting[]>([]);
  const [delegations, setDelegations] = React.useState<CalendarDelegation[]>([]);
  const [schedule, setSchedule] = React.useState<AvailabilitySchedule | null>(null);
  const [bookableHosts, setBookableHosts] = React.useState<
    { hostId: string; hostName: string }[]
  >([]);
  const [calendarConnected, setCalendarConnected] = React.useState(isDemo);
  const [loading, setLoading] = React.useState(true);
  const [viewHostId, setViewHostId] = React.useState(currentUserId);

  React.useEffect(() => {
    if (!currentUserId) return;
    setViewHostId((prev) => (!prev ? currentUserId : prev));
  }, [currentUserId]);

  React.useEffect(() => {
    if (isDemo || !hostsQuery.data) return;
    setBookableHosts(hostsQuery.data);
  }, [isDemo, hostsQuery.data]);
  const [selectedLink, setSelectedLink] = React.useState<SchedulingLink | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newDuration, setNewDuration] = React.useState("30");
  const [delegateOpen, setDelegateOpen] = React.useState(false);
  const [delegateMode, setDelegateMode] = React.useState<"role" | "user">("role");
  const [delegatePreset, setDelegatePreset] = React.useState("all_sales");
  const [delegateUserId, setDelegateUserId] = React.useState("");
  const [deleteLinkTarget, setDeleteLinkTarget] = React.useState<SchedulingLink | null>(null);
  const [deleteDelegationTarget, setDeleteDelegationTarget] =
    React.useState<CalendarDelegation | null>(null);
  const [deletingLink, setDeletingLink] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState("calendar");

  const load = React.useCallback(async () => {
    if (isDemo) {
      const demoUsers = users;
      setLinks(demoSchedulingLinks(demoUsers, currentUserId));
      setMeetings(demoMeetings(demoUsers));
      setDelegations(demoDelegations(demoUsers));
      setSchedule(demoAvailabilitySchedule(currentUserId));
      setBookableHosts(
        demoDelegations(demoUsers).length
          ? demoUsers
              .filter((u) => u.roleId === "director")
              .map((u) => ({ hostId: u.id, hostName: u.displayName }))
          : [],
      );
      setCalendarConnected(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [ctxRes, linksRes, meetingsRes, delegRes, availRes, connRes] =
        await Promise.all([
          fetch("/api/scheduling/context"),
          fetch(`/api/scheduling/links?hostId=${encodeURIComponent(viewHostId)}`),
          fetch(`/api/scheduling/meetings?hostId=${encodeURIComponent(viewHostId)}`),
          fetch(`/api/scheduling/delegations?hostId=${encodeURIComponent(currentUserId)}`),
          fetch(`/api/scheduling/availability?hostId=${encodeURIComponent(currentUserId)}`),
          fetch("/api/scheduling/calendar-connections"),
        ]);
      const [ctx, lj, mj, dj, aj, cj] = await Promise.all([
        ctxRes.json(),
        linksRes.json(),
        meetingsRes.json(),
        delegRes.json(),
        availRes.json(),
        connRes.json(),
      ]);
      if (ctx.ok) {
        if (ctx.orgSlug) setOrgSlug(ctx.orgSlug);
        if (ctx.orgName) setOrgName(ctx.orgName);
      }
      if (lj.ok) {
        setLinks(lj.items ?? []);
        if (lj.orgSlug) setOrgSlug(lj.orgSlug);
        if (lj.orgName) setOrgName(lj.orgName);
      }
      if (mj.ok) setMeetings(mj.items ?? []);
      if (dj.ok) setDelegations(dj.items ?? []);
      if (aj.ok) setSchedule(aj.schedule ?? null);
      if (cj.ok) {
        const items = (cj.items ?? []) as { status?: string }[];
        setCalendarConnected(items.some((c) => c.status === "connected"));
        seedCalendarConnectionsCache(
          false,
          currentUserId,
          cj.items ?? [],
          ctx.ok ? ctx.oauth : undefined,
        );
      }
      void queryClient.invalidateQueries({ queryKey: bookableHostsQueryKey });
    } finally {
      setLoading(false);
    }
  }, [isDemo, currentUserId, viewHostId, queryClient, users]);

  React.useEffect(() => {
    if (isDemo) return;
    void load();
  }, [isDemo, currentUserId, viewHostId]); // eslint-disable-line react-hooks/exhaustive-deps -- omit `load`/`users` to avoid roster churn refetches

  React.useEffect(() => {
    if (!isDemo) return;
    void load();
  }, [isDemo, users, currentUserId, load]);

  async function handleCreateLink() {
    if (!newTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    if (isDemo) {
      const link: SchedulingLink = {
        id: `demo-link-${Date.now()}`,
        organizationId: organizationId ?? "demo-org",
        slug: newTitle.trim().toLowerCase().replace(/\s+/g, "-"),
        hostId: currentUserId,
        hostName: users.find((u) => u.id === currentUserId)?.displayName,
        title: newTitle.trim(),
        durationMin: Number(newDuration) || 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
        locationType: "google_meet",
        linkType: "event",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setLinks((prev) => [...prev, link]);
      setCreateOpen(false);
      setNewTitle("");
      toast.success("Link created (demo)");
      return;
    }
    const res = await fetch("/api/scheduling/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        durationMin: Number(newDuration) || 30,
      }),
    });
    const j = await res.json();
    if (!j.ok) {
      toast.error(j.error ?? "Failed");
      return;
    }
    setCreateOpen(false);
    setNewTitle("");
    toast.success("Scheduling link created");
    void load();
  }

  const delegationMemberOptions = React.useMemo(
    () =>
      buildWorkspaceOwnerPickerOptions(users, currentUserId, () => undefined).filter(
        (o) => o.id !== currentUserId,
      ),
    [users, currentUserId],
  );

  async function handleAddDelegation() {
    const preset = DELEGATION_ROLE_PRESETS.find((p) => p.id === delegatePreset);
    const isUserMode = delegateMode === "user";
    if (isUserMode && !delegateUserId) {
      toast.error("Select a person");
      return;
    }
    if (isDemo) {
      const d: CalendarDelegation = {
        id: `demo-del-${Date.now()}`,
        organizationId: organizationId ?? "demo-org",
        hostId: currentUserId,
        hostName: users.find((u) => u.id === currentUserId)?.displayName,
        granteeType: isUserMode ? "user" : "role",
        granteeIds: isUserMode ? [delegateUserId] : (preset?.roles ?? ["salesperson"]),
        permissions: ["view_availability", "book"],
        createdBy: currentUserId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setDelegations((prev) => [...prev, d]);
      setDelegateOpen(false);
      setDelegateUserId("");
      toast.success("Delegation added (demo)");
      return;
    }
    const res = await fetch("/api/scheduling/delegations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        granteeType: isUserMode ? "user" : "role",
        granteeIds: isUserMode ? [delegateUserId] : (preset?.roles ?? ["salesperson"]),
        permissions: ["view_availability", "book"],
      }),
    });
    const j = await res.json();
    if (!j.ok) {
      toast.error(j.error ?? "Failed");
      return;
    }
    setDelegateOpen(false);
    setDelegateUserId("");
    toast.success(isUserMode ? "Person can now book on your calendar" : "Team can now book on your calendar");
    void load();
  }

  async function confirmDeleteDelegation() {
    if (!deleteDelegationTarget) return;
    const target = deleteDelegationTarget;
    if (isDemo) {
      setDelegations((prev) => prev.filter((d) => d.id !== target.id));
      setDeleteDelegationTarget(null);
      toast.success("Delegation removed (demo)");
      return;
    }
    const res = await fetch(
      `/api/scheduling/delegations?id=${encodeURIComponent(target.id)}`,
      { method: "DELETE" },
    );
    const j = await res.json();
    if (!j.ok) {
      toast.error(j.error ?? "Could not remove delegation");
      return;
    }
    setDeleteDelegationTarget(null);
    toast.success("Delegation removed");
    void load();
  }

  async function confirmDeleteLink() {
    if (!deleteLinkTarget) return;
    const target = deleteLinkTarget;
    setDeletingLink(true);
    try {
      if (isDemo) {
        setLinks((prev) => prev.filter((l) => l.id !== target.id));
        if (selectedLink?.id === target.id) setSelectedLink(null);
        toast.success("Link deleted (demo)");
        setDeleteLinkTarget(null);
        return;
      }
      const res = await fetch(
        `/api/scheduling/links?id=${encodeURIComponent(target.id)}`,
        { method: "DELETE" },
      );
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error ?? "Could not delete link");
        return;
      }
      if (selectedLink?.id === target.id) setSelectedLink(null);
      setDeleteLinkTarget(null);
      toast.success("Scheduling link deleted");
      void load();
    } finally {
      setDeletingLink(false);
    }
  }

  function copyLink(link: SchedulingLink) {
    if (!orgSlug) {
      toast.error("Organization URL is still loading, try again in a moment");
      return;
    }
    const url = linkPublicUrl(orgSlug, link);
    void navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy"),
    );
  }

  const memberOptions = buildWorkspaceOwnerPickerOptions(
    users,
    currentUserId,
    () => undefined,
    bookableHosts.map((h) => h.hostId),
  );
  const myLabel = React.useMemo(() => {
    const me = users.find((u) => u.id === currentUserId);
    const name = me?.displayName?.trim() || me?.email?.split("@")[0]?.trim();
    return name ? `${name} (my calendar)` : "My calendar";
  }, [users, currentUserId]);

  const hostOptions: { id: string; label: string }[] = [
    { id: currentUserId, label: myLabel },
    ...bookableHosts
      .filter((h) => h.hostId !== currentUserId)
      .map((h) => ({
        id: h.hostId,
        label:
          memberOptions.find((o) => o.id === h.hostId)?.label ||
          h.hostName ||
          "Team calendar",
      })),
  ];
  const viewHostLabel =
    viewHostId === currentUserId
      ? myLabel
      : ownerPickerTriggerLabel(viewHostId, hostOptions);

  return (
    <>
      <PageHeader
        title="Scheduling"
        description="Event types, calendar, availability, and calendar delegation for your team."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create link
          </Button>
        }
      />
      <PageBody>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full flex-col">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="links">Event types</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="availability">Availability</TabsTrigger>
            <TabsTrigger value="delegation">Calendar access</TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="mt-4 flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Label className="text-sm text-muted-foreground">View</Label>
              <Select
                value={viewHostId}
                onValueChange={(v) => {
                  if (v) setViewHostId(v);
                }}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="My calendar">{viewHostLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {hostOptions.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {links[0] && orgSlug ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={linkPublicUrl(orgSlug, links[0])} target="_blank">
                      <ExternalLink className="h-3.5 w-3.5" /> View landing page
                    </Link>
                  }
                />
              ) : (
                <Button variant="outline" size="sm" disabled title="Create a scheduling link first">
                  <ExternalLink className="h-3.5 w-3.5" /> View landing page
                </Button>
              )}
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : links.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No scheduling links yet. Create one to share with prospects or your team.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  {links.map((link) => (
                    <Card
                      key={link.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        selectedLink?.id === link.id && "ring-2 ring-primary",
                      )}
                      onClick={() => setSelectedLink(link)}
                    >
                      <CardContent className="flex items-start gap-4 p-4">
                        <div
                          className="mt-1 h-10 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: link.color ?? "#6366f1" }}
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold">{link.title}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {link.durationMin} min · {LOCATION_LABEL[link.locationType] ?? link.locationType} · One-on-One
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">Weekdays, hours vary</p>
                        </div>
                        <div className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
                          <Button variant="outline" size="sm" onClick={() => copyLink(link)}>
                            <Copy className="h-3.5 w-3.5" /> Copy link
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Delete ${link.title}`}
                            onClick={() => setDeleteLinkTarget(link)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {selectedLink && (
                  <Card className="h-fit">
                    <CardHeader>
                      <CardTitle className="text-base">{selectedLink.title}</CardTitle>
                      <CardDescription>One-on-One</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Duration</span>
                        <p className="font-medium">{selectedLink.durationMin} min</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Location</span>
                        <p className="font-medium">
                          {LOCATION_LABEL[selectedLink.locationType]}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Public URL</span>
                        <p className="break-all font-mono text-xs">
                          {linkPublicUrl(orgSlug, selectedLink)}
                        </p>
                      </div>
                      <Button className="w-full" variant="outline" onClick={() => copyLink(selectedLink)}>
                        <Link2 className="h-4 w-4" /> Copy link
                      </Button>
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => setDeleteLinkTarget(selectedLink)}
                      >
                        <Trash2 className="h-4 w-4" /> Delete link
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="calendar" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Label className="text-sm text-muted-foreground">View</Label>
              <Select
                value={viewHostId}
                onValueChange={(v) => {
                  if (v) setViewHostId(v);
                }}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="My calendar">{viewHostLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {hostOptions.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SchedulingCalendarView
              meetings={meetings}
              hostLabel={viewHostLabel}
              hostId={viewHostId}
              links={links}
              externalConnected={calendarConnected}
              isDemo={isDemo}
              loading={loading}
              onMeetingBooked={(meeting) => {
                setMeetings((prev) => [...prev, meeting]);
              }}
              onCreateAppointmentSchedule={() => {
                setActiveTab("links");
                setCreateOpen(true);
              }}
            />
          </TabsContent>

          <TabsContent value="availability" className="mt-4 space-y-4" keepMounted>
            <Tabs defaultValue="calendars">
              <TabsList>
                <TabsTrigger value="calendars">Calendar settings</TabsTrigger>
                <TabsTrigger value="schedules">Schedules</TabsTrigger>
              </TabsList>
              <TabsContent value="calendars" className="mt-4">
                <CalendarConnectionsPanel isDemo={isDemo} />
              </TabsContent>
              <TabsContent value="schedules" className="mt-4">
                {schedule ? (
                  <Card>
                    <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                      <div className="space-y-1.5">
                        <CardTitle className="text-base">{schedule.name}</CardTitle>
                        <CardDescription>
                          {schedule.timezone.replace(/_/g, " ")} · Book up to {schedule.maxDaysAhead} days ahead ·{" "}
                          {schedule.minNoticeHours}h minimum notice
                        </CardDescription>
                      </div>
                      <AvailabilityScheduleEditor
                        schedule={schedule}
                        isDemo={isDemo}
                        onSaved={setSchedule}
                      />
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {WEEKDAY_KEYS.map((day: WeekdayKey) => {
                        const slots = schedule.weekly[day] ?? [];
                        return (
                          <div key={day} className="flex gap-4 text-sm">
                            <span className="w-24 capitalize text-muted-foreground">{day}</span>
                            <span>
                              {slots.length === 0
                                ? "Unavailable"
                                : slots.map((s) => `${s.start} – ${s.end}`).join(", ")}
                            </span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-sm text-muted-foreground">No schedule configured.</p>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="delegation" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4" />
                  Who can use my calendar
                </CardTitle>
                <CardDescription>
                  Let salespeople book meetings on your calendar while they assist on leads (SDR → closer handoff).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {delegations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No delegations yet. Add one so your team can see your availability and schedule leads for you.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {delegations.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <Badge variant="secondary" className="mr-2">
                            {d.granteeType === "user" ? "Person" : d.granteeType}
                          </Badge>
                          {formatDelegationLabel(d, users)}
                          <span className="ml-2 text-muted-foreground">
                            ({d.permissions.join(", ")})
                          </span>
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-destructive hover:text-destructive"
                          aria-label={`Remove access for ${formatDelegationLabel(d, users)}`}
                          onClick={() => setDeleteDelegationTarget(d)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button variant="outline" onClick={() => setDelegateOpen(true)}>
                  <Plus className="h-4 w-4" /> Add delegation
                </Button>
              </CardContent>
            </Card>

            {bookableHosts.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Calendars you can book on</CardTitle>
                  <CardDescription>
                    Schedule demos on a closer&apos;s calendar from any lead record.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {bookableHosts.map((h) => (
                      <li key={h.hostId} className="text-sm">
                        <Calendar className="mr-2 inline h-4 w-4 text-primary" />
                        {h.hostName}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New scheduling link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title</Label>
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="15 Minute Meeting"
              />
            </div>
            <div>
              <Label>Duration (minutes)</Label>
              <Select
                value={newDuration}
                onValueChange={(v) => {
                  if (v) setNewDuration(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["15", "30", "45", "60"].map((d) => (
                    <SelectItem key={d} value={d}>
                      {d} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleCreateLink()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteLinkTarget != null}
        onOpenChange={(open) => !open && !deletingLink && setDeleteLinkTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scheduling link?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteLinkTarget
                ? `"${deleteLinkTarget.title}" will be removed. The public booking URL will stop working. Existing meetings are not deleted.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLink}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingLink}
              onClick={() => void confirmDeleteLink()}
            >
              {deletingLink ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDelegationTarget != null}
        onOpenChange={(open) => !open && setDeleteDelegationTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove calendar access?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDelegationTarget
                ? `${formatDelegationLabel(deleteDelegationTarget, users)} will no longer be able to view your availability or book on your calendar.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDeleteDelegation()}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={delegateOpen}
        onOpenChange={(open) => {
          setDelegateOpen(open);
          if (!open) {
            setDelegateMode("role");
            setDelegateUserId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delegate calendar access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Grant access to</Label>
              <Select
                value={delegateMode}
                onValueChange={(v) => {
                  if (v === "role" || v === "user") setDelegateMode(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="role">A role or group</SelectItem>
                  <SelectItem value="user">A single person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {delegateMode === "role" ? (
              <div>
                <Label>Role or group</Label>
                <Select
                  value={delegatePreset}
                  onValueChange={(v) => {
                    if (v) setDelegatePreset(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELEGATION_ROLE_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Person</Label>
                <Select
                  value={delegateUserId || undefined}
                  onValueChange={(v) => {
                    if (v) setDelegateUserId(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {delegationMemberOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              They can view your free/busy slots and book meetings linked to their leads. Personal event titles stay private.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => void handleAddDelegation()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
