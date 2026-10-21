import { describe, expect, it } from "vitest";

import { buildMeetingIcs } from "@/lib/scheduling/ics";
import { formatMeetingWhen, renderMeetingCancellationEmail } from "@/lib/scheduling/meeting-email";
import type { Meeting } from "@/lib/types";

const meeting = {
  id: "m1", organizationId: "o", hostId: "h", title: "QA Intro Call", status: "cancelled",
  startAt: "2026-10-26T13:00:00.000Z", endAt: "2026-10-26T13:30:00.000Z", timezone: "America/New_York",
  attendeeName: "Pat", attendeeEmail: "pat@nova.test", locationType: "google_meet", source: "public_link",
} as unknown as Meeting;

describe("meeting emails (QA 2.3)", () => {
  it("formats the time in the meeting's timezone with its abbreviation", () => {
    expect(formatMeetingWhen(meeting)).toBe("Monday, October 26 · 9:00 AM EDT");
  });

  it("cancellation email names the host and the meeting", () => {
    const email = renderMeetingCancellationEmail({ meeting, organization: { name: "Acme" }, hostDisplayName: "Zain" });
    expect(email.subject).toBe("Cancelled: QA Intro Call with Zain");
    expect(email.text).toContain("Your meeting has been cancelled.");
  });

  it("cancel ICS removes the same event from the calendar", () => {
    const ics = buildMeetingIcs(meeting, "host@nova.test", { cancel: true });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("UID:m1@nova-crm");
    expect(buildMeetingIcs(meeting, "host@nova.test")).toContain("METHOD:REQUEST");
  });
});
