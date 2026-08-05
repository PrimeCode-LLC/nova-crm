import { describe, expect, it } from "vitest";
import { demoFollowupSuggestions } from "@/lib/ai/demo-followup-suggestions";
import {
  buildChannelMixHint,
  channelMixForFollowupChannel,
  defaultFollowupChannelMix,
  followupQueueKind,
  isFollowupEmailChannel,
  matchesFollowupChannelFilter,
  resolveFollowupLeadChannel,
} from "@/lib/followup-plans";
import type { Lead } from "@/lib/types";

function baseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "l1",
    ownerId: "u1",
    stage: "new",
    temperature: "cold",
    channel: "cold_email",
    contactName: "Jane Doe",
    companyName: "Acme",
    touches: 0,
    isIdle: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Lead;
}

describe("followup channel mix", () => {
  it("treats LinkedIn / Upwork / job apply as non-email channels", () => {
    expect(isFollowupEmailChannel({ channel: "linkedin_outbound" }, "cold_email")).toBe(false);
    expect(isFollowupEmailChannel({ channel: "linkedin_1to1" }, "cold_email")).toBe(false);
    expect(isFollowupEmailChannel({ channel: "upwork" }, "cold_email")).toBe(false);
    expect(isFollowupEmailChannel({ channel: "job_apply" }, "cold_email")).toBe(false);
    expect(isFollowupEmailChannel({ channel: "cold_email" }, "linkedin_outbound")).toBe(true);
    expect(isFollowupEmailChannel({ channel: "other" }, "linkedin_outbound")).toBe(false);
    expect(isFollowupEmailChannel({ channel: "other" }, "cold_email")).toBe(true);
  });

  it("classifies queue kind for Email / LinkedIn / other tabs", () => {
    expect(followupQueueKind({ channel: "cold_email" }, "linkedin_outbound")).toBe("email");
    expect(followupQueueKind({ channel: "personalized_email" }, "cold_email")).toBe("email");
    expect(followupQueueKind({ channel: "linkedin_outbound" }, "cold_email")).toBe("linkedin");
    expect(followupQueueKind({ channel: "linkedin_1to1" }, "cold_email")).toBe("linkedin");
    expect(followupQueueKind({ channel: "upwork" }, "cold_email")).toBe("other");
    expect(followupQueueKind({ channel: "job_apply" }, "cold_email")).toBe("other");
    expect(followupQueueKind({ channel: "other" }, "linkedin_outbound")).toBe("linkedin");
    expect(followupQueueKind({ channel: "other" }, "upwork")).toBe("other");
    expect(followupQueueKind({ channel: undefined }, "cold_email")).toBe("email");
  });

  it("falls back to the followup or cold_email channel when the lead is missing", () => {
    expect(resolveFollowupLeadChannel({ channel: "linkedin_1to1" }, undefined)).toBe("linkedin_1to1");
    expect(resolveFollowupLeadChannel({ channel: "other" }, undefined)).toBe("cold_email");
    expect(resolveFollowupLeadChannel({ channel: undefined }, undefined)).toBe("cold_email");
    expect(resolveFollowupLeadChannel({ channel: "other" }, "upwork")).toBe("upwork");
  });

  it("matches channel filter tabs", () => {
    expect(matchesFollowupChannelFilter({ channel: "cold_email" }, "cold_email", "all")).toBe(true);
    expect(matchesFollowupChannelFilter({ channel: "cold_email" }, "cold_email", "email")).toBe(true);
    expect(matchesFollowupChannelFilter({ channel: "cold_email" }, "cold_email", "linkedin")).toBe(false);
    expect(matchesFollowupChannelFilter({ channel: "linkedin_outbound" }, "cold_email", "linkedin")).toBe(true);
    expect(matchesFollowupChannelFilter({ channel: "upwork" }, "cold_email", "email")).toBe(false);
    expect(matchesFollowupChannelFilter({ channel: "upwork" }, "cold_email", "linkedin")).toBe(false);
    expect(matchesFollowupChannelFilter({ channel: "upwork" }, "cold_email", "all")).toBe(true);
  });

  it("defaults to multi_channel when LinkedIn is present", () => {
    expect(
      defaultFollowupChannelMix({
        leadChannel: "cold_email",
        hasLinkedIn: true,
      }),
    ).toBe("multi_channel");
  });

  it("defaults to linkedin when recovering via LinkedIn channel", () => {
    expect(
      defaultFollowupChannelMix({
        leadChannel: "cold_email",
        hasLinkedIn: true,
        initialChannel: "linkedin_outbound",
      }),
    ).toBe("linkedin");
  });

  it("builds an interleaved demo cadence for multi_channel", () => {
    const result = demoFollowupSuggestions(baseLead(), undefined, "full", "multi_channel");
    expect(result.items.map((i) => i.channel)).toEqual([
      "linkedin_outbound",
      "cold_email",
      "linkedin_outbound",
      "cold_email",
    ]);
    expect(result.items[0]?.emailSubject).toBeUndefined();
    expect(result.items[1]?.emailSubject).toBeTruthy();
  });

  it("includes multi_channel guidance in the hint", () => {
    expect(buildChannelMixHint("multi_channel")).toMatch(/interleaved/i);
    expect(buildChannelMixHint("email")).toMatch(/email only/i);
  });

  it("states the LinkedIn character ceiling on every LinkedIn-capable mix", () => {
    for (const mix of ["linkedin", "multi_channel", "lead"] as const) {
      expect(buildChannelMixHint(mix)).toContain("300 characters");
    }
  });

  it("tells the model that later LinkedIn steps depend on invite acceptance", () => {
    expect(buildChannelMixHint("linkedin")).toMatch(/accepted/i);
    expect(buildChannelMixHint("multi_channel")).toMatch(/accepted/i);
  });

  it("keeps a regenerated step on its own channel instead of the lead default", () => {
    expect(channelMixForFollowupChannel("linkedin_outbound", "cold_email")).toBe("linkedin");
    expect(channelMixForFollowupChannel("cold_email", "linkedin_outbound")).toBe("email");
    // "other" resolves to the lead channel, so it should follow the lead.
    expect(channelMixForFollowupChannel("other", "linkedin_1to1")).toBe("linkedin");
    expect(channelMixForFollowupChannel(undefined, "upwork")).toBe("lead");
  });

  it("keeps demo LinkedIn openers inside the connection-note limit", () => {
    const wordy = baseLead({
      recentNews:
        "a very long funding announcement that keeps going and going with extra clauses about the round, the investors, the valuation, and the hiring plans that follow it across several regions",
      businessFocus: "warehouse automation and cross dock throughput improvements",
    });
    const result = demoFollowupSuggestions(wordy, undefined, "full", "multi_channel");
    const opener = result.items[0];
    expect(opener?.channel).toBe("linkedin_outbound");
    expect(opener?.messageBody.length).toBeLessThanOrEqual(300);
  });
});
