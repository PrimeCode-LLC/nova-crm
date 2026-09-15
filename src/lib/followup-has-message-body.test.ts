import { describe, expect, it } from "vitest";
import { projectWorkspaceListPayload } from "@/lib/db/document-shim/timestamp";
import {
  canAutoScheduleFollowupEmail,
  resolveFollowupHasMessageBody,
} from "@/lib/followup-plans";
import type { Followup } from "@/lib/types";

describe("resolveFollowupHasMessageBody", () => {
  it("honors hasMessageBody from list projections (body omitted)", () => {
    const projected = projectWorkspaceListPayload({
      title: "Email 1",
      messageBody: "<p>Hello</p>",
    });
    expect(projected.messageBody).toBeUndefined();
    expect(projected.hasMessageBody).toBe(true);
    expect(resolveFollowupHasMessageBody(projected)).toBe(true);
  });

  it("returns false when neither body nor flag is present", () => {
    expect(resolveFollowupHasMessageBody({})).toBe(false);
    expect(resolveFollowupHasMessageBody({ messageBody: "   " })).toBe(false);
  });

  it("keeps email steps schedulable after list projection mapping", () => {
    const projected = projectWorkspaceListPayload({
      title: "Email 3 - Reframe",
      messageBody: "<p>Support for your integration goals</p>",
      channel: "cold_email",
    });
    const followup = {
      id: "f1",
      title: "Email 3 - Reframe",
      dueAt: "2026-09-25T14:44:00.000Z",
      ownerId: "u1",
      priority: "medium",
      auto: true,
      messageBody: undefined,
      hasMessageBody: resolveFollowupHasMessageBody(projected) || undefined,
      channel: "cold_email",
    } as Followup;
    expect(canAutoScheduleFollowupEmail(followup, "cold_email")).toBe(true);
  });
});
