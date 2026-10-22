/**
 * QA 2.3 — cancelling a meeting emails the attendee once, with an ICS CANCEL (SCH-06).
 * Skips when DATABASE_URL is unset. Outbound email and Google Calendar are mocked.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sendSystemEmail = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/email/send-system-email", () => ({ sendSystemEmail }));
vi.mock("@/lib/scheduling/google-calendar-events-server", () => ({
  insertGoogleEventsForHostsServer: vi.fn(async () => ({ googleEventIdsByHost: {}, errors: [] })),
}));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { organizationToPrismaRow } from "@/lib/db/dual-write-orgs";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import { bookMeetingServer, updateMeetingStatusServer } from "@/lib/scheduling/scheduling-server";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-23-cancel";
const HOST = "qa23-host";
const now = "2026-10-21T00:00:00.000Z";

async function cleanup() {
  const db = getAdminDb()!;
  const snap = await db.collection(COLLECTIONS.meetings).where("organizationId", "==", ORG).get();
  for (const d of snap.docs) await d.ref.delete();
  await withRlsBypass(async (tx) => {
    await tx.pgDocument.deleteMany({ where: { organizationId: ORG } });
    await tx.organization.deleteMany({ where: { id: ORG } });
  });
  await db.collection(COLLECTIONS.users).doc(HOST).delete().catch(() => undefined);
}

describe.skipIf(!runDb)("meeting cancellation email (QA 2.3)", () => {
  beforeAll(async () => {
    await cleanup();
    await withRlsBypass((tx) =>
      tx.organization.create({
        data: organizationToPrismaRow({
          id: ORG, name: "QA 2.3", slug: "qa-23-cancel", status: "active", planId: "free",
          seatsUsed: 1, settings: {}, createdAt: now, updatedAt: now,
        }),
      }),
    );
    await getAdminDb()!.collection(COLLECTIONS.users).doc(HOST).set({
      organizationId: ORG, orgRole: "owner", displayName: "Host Person", email: "host@nova.test", status: "active",
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  it("emails the attendee once with a calendar cancellation (SCH-06)", async () => {
    const booked = await bookMeetingServer({
      organizationId: ORG, hostId: HOST, title: "QA Intro Call",
      startAt: "2026-11-02T14:00:00.000Z", endAt: "2026-11-02T14:30:00.000Z", timezone: "America/New_York",
      attendeeName: "Pat", attendeeEmail: "pat@nova.test", locationType: "google_meet",
      source: "public_link", skipAccessCheck: true,
    });
    if ("error" in booked) throw new Error(booked.error);
    // Public booking: the host gets a notice too (QA SCH-03).
    const hostNotice = (sendSystemEmail.mock.calls as unknown as [Record<string, unknown>][]).find(
      ([m]) => m.to === "host@nova.test",
    )?.[0];
    expect(hostNotice?.subject).toBe("New booking: QA Intro Call with Pat");
    sendSystemEmail.mockClear();

    const res = await updateMeetingStatusServer({
      organizationId: ORG, meetingId: booked.meeting.id, actorUid: HOST, status: "cancelled",
    });
    expect(res).not.toHaveProperty("error");
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
    const sent = (sendSystemEmail.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(sent.to).toBe("pat@nova.test");
    expect(sent.subject).toBe("Cancelled: QA Intro Call with Host Person");
    const attachment = (sent.attachments as { content: Buffer }[])[0]!;
    expect(attachment.content.toString("utf8")).toContain("METHOD:CANCEL");

    // Cancelling again does not re-send.
    await updateMeetingStatusServer({
      organizationId: ORG, meetingId: booked.meeting.id, actorUid: HOST, status: "cancelled",
    });
    expect(sendSystemEmail).toHaveBeenCalledTimes(1);
  });
});
