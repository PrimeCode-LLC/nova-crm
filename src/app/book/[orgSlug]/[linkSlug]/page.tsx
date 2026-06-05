import { notFound } from "next/navigation";
import { PublicBookingFlow } from "@/components/scheduling/public-booking-flow";
import { getPublicLinkContextServer } from "@/lib/scheduling/scheduling-server";
import { datesWithAvailability } from "@/lib/scheduling/availability-slots";
import {
  demoAvailabilitySchedule,
  demoMeetings,
  DEMO_ORG_SLUG,
} from "@/lib/demo-scheduling";
import type { SchedulingLink } from "@/lib/types";

type Props = {
  params: Promise<{ orgSlug: string; linkSlug: string }>;
  searchParams: Promise<{ email?: string; name?: string }>;
};

const DEMO_LINKS: Record<string, Partial<SchedulingLink>> = {
  "15-minute-meeting": {
    slug: "15-minute-meeting",
    title: "15 Minute Meeting",
    description:
      "Quick intro call. For other inquiries email info@stellixsoft.com or visit stellixsoft.com.",
    durationMin: 15,
    locationType: "google_meet",
    locationDetails: "Web conferencing details provided upon confirmation.",
    hostName: "Stellix Soft",
    color: "#006bff",
  },
  "30-minute-meeting": {
    slug: "30-minute-meeting",
    title: "30 Minute Meeting",
    description: "Full product demo and Q&A.",
    durationMin: 30,
    locationType: "google_meet",
    hostName: "Stellix Soft",
    color: "#6366f1",
  },
};

function demoPublicContext(orgSlug: string, linkSlug: string) {
  if (orgSlug !== DEMO_ORG_SLUG) return null;
  const meta = DEMO_LINKS[linkSlug];
  if (!meta) return null;
  const schedule = demoAvailabilitySchedule("demo-host");
  const link = {
    id: `demo-${linkSlug}`,
    organizationId: "demo-org",
    slug: linkSlug,
    hostId: "demo-host",
    hostName: "Stellix Soft",
    title: meta.title ?? "Meeting",
    description: meta.description,
    durationMin: meta.durationMin ?? 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 15,
    locationType: meta.locationType ?? "google_meet",
    locationDetails: meta.locationDetails,
    linkType: "event" as const,
    color: meta.color,
    active: true,
    scheduleId: schedule.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const availableDates = datesWithAvailability({
    schedule,
    durationMin: link.durationMin,
    bufferBeforeMin: link.bufferBeforeMin,
    bufferAfterMin: link.bufferAfterMin,
    existingMeetings: demoMeetings([]),
  });
  return {
    organization: { name: "Stellix Soft", slug: DEMO_ORG_SLUG },
    link,
    schedule,
    availableDates,
  };
}

export default async function PublicBookPage({ params, searchParams }: Props) {
  const { orgSlug, linkSlug } = await params;
  const sp = await searchParams;

  let organization: { name: string; slug: string };
  let link: SchedulingLink;
  let scheduleTimezone: string;
  let availableDates: string[];
  let demoMode = false;

  const live = await getPublicLinkContextServer({ orgSlug, linkSlug });
  if ("error" in live) {
    const demo = demoPublicContext(orgSlug, linkSlug);
    if (!demo) notFound();
    organization = demo.organization;
    link = demo.link;
    scheduleTimezone = demo.schedule.timezone;
    availableDates = demo.availableDates;
    demoMode = true;
  } else {
    organization = live.organization;
    link = live.link;
    scheduleTimezone = live.schedule.timezone;
    availableDates = live.availableDates;
  }

  return (
    <div className="px-4 py-10">
      <PublicBookingFlow
        orgSlug={orgSlug}
        linkSlug={linkSlug}
        organization={organization}
        link={{
          slug: link.slug,
          title: link.title,
          description: link.description,
          durationMin: link.durationMin,
          locationType: link.locationType,
          locationDetails: link.locationDetails,
          hostName: link.hostName,
          color: link.color,
        }}
        scheduleTimezone={scheduleTimezone}
        availableDates={availableDates}
        initialEmail={sp.email}
        initialName={sp.name}
        demoMode={demoMode}
      />
    </div>
  );
}
