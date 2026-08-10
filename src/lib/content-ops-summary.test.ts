import { describe, expect, it } from "vitest";
import {
  computeContentOpsOrgGauges,
  computeContentOpsPersonGauges,
} from "@/lib/content-ops-summary";
import { replyIntelListCacheKey } from "@/lib/email/reply-intel-cache";

describe("content ops gauges (P0.12)", () => {
  it("counts scheduled / published / plate steps", () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    const org = computeContentOpsOrgGauges({
      nowMs: now,
      items: [
        {
          status: "scheduled",
          publishAt: "2026-08-12T10:00:00.000Z",
        },
        {
          status: "published",
          completedAt: "2026-08-11T10:00:00.000Z",
        },
      ],
      brands: [{ active: true }, { active: false }],
      captures: [{ createdAt: "2026-08-09T00:00:00.000Z" }],
    });
    expect(org.scheduledThisWeek).toBe(1);
    expect(org.publishedThisWeek).toBe(1);
    expect(org.activeBrands).toBe(1);
    expect(org.recentCaptures).toBe(1);

    expect(
      computeContentOpsPersonGauges(
        [
          {
            status: "draft",
            checklist: [{ status: "pending", assigneeUserId: "u1" }],
          },
          { status: "draft", assigneeUserId: "u1", checklist: [] },
        ],
        "u1",
      ).myOpenSteps,
    ).toBe(2);
  });
});

describe("reply intel cache key (P0.12)", () => {
  it("includes org + range + filters", () => {
    expect(
      replyIntelListCacheKey({
        organizationId: "org_a",
        fromIso: "a",
        toIso: "b",
        classification: "hot",
      }),
    ).toBe("dash:reply-intel:v1:org_a:a:b:hot:all");
  });
});
