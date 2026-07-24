import { describe, expect, it } from "vitest";
import { computeContentConsistency } from "@/lib/content-calendar/consistency";
import { isContentItemOverdue, buildContentChecklist, type ContentCaptureRequiredField, type ContentItem } from "@/lib/content-calendar/types";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import { can } from "@/lib/permissions/can";
import {
  isBehindCaptureCadence,
  isCapturerIdle,
  normalizeCapturePolicy,
  shouldRemindCapturer,
  validateCaptureFields,
} from "@/lib/content-calendar/capture-policy";

function item(partial: Partial<ContentItem> & Pick<ContentItem, "id" | "status" | "dueAt" | "publishAt">): ContentItem {
  return {
    organizationId: "org",
    brandId: "b1",
    pillarKey: "operator_lesson",
    title: "T",
    angle: "A",
    platforms: ["linkedin"],
    variants: [],
    ctaType: "none",
    assigneeUserId: "u1",
    ownerUserId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("content calendar", () => {
  it("marks open past-due items overdue", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(
      isContentItemOverdue(
        item({
          id: "1",
          status: "approved",
          dueAt: "2026-07-19T10:00:00.000Z",
          publishAt: "2026-07-19T10:00:00.000Z",
        }),
        now,
      ),
    ).toBe(true);
    expect(
      isContentItemOverdue(
        item({
          id: "2",
          status: "published",
          dueAt: "2026-07-19T10:00:00.000Z",
          publishAt: "2026-07-19T10:00:00.000Z",
        }),
        now,
      ),
    ).toBe(false);
  });

  it("seeds company vs founder pillar mix from strategy pack", () => {
    const company = buildBrandDefaultsFromPack({ kind: "company", name: "Co" });
    const founder = buildBrandDefaultsFromPack({ kind: "founder", name: "Me" });
    expect(company.primaryOutcome).toBe("authority_inbound");
    expect(founder.contentStrategy).toBe("build_in_public");
    expect(company.pillars.find((p) => p.key === "personal_journey")?.enabled).toBe(false);
    expect(founder.pillars.find((p) => p.key === "personal_journey")?.enabled).toBe(true);
  });

  it("computes weekly published percent", () => {
    const now = new Date("2026-07-22T12:00:00.000Z"); // Wednesday
    const score = computeContentConsistency({
      now,
      items: [
        item({
          id: "a",
          status: "published",
          publishAt: "2026-07-21T10:00:00.000Z",
          dueAt: "2026-07-21T10:00:00.000Z",
        }),
        item({
          id: "b",
          status: "approved",
          publishAt: "2026-07-22T10:00:00.000Z",
          dueAt: "2026-07-22T10:00:00.000Z",
        }),
      ],
    });
    expect(score.total).toBe(2);
    expect(score.publishedPercent).toBe(50);
  });

  it("grants content_calendar to salesperson (own) and director (all)", () => {
    expect(can({ roleId: "salesperson", isSuperAdmin: false }, "content_calendar", "view")).toBe(
      true,
    );
    expect(can({ roleId: "salesperson", isSuperAdmin: false }, "content_calendar", "create")).toBe(
      true,
    );
    expect(can({ roleId: "director", isSuperAdmin: false }, "content_calendar", "delete")).toBe(
      true,
    );
  });

  it("content_team can use content calendar but not leads", () => {
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "content_calendar", "view")).toBe(
      true,
    );
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "content_calendar", "edit")).toBe(
      true,
    );
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "dashboard", "view")).toBe(true);
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "leads", "view")).toBe(false);
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "prospects", "view")).toBe(false);
  });

  it("content_team can access inbox and settings but not team chat", () => {
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "inbox", "view")).toBe(true);
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "settings_self", "view")).toBe(true);
    expect(can({ roleId: "content_team", isSuperAdmin: false }, "team_chat", "view")).toBe(false);
  });

  it("builds checklist with graphics only for graphic formats", () => {
    const brand = {
      ownerUserId: "owner",
      responsibilities: {
        writer: "w1",
        designer: "d1",
        poster: "p1",
        approver: "a1",
      },
      approvalRequired: true,
    };
    const withGraphics = buildContentChecklist({
      brand,
      format: "carousel",
      dueAt: "2026-07-20T10:00:00.000Z",
      fallbackUserId: "fallback",
    });
    expect(withGraphics.map((s) => s.key)).toEqual(["write", "graphics", "approve", "publish"]);
    expect(withGraphics.find((s) => s.key === "graphics")?.assigneeUserId).toBe("d1");

    const textOnly = buildContentChecklist({
      brand: { ...brand, approvalRequired: false },
      format: "text_post",
      dueAt: "2026-07-20T10:00:00.000Z",
      fallbackUserId: "fallback",
    });
    expect(textOnly.map((s) => s.key)).toEqual(["write", "publish"]);
  });

  it("suggests designer canvas sizes by platform and format", async () => {
    const { contentGraphicsSizeHint, formatNeedsGraphics } = await import(
      "@/lib/content-calendar/types"
    );
    expect(formatNeedsGraphics("graphic_post")).toBe(true);
    expect(formatNeedsGraphics("text_post")).toBe(false);
    expect(contentGraphicsSizeHint("instagram", "graphic_post")).toContain("1080");
    expect(contentGraphicsSizeHint("instagram", "short_video")).toContain("1920");
    expect(contentGraphicsSizeHint("linkedin", "carousel")).toContain("carousel");
  });
});

describe("content schedule", () => {
  it("skips weekends when preferred weekdays are Mon-Thu", async () => {
    const { buildContentScheduleSlots, scrubAiTellPunctuation } = await import(
      "@/lib/content-calendar/schedule"
    );
    const slots = buildContentScheduleSlots({
      // Fri Jul 24 2026 → window through Thu Jul 30
      startDate: "2026-07-24",
      dayCount: 7,
      platforms: ["linkedin", "instagram"],
      cadence: {
        postsPerWeek: { linkedin: 3, instagram: 2 },
        preferredWeekdays: [1, 2, 3, 4],
        weeklyPublishTarget: 5,
      },
    });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      const day = new Date(slot.publishAt).getDay();
      expect([1, 2, 3, 4]).toContain(day);
    }
    const byDay = new Map<string, string[]>();
    for (const slot of slots) {
      const key = slot.publishAt.slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), slot.platform]);
    }
    // Multi-platform days should be possible when cadence asks for more posts than days.
    const multi = [...byDay.values()].some((plats) => plats.length > 1);
    expect(multi || slots.length > byDay.size).toBe(true);

    expect(scrubAiTellPunctuation("without disruption—book a Fit Check")).toBe(
      "without disruption, book a Fit Check",
    );
    expect(scrubAiTellPunctuation("smart–simple")).toBe("smart-simple");
    expect(
      scrubAiTellPunctuation("**Myth 1:** Successful IoT\n- **Reality:** Keep it simple"),
    ).toBe("Myth 1: Successful IoT\nReality: Keep it simple");
    expect(scrubAiTellPunctuation("Read [this](https://example.com) next")).toBe(
      "Read this next",
    );
  });
});

describe("capture policy", () => {
  const brandBase = {
    id: "b1",
    organizationId: "org",
    name: "Acme",
    kind: "company" as const,
    primaryOutcome: "authority_inbound" as const,
    contentStrategy: "case_studies" as const,
    strategyPackId: "b2b_agency_v1",
    platforms: ["linkedin" as const],
    positioning: "",
    voiceRules: "",
    bannedPhrases: [] as string[],
    targetAudience: "",
    offersToPromote: "",
    topicsToAvoid: [] as string[],
    referenceCreators: "",
    proofSources: "",
    preferredCtas: "",
    defaultFormats: ["text_post" as const],
    approvalRequired: true,
    knowledgeLibraryIds: [] as string[],
    pillars: [],
    cadence: { postsPerWeek: {}, preferredWeekdays: [1, 2, 3, 4] },
    defaultCtaType: "none" as const,
    ownerUserId: "owner1",
    responsibilities: { capturer: "cap1" },
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("always requires problem and solution", () => {
    const policy = normalizeCapturePolicy({ requiredFields: ["outcome"] });
    expect(policy.requiredFields).toEqual(["problem", "solution", "outcome"]);
    expect(validateCaptureFields(policy, { problem: "", solution: "x" }).ok).toBe(false);
    expect(
      validateCaptureFields(policy, {
        problem: "p",
        solution: "s",
        outcome: "o",
      }).ok,
    ).toBe(true);
  });

  it("detects idle and behind cadence", () => {
    const nowMs = new Date("2026-07-23T12:00:00.000Z").getTime();
    const brand = {
      ...brandBase,
      capturePolicy: {
        capturesPerWeek: 3,
        idleDays: 7,
        requiredFields: ["problem", "solution"] as ContentCaptureRequiredField[],
        remindersEnabled: true,
      },
    };
    const captures = [
      {
        brandId: "b1",
        createdAt: "2026-07-20T10:00:00.000Z",
      },
    ];
    expect(isBehindCaptureCadence({ brand, captures, nowMs })).toBe(true);
    expect(
      isCapturerIdle({ brand, captures, capturerUserId: "cap1", nowMs }),
    ).toBe(false);
    expect(
      isCapturerIdle({
        brand,
        captures: [],
        capturerUserId: "cap1",
        nowMs,
      }),
    ).toBe(true);
    expect(shouldRemindCapturer({ brand, captures, nowMs })).toBe(true);
    expect(
      shouldRemindCapturer({
        brand: { ...brand, capturePolicy: { ...brand.capturePolicy, remindersEnabled: false } },
        captures,
        nowMs,
      }),
    ).toBe(false);
  });
});
