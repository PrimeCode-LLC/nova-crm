/**
 * QA 2.6 — direct (compose/reply) sends recorded in emailSendEvents are counted
 * by the dashboard loader (DASH-01: "Emails sent 0" tile). Skips without DATABASE_URL.
 */

import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/org-dashboard-summary-refresh", () => ({ scheduleOrgDashboardSummaryRefresh: vi.fn() }));

import { disconnectPrisma, isDatabaseConfigured } from "@/lib/db/prisma";
import { withRlsBypass } from "@/lib/db/tenant-scope";
import {
  loadEmailSendEventAtsFromServer,
  recordEmailSendEventServer,
} from "@/lib/email/record-email-send-event-server";

const runDb = isDatabaseConfigured();
const ORG = "test-org-qa-26-sends";

describe.skipIf(!runDb)("email send events loader (QA 2.6)", () => {
  afterAll(async () => {
    try {
      await withRlsBypass((tx) => tx.pgDocument.deleteMany({ where: { organizationId: ORG } }));
    } finally {
      await disconnectPrisma();
    }
  });

  it("returns the send times of recorded direct sends", async () => {
    const sentAt = "2026-10-21T10:00:00.000Z";
    await recordEmailSendEventServer({
      organizationId: ORG, actorId: "qa26-user", source: "smtp_send", sentAt, writeTimeline: false,
    });
    await recordEmailSendEventServer({
      organizationId: ORG, actorId: "qa26-user", source: "smtp_send", writeTimeline: false,
    });
    const ats = await loadEmailSendEventAtsFromServer(ORG);
    expect(ats).toHaveLength(2);
    expect(ats).toContain(Date.parse(sentAt));
  });
});
