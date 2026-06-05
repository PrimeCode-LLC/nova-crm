import type {
  AvailabilitySchedule,
  CalendarDelegation,
  Meeting,
  SchedulingLink,
  User,
} from "@/lib/types";
import { DEFAULT_TIMEZONE, DEFAULT_WEEKLY_AVAILABILITY } from "@/lib/scheduling/defaults";

export const DEMO_ORG_SLUG = "stellix-soft";

export function demoSchedulingLinks(users: readonly User[], currentUserId: string): SchedulingLink[] {
  const director = users.find((u) => u.roleId === "director") ?? users[0];
  const salesperson = users.find((u) => u.roleId === "salesperson") ?? users[1];
  const host = director ?? salesperson;
  if (!host) return [];
  const now = new Date().toISOString();
  return [
    {
      id: "demo-link-15",
      organizationId: "demo-org",
      slug: "15-minute-meeting",
      hostId: host.id,
      hostName: host.displayName,
      title: "15 Minute Meeting",
      description:
        "Quick intro call. For other inquiries email info@stellixsoft.com or visit stellixsoft.com.",
      durationMin: 15,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
      locationType: "google_meet",
      locationDetails: "Web conferencing details provided upon confirmation.",
      linkType: "event",
      color: "#6366f1",
      active: true,
      scheduleId: "demo-schedule-default",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-link-30",
      organizationId: "demo-org",
      slug: "30-minute-meeting",
      hostId: host.id,
      hostName: host.displayName,
      title: "30 Minute Meeting",
      description: "Full product demo and Q&A.",
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
      locationType: "google_meet",
      linkType: "event",
      color: "#8b5cf6",
      active: true,
      scheduleId: "demo-schedule-default",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "demo-link-personal",
      organizationId: "demo-org",
      slug: "my-intro-call",
      hostId: currentUserId,
      hostName: users.find((u) => u.id === currentUserId)?.displayName,
      title: "Intro call",
      description: "15-minute qualification call.",
      durationMin: 15,
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      locationType: "phone",
      linkType: "personal",
      color: "#0ea5e9",
      active: true,
      scheduleId: "demo-schedule-mine",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function demoAvailabilitySchedule(ownerUid: string): AvailabilitySchedule {
  const now = new Date().toISOString();
  return {
    id: ownerUid === "demo-schedule-mine" ? "demo-schedule-mine" : "demo-schedule-default",
    organizationId: "demo-org",
    ownerUid,
    name: "Working hours (default)",
    isDefault: true,
    timezone: DEFAULT_TIMEZONE,
    weekly: DEFAULT_WEEKLY_AVAILABILITY,
    minNoticeHours: 4,
    maxDaysAhead: 60,
    createdAt: now,
    updatedAt: now,
  };
}

function demoMeetingAt(
  users: readonly User[],
  id: string,
  title: string,
  start: Date,
  durationMin: number,
  overrides: Partial<Meeting> = {},
): Meeting {
  const director = users.find((u) => u.roleId === "director");
  const sdr = users.find((u) => u.roleId === "salesperson" || u.roleId === "prospecting");
  const end = new Date(start.getTime() + durationMin * 60_000);
  const now = new Date().toISOString();
  return {
    id,
    organizationId: "demo-org",
    hostId: director?.id ?? users[0]?.id ?? "u1",
    hostName: director?.displayName ?? "Director",
    bookedById: sdr?.id,
    bookedByName: sdr?.displayName,
    leadId: "lead-1",
    leadOwnerId: sdr?.id,
    schedulingLinkId: "demo-link-30",
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: DEFAULT_TIMEZONE,
    status: "scheduled",
    attendeeName: "Krishan",
    attendeeEmail: "krishan@example.com",
    locationType: "google_meet",
    source: "public_link",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function demoMeetings(users: readonly User[]): Meeting[] {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(20, 30, 0, 0);

  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  thursday.setHours(23, 0, 0, 0);

  const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  inTwoDays.setHours(14, 0, 0, 0);

  const nextWeek = new Date(now.getTime() + 9 * 24 * 60 * 60 * 1000);
  nextWeek.setHours(11, 0, 0, 0);

  const completed = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  completed.setHours(10, 0, 0, 0);

  return [
    demoMeetingAt(users, "demo-meeting-weekly", "Chicago Meeting weekly", monday, 60),
    demoMeetingAt(users, "demo-meeting-demo", "Stellixsoft Milestone 4 demo", thursday, 45, {
      attendeeName: "Acme Corp",
      attendeeEmail: "team@acme.example",
    }),
    demoMeetingAt(users, "demo-meeting-1", "30 Minute Meeting", inTwoDays, 30),
    demoMeetingAt(users, "demo-meeting-followup", "Discovery follow-up", nextWeek, 30, {
      leadId: "lead-2",
      attendeeName: "Sarah Chen",
      attendeeEmail: "sarah@startup.io",
    }),
    demoMeetingAt(users, "demo-meeting-done", "Onboarding kickoff", completed, 45, {
      status: "completed",
      attendeeName: "Jordan Lee",
      attendeeEmail: "jordan@client.co",
    }),
  ];
}

export function demoDelegations(users: readonly User[]): CalendarDelegation[] {
  const director = users.find((u) => u.roleId === "director");
  if (!director) return [];
  const now = new Date().toISOString();
  return [
    {
      id: "demo-delegation-sales",
      organizationId: "demo-org",
      hostId: director.id,
      hostName: director.displayName,
      granteeType: "role",
      granteeIds: ["salesperson", "prospecting", "team_lead"],
      permissions: ["view_availability", "book"],
      createdBy: director.id,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function demoDelegatedHosts(
  users: readonly User[],
  viewerUid: string,
): { hostId: string; hostName: string }[] {
  const delegations = demoDelegations(users);
  const viewer = users.find((u) => u.id === viewerUid);
  if (!viewer) return [];
  return delegations
    .filter((d) => {
      if (d.hostId === viewerUid) return false;
      if (d.granteeType === "role") return d.granteeIds.includes(viewer.roleId);
      if (d.granteeType === "user") return d.granteeIds.includes(viewerUid);
      return false;
    })
    .map((d) => ({
      hostId: d.hostId,
      hostName: d.hostName ?? users.find((u) => u.id === d.hostId)?.displayName ?? d.hostId,
    }));
}

export function publicBookingUrl(orgSlug: string, linkSlug: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/book/${orgSlug}/${linkSlug}`;
  }
  return `/book/${orgSlug}/${linkSlug}`;
}
