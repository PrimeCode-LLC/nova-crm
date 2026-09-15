import { describe, expect, it } from "vitest";
import { projectWorkspaceListPayload } from "@/lib/db/document-shim/timestamp";
import { canAutoScheduleFollowupEmail } from "@/lib/followup-plans";
import type { Followup } from "@/lib/types";

/** Mirrors asFollowup's hasMessageBody derivation after list projection. */
function hasMessageBodyFromProjectedRaw(raw: Record<string, unknown>): boolean {
  const rawBody = typeof raw.messageBody === "string" ? raw.messageBody : undefined;
  return Boolean(rawBody?.trim()) || raw.hasMessageBody === true;
}

function baseFollowup(overrides: Partial<Followup> = {}): Followup {
  return {
    id: "f1",
    title: "Email 1 - Intro",
    dueAt: new Date().toISOString(),
    ownerId: "u1",
    priority: "high",
    auto: false,
    channel: "cold_email",
    ...overrides,
  };
}

describe("followup list body flag contract", () => {
  it("preserves hasMessageBody after list projection strips messageBody", () => {
    const projected = projectWorkspaceListPayload({
      title: "Email 1 - Intro",
      messageBody: "<p>Hello James</p>",
      emailSubject: "Enhancing .NET Production Applications",
    });
    expect(projected.messageBody).toBeUndefined();
    expect(projected.hasMessageBody).toBe(true);
    // Live mapper must read the flag — not re-derive only from missing messageBody.
    expect(hasMessageBodyFromProjectedRaw(projected)).toBe(true);
  });

  it("still allows schedule when only emailSubject survived a dropped flag", () => {
    const f = baseFollowup({
      emailSubject: "Enhancing .NET Production Applications",
      hasMessageBody: undefined,
      messageBody: undefined,
    });
    expect(canAutoScheduleFollowupEmail(f, "cold_email")).toBe(true);
  });

  it("blocks schedule when already scheduled", () => {
    const f = baseFollowup({
      emailSubject: "Hi",
      hasMessageBody: true,
      scheduledEmailId: "se1",
      emailScheduledAt: new Date().toISOString(),
    });
    expect(canAutoScheduleFollowupEmail(f, "cold_email")).toBe(false);
  });
});
