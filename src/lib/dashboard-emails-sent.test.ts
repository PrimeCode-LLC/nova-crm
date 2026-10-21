import { describe, expect, it } from "vitest";

import { countEmailsSentInRange } from "@/lib/dashboard-emails-sent";
import { Timestamp } from "@/lib/db/document-shim/timestamp";
import type { Followup } from "@/lib/types";

describe("countEmailsSentInRange (QA 2.6 / DASH-01)", () => {
  it("counts sends whose sentAt is a document-shim Timestamp, not only ISO strings", () => {
    const start = Date.parse("2026-10-20T00:00:00.000Z");
    const followups = [
      { deliveryStatus: "sent", sentAt: Timestamp.fromDate(new Date("2026-10-21T10:00:00.000Z")) },
      { deliveryStatus: "sent", sentAt: "2026-10-21T11:00:00.000Z" },
      { deliveryStatus: "sent", sentAt: "2026-10-01T11:00:00.000Z" },
      { deliveryStatus: "failed", sentAt: "2026-10-21T11:00:00.000Z" },
    ] as unknown as Followup[];
    expect(countEmailsSentInRange({ followups, extraSentAts: [start + 1, start - 1], rangeStart: start })).toBe(3);
  });
});
