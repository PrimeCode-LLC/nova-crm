/**
 * QA 1.6 — the public booking page only books free slots it actually offers (SCH-04).
 * Skips when DATABASE_URL is unset. Outbound email and Google Calendar are mocked.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/send-system-email", () => ({ sendSystemEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/scheduling/google-calendar-events-server", () => ({
  insertGoogleEventsForHostsServer: vi.fn(async () => ({ googleEventIdsByHost: {}, errors: [] })),
}));

import { getAdminDb } from "@/lib/db/document-access/admin";
import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import { COLLECTIONS } from "@/lib/documents/collections";
import { createSchedulingLinkServer } from "@/lib/scheduling/scheduling-server";

import { GET, POST } from "./route";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-16-booking";
const ORG_SLUG = "qa-16-booking";
const HOST = "qa16-host";
let linkSlug = "";

const params = () => ({ params: Promise.resolve({ orgSlug: ORG_SLUG, linkSlug }) });

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Next local date at least 3 days out that falls on the given weekday (0 = Sunday). */
function nextWeekday(weekday: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return d;
}

function book(startAt: string, endAt: string, n: number) {
  return POST(
    new Request(`http://localhost/api/scheduling/public/${ORG_SLUG}/${linkSlug}`, {
      method: "POST",
      body: JSON.stringify({
        startAt, endAt, attendeeName: `Guest ${n}`, attendeeEmail: `guest${n}@nova.test`,
      }),
    }),
    params(),
  );
}

async function cleanup() {
  await withRlsBypass((tx) => tx.pgDocument.deleteMany({ where: { organizationId: ORG } }));
  const db = getAdminDb()!;
  for (const c of [COLLECTIONS.meetings, COLLECTIONS.schedulingLinks, COLLECTIONS.availabilitySchedules]) {
    const snap = await db.collection(c).where("organizationId", "==", ORG).get();
    for (const d of snap.docs) await d.ref.delete();
  }
  await db.collection(COLLECTIONS.organizations).doc(ORG).delete().catch(() => undefined);
}

describe.skipIf(!runDb)("public booking slot validation (QA 1.6)", () => {
  let slot: { startAt: string; endAt: string };

  beforeAll(async () => {
    await cleanup();
    await getAdminDb()!.collection(COLLECTIONS.organizations).doc(ORG).set({
      name: "QA 1.6", slug: ORG_SLUG, status: "active",
    });
    const created = await createSchedulingLinkServer({
      organizationId: ORG, hostId: HOST, title: "QA Intro", durationMin: 30, bufferAfterMin: 15,
    });
    if ("error" in created) throw new Error(created.error);
    linkSlug = created.link.slug;

    const res = await GET(
      new Request(`http://localhost/x?date=${ymd(nextWeekday(1))}`),
      params(),
    );
    const body = (await res.json()) as { slots: { startAt: string; endAt: string }[] };
    expect(body.slots.length).toBeGreaterThan(1);
    slot = body.slots[0]!;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await disconnectPrisma();
    }
  });

  it("two simultaneous bookings of one slot: exactly one succeeds", async () => {
    const [a, b] = await Promise.all([book(slot.startAt, slot.endAt, 1), book(slot.startAt, slot.endAt, 2)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it("re-booking a taken slot later is refused", async () => {
    expect((await book(slot.startAt, slot.endAt, 3)).status).toBe(409);
  });

  it("a time outside availability (Sunday) is refused", async () => {
    const sunday = nextWeekday(0);
    sunday.setHours(9, 45, 0, 0);
    const end = new Date(sunday.getTime() + 30 * 60_000);
    expect((await book(sunday.toISOString(), end.toISOString(), 4)).status).toBe(409);
  });

  it("an off-grid time or wrong length on a working day is refused", async () => {
    const start = new Date(new Date(slot.startAt).getTime() + 7 * 60_000);
    const end = new Date(start.getTime() + 30 * 60_000);
    expect((await book(start.toISOString(), end.toISOString(), 5)).status).toBe(409);
    const long = new Date(new Date(slot.startAt).getTime() + 24 * 60 * 60_000 + 3 * 60 * 60_000);
    expect((await book(slot.startAt, long.toISOString(), 6)).status).toBe(409);
  });
});
