import { describe, expect, it } from "vitest";
import { computeContentConsistency } from "@/lib/content-calendar/consistency";
import { isContentItemOverdue, buildContentChecklist, applyManualStatusToChecklist, getContentNextAction, isContentItemMyTurn, matchesContentWorkFilter, type ContentCaptureRequiredField, type ContentItem } from "@/lib/content-calendar/types";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import { can } from "@/lib/permissions/can";
import {
  captureDutyBannerCopy,
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

  it("derives next-action cues from checklist for calendar scanning", () => {
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
    const checklist = buildContentChecklist({
      brand,
      format: "carousel",
      dueAt: "2026-07-20T10:00:00.000Z",
      fallbackUserId: "fallback",
    });

    const base = {
      status: "draft" as const,
      assigneeUserId: "w1",
      ownerUserId: "owner",
    };

    expect(getContentNextAction({ ...base, checklist })).toBe("needs_copy");
    expect(isContentItemMyTurn({ ...base, checklist }, "w1")).toBe(true);
    expect(isContentItemMyTurn({ ...base, checklist }, "d1")).toBe(false);

    const afterWrite = checklist.map((s) =>
      s.key === "write" ? { ...s, status: "done" as const } : s,
    );
    expect(getContentNextAction({ ...base, checklist: afterWrite })).toBe("ready_for_graphics");
    expect(matchesContentWorkFilter({ ...base, checklist: afterWrite }, "ready_for_graphics", "d1")).toBe(
      true,
    );
    expect(isContentItemMyTurn({ ...base, checklist: afterWrite }, "d1")).toBe(true);

    const afterGraphics = afterWrite.map((s) =>
      s.key === "graphics" ? { ...s, status: "done" as const } : s,
    );
    expect(getContentNextAction({ ...base, status: "review", checklist: afterGraphics })).toBe(
      "needs_approval",
    );

    const afterApprove = afterGraphics.map((s) =>
      s.key === "approve" ? { ...s, status: "done" as const } : s,
    );
    expect(getContentNextAction({ ...base, status: "scheduled", checklist: afterApprove })).toBe(
      "ready_to_post",
    );
    expect(matchesContentWorkFilter({ ...base, checklist: afterApprove }, "ready_to_post", "p1")).toBe(
      true,
    );
    expect(isContentItemMyTurn({ ...base, checklist: afterApprove }, "p1")).toBe(true);

    expect(getContentNextAction({ status: "published", checklist: afterApprove })).toBe("posted");
    expect(getContentNextAction({ status: "approved", checklist: undefined })).toBe("ready_to_post");
    expect(matchesContentWorkFilter({ ...base, checklist }, "my_turn", "w1")).toBe(true);
    expect(matchesContentWorkFilter({ ...base, checklist }, "my_turn", "p1")).toBe(false);
  });

  it("keeps checklist in sync when status is set manually", () => {
    const open = buildContentChecklist({
      brand: {
        ownerUserId: "owner",
        responsibilities: { writer: "w1", poster: "p1", approver: "a1" },
        approvalRequired: true,
      },
      format: "text_post",
      dueAt: "2026-07-20T10:00:00.000Z",
      fallbackUserId: "fallback",
    });

    const published = applyManualStatusToChecklist(open, "published", "u1", "2026-07-20T12:00:00.000Z");
    expect(published.every((s) => s.status === "done")).toBe(true);

    const skipped = applyManualStatusToChecklist(open, "skipped", "u1", "2026-07-20T12:00:00.000Z");
    expect(skipped.every((s) => s.status === "skipped")).toBe(true);

    const halfDone = open.map((s) =>
      s.key === "write" ? { ...s, status: "done" as const, completedAt: "2026-07-19T00:00:00.000Z" } : s,
    );
    const scheduled = applyManualStatusToChecklist(
      halfDone,
      "scheduled",
      "u1",
      "2026-07-20T12:00:00.000Z",
    );
    expect(scheduled.find((s) => s.key === "write")?.status).toBe("done");
    expect(scheduled.find((s) => s.key === "approve")?.status).toBe("done");
    expect(scheduled.find((s) => s.key === "publish")?.status).toBe("pending");

    const review = applyManualStatusToChecklist(published, "review", "u1", "2026-07-20T13:00:00.000Z");
    expect(review.find((s) => s.key === "write")?.status).toBe("done");
    expect(review.find((s) => s.key === "approve")?.status).toBe("pending");
    expect(review.find((s) => s.key === "publish")?.status).toBe("pending");
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

describe("platform playbooks", () => {
  it("keeps every platform to a format it can actually publish", async () => {
    const { coerceFormatForPlatform } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    expect(coerceFormatForPlatform("x", "carousel")).toBe("thread");
    expect(coerceFormatForPlatform("linkedin", "thread")).toBe("text_post");
    expect(coerceFormatForPlatform("instagram", "text_post")).toBe("graphic_post");
    expect(coerceFormatForPlatform("reddit", "carousel")).toBe("long_form");
    // Viable formats pass through untouched.
    expect(coerceFormatForPlatform("linkedin", "carousel")).toBe("carousel");
    expect(coerceFormatForPlatform("instagram", "short_video")).toBe("short_video");
  });

  it("targets a length range rather than the platform ceiling", async () => {
    const { contentBodyCharTarget } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    const { contentVariantCharLimit } = await import("@/lib/content-calendar/types");
    const linkedin = contentBodyCharTarget("linkedin", "text_post");
    expect(linkedin.min).toBeGreaterThan(0);
    expect(linkedin.max).toBeLessThan(contentVariantCharLimit("linkedin"));
    // A caption supporting a visual is shorter than a standalone post.
    expect(contentBodyCharTarget("linkedin", "carousel").max).toBeLessThan(linkedin.max);
    // Long-form X is not bound by the 280 reply limit.
    expect(contentVariantCharLimit("x", "long_form")).toBeGreaterThan(280);
    expect(contentVariantCharLimit("x", "text_post")).toBe(280);
  });

  it("only asks for segments on formats written as ordered parts", async () => {
    const { formatUsesSegments, segmentCountTarget } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    expect(formatUsesSegments("x", "thread")).toBe(true);
    expect(formatUsesSegments("instagram", "carousel")).toBe(true);
    expect(formatUsesSegments("linkedin", "text_post")).toBe(false);
    expect(segmentCountTarget("x", "thread")).toEqual({ min: 4, max: 8 });
    expect(segmentCountTarget("linkedin", "text_post")).toBeNull();
  });

  it("treats the first-comment link move as reliable only where it still works", async () => {
    const { getContentPlatformPlaybook } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    // Both suppress in-body links, but only X's first-reply workaround holds.
    expect(getContentPlatformPlaybook("x").linkPolicy).toMatchObject({
      bodyCostsReach: true,
      firstComment: "reliable",
    });
    expect(getContentPlatformPlaybook("linkedin").linkPolicy).toMatchObject({
      bodyCostsReach: true,
      firstComment: "contested",
    });
    expect(getContentPlatformPlaybook("reddit").linkPolicy.bodyCostsReach).toBe(false);
  });

  it("keeps a Reel caption inside the visible window", async () => {
    const { contentBodyCharTarget } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    // Long Reel captions measurably reach less, unlike carousel captions.
    expect(contentBodyCharTarget("instagram", "short_video").max).toBeLessThanOrEqual(125);
    expect(contentBodyCharTarget("instagram", "carousel").max).toBeGreaterThan(125);
  });

  it("holds the LinkedIn hook to the mobile fold, not the desktop one", async () => {
    const { getContentPlatformPlaybook } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    expect(getContentPlatformPlaybook("linkedin").previewChars).toBe(140);
  });

  it("injects platform-specific rules into the draft prompt", async () => {
    const { formatPlatformPlaybookForPrompt } = await import(
      "@/lib/content-calendar/platform-playbooks"
    );
    const instagram = formatPlatformPlaybookForPrompt("instagram", "carousel");
    expect(instagram).toContain("PLATFORM: instagram");
    expect(instagram).toContain("Hashtags: 3 to 5");
    const reddit = formatPlatformPlaybookForPrompt("reddit", "long_form");
    expect(reddit).toContain("Hashtags: none");
    expect(reddit).toMatch(/Markdown: supported/);
    expect(formatPlatformPlaybookForPrompt("linkedin", "text_post")).toMatch(
      /Markdown: NOT rendered/,
    );
  });
});

describe("content prompt templates", () => {
  it("ships defaults that carry the platform rules", async () => {
    const { AI_PROMPT_DEFAULTS, promptTemplateIsCurrent } = await import(
      "@/lib/ai/prompt-defaults"
    );
    expect(
      promptTemplateIsCurrent(
        "content_draft_generate",
        AI_PROMPT_DEFAULTS.content_draft_generate.userPromptTemplate,
      ),
    ).toBe(true);
    expect(
      promptTemplateIsCurrent(
        "content_plan_suggest",
        AI_PROMPT_DEFAULTS.content_plan_suggest.userPromptTemplate,
      ),
    ).toBe(true);
  });

  it("rejects a stale override that would drop the playbook", async () => {
    const { promptTemplateIsCurrent } = await import("@/lib/ai/prompt-defaults");
    // The pre-2026 template: platform name only, no playbook or length target.
    const stale = "platform: {{platform}}\nangle: {{angle}}\ncharLimit: {{charLimit}}";
    expect(promptTemplateIsCurrent("content_draft_generate", stale)).toBe(false);
    // Features without required placeholders are unaffected.
    expect(promptTemplateIsCurrent("lead_analyze", "anything")).toBe(true);
  });
});

describe("post body scrubbing", () => {
  it("preserves paragraph rhythm and lists that platforms render as text", async () => {
    const { scrubPostBody } = await import("@/lib/content-calendar/schedule");
    const input = "Dispatch was manual.\n\nThree things changed:\n* RFID scans\n* One dashboard";
    const out = scrubPostBody(input, "linkedin");
    expect(out).toBe(
      "Dispatch was manual.\n\nThree things changed:\n- RFID scans\n- One dashboard",
    );
  });

  it("still strips markdown that LinkedIn would show literally", async () => {
    const { scrubPostBody } = await import("@/lib/content-calendar/schedule");
    const out = scrubPostBody("**Myth 1:** keep it simple\nRead [this](https://x.com) next", "x");
    expect(out).toBe("Myth 1: keep it simple\nRead this next");
  });

  it("keeps native markdown on Reddit", async () => {
    const { scrubPostBody } = await import("@/lib/content-calendar/schedule");
    const input = "## What we tried\n\n- Swapped the scanner\n- **Kept** the old WMS";
    expect(scrubPostBody(input, "reddit")).toBe(input);
  });

  it("normalizes em dashes on every platform", async () => {
    const { scrubPostBody } = await import("@/lib/content-calendar/schedule");
    expect(scrubPostBody("no downtime—we shipped", "reddit")).toBe("no downtime, we shipped");
    expect(scrubPostBody("no downtime—we shipped", "linkedin")).toBe("no downtime, we shipped");
  });

  it("trims an over-long body at a sentence boundary", async () => {
    const { clampPostBody } = await import("@/lib/content-calendar/schedule");
    const text = "First sentence here. Second sentence here. Third runs past the limit.";
    const out = clampPostBody(text, 45);
    expect(out).toBe("First sentence here. Second sentence here.");
    expect(clampPostBody("short", 100)).toBe("short");
  });
});

describe("post lint", () => {
  it("enforces Instagram's five hashtag cap and Reddit's zero", async () => {
    const { lintContentVariant } = await import("@/lib/content-calendar/post-lint");
    const body = "a".repeat(500);
    const overCap = lintContentVariant({
      platform: "instagram",
      format: "graphic_post",
      body,
      hashtags: ["a", "b", "c", "d", "e", "f"],
    });
    expect(overCap.findings.some((f) => f.code === "too_many_hashtags")).toBe(true);

    const onReddit = lintContentVariant({
      platform: "reddit",
      format: "long_form",
      body: "b".repeat(1000),
      hashtags: ["logistics"],
    });
    expect(onReddit.findings.some((f) => f.code === "hashtags_not_allowed")).toBe(true);
  });

  it("flags an in-body link where it suppresses reach", async () => {
    const { lintContentVariant } = await import("@/lib/content-calendar/post-lint");
    const linkedin = lintContentVariant({
      platform: "linkedin",
      format: "text_post",
      body: `${"a".repeat(1000)}\n\nRead more at https://example.com/case-study`,
    });
    expect(linkedin.findings.some((f) => f.code === "link_in_body")).toBe(true);

    // Reddit allows links in the body.
    const reddit = lintContentVariant({
      platform: "reddit",
      format: "long_form",
      body: `${"a".repeat(1000)}\n\nWriteup: https://example.com/x`,
    });
    expect(reddit.findings.some((f) => f.code === "link_in_body")).toBe(false);
  });

  it("catches the AI constructions platforms demote", async () => {
    const { lintContentVariant } = await import("@/lib/content-calendar/post-lint");
    const pad = "a".repeat(900);
    const rhetorical = lintContentVariant({
      platform: "linkedin",
      format: "text_post",
      body: `${pad}\n\nThe outcome? A staggering 70% reduction in status calls.`,
    });
    const codes = rhetorical.findings.map((f) => f.message).join(" | ");
    expect(codes).toContain("rhetorical question fragment");
    expect(codes).toContain("staggering");

    const notXButY = lintContentVariant({
      platform: "linkedin",
      format: "text_post",
      body: `${pad}\n\nIt's not a tracking problem, it's a trust problem.`,
    });
    expect(notXButY.findings.some((f) => f.code === "ai_tell")).toBe(true);
    expect(notXButY.score).toBeLessThan(100);
  });

  it("checks thread segments against the 280 character limit", async () => {
    const { lintContentVariant } = await import("@/lib/content-calendar/post-lint");
    const result = lintContentVariant({
      platform: "x",
      format: "thread",
      body: "Manual dispatch cost a 40-truck 3PL two hours a day. Here is what moved it.",
      segments: ["short one", "b".repeat(300), "third", "fourth"],
    });
    expect(result.findings.some((f) => f.code === "segment_too_long")).toBe(true);
  });

  it("passes a clean platform-native post", async () => {
    const { lintContentVariant } = await import("@/lib/content-calendar/post-lint");
    const body = [
      "A 40-truck 3PL was fielding about 60 driver status calls a day, and every one of them landed on the same two dispatchers.",
      "",
      "They were rekeying ETAs into a spreadsheet that nobody downstream trusted, so sales called the drivers directly to double check. That is how you end up with two sources of truth and no way to tell which one is wrong.",
      "",
      "We put RFID reads on the dock doors and pushed them straight into one board that dispatch, sales, and the client portal all read from. No new hardware on the trucks, because the yard was the actual bottleneck.",
      "",
      "Status calls dropped hard. The spreadsheet did not survive, which nobody missed.",
      "",
      "The part I would do differently: we spent three weeks on a reader placement plan before anyone walked the yard at shift change. Half of it was wrong. A single afternoon of watching how trailers actually move would have saved that.",
      "",
      "This only works when the yard is where the visibility gap is. If your drivers are dark for six hours between stops, dock scans will not tell you anything useful.",
      "",
      "What is still manual in your dispatch flow?",
    ].join("\n");
    const result = lintContentVariant({
      platform: "linkedin",
      format: "text_post",
      body,
    });
    expect(body.length).toBeGreaterThanOrEqual(900);
    expect(body.length).toBeLessThanOrEqual(1900);
    expect(result.findings.filter((f) => f.severity === "error")).toEqual([]);
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
        status: "indexed" as const,
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

  it("ignores draft and failed captures for quota and idle", () => {
    const nowMs = new Date("2026-07-23T12:00:00.000Z").getTime();
    const brand = {
      ...brandBase,
      capturePolicy: {
        capturesPerWeek: 1,
        idleDays: 7,
        requiredFields: ["problem", "solution"] as ContentCaptureRequiredField[],
        remindersEnabled: true,
      },
    };
    const failedOnly = [
      {
        brandId: "b1",
        createdAt: "2026-07-22T10:00:00.000Z",
        status: "failed" as const,
      },
    ];
    expect(isBehindCaptureCadence({ brand, captures: failedOnly, nowMs })).toBe(true);
    expect(
      isCapturerIdle({ brand, captures: failedOnly, capturerUserId: "cap1", nowMs }),
    ).toBe(true);

    const indexed = [
      {
        brandId: "b1",
        createdAt: "2026-07-22T10:00:00.000Z",
        status: "indexed" as const,
      },
    ];
    expect(isBehindCaptureCadence({ brand, captures: indexed, nowMs })).toBe(false);
    expect(
      isCapturerIdle({ brand, captures: indexed, capturerUserId: "cap1", nowMs }),
    ).toBe(false);
  });

  it("builds personal capture duty banner copy", () => {
    expect(captureDutyBannerCopy([])).toBeNull();
    const behind = captureDutyBannerCopy([
      {
        brand: { name: "Hannan Khan" },
        progress: {
          policy: normalizeCapturePolicy({ capturesPerWeek: 2, idleDays: 7 }),
          weekCount: 0,
          target: 2,
          behindCadence: true,
          idle: false,
          lastCaptureAt: "2026-07-20T00:00:00.000Z",
          daysSinceLast: 3,
        },
      },
    ]);
    expect(behind?.headline).toContain("Hannan Khan");
    expect(behind?.headline).toMatch(/pending this week/i);
    expect(behind?.detail).toContain("0/2");

    const multi = captureDutyBannerCopy([
      {
        brand: { name: "Brand A" },
        progress: {
          policy: normalizeCapturePolicy({ capturesPerWeek: 1 }),
          weekCount: 0,
          target: 1,
          behindCadence: true,
          idle: false,
          lastCaptureAt: null,
          daysSinceLast: null,
        },
      },
      {
        brand: { name: "Brand B" },
        progress: {
          policy: normalizeCapturePolicy({ capturesPerWeek: 0, idleDays: 7 }),
          weekCount: 0,
          target: 0,
          behindCadence: false,
          idle: true,
          lastCaptureAt: null,
          daysSinceLast: null,
        },
      },
    ]);
    expect(multi?.headline).toMatch(/weekly capture is pending/i);
    expect(multi?.detail).toContain("Brand A and Brand B");
  });
});
