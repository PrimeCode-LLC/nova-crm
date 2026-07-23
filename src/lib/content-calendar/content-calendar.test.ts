import { describe, expect, it } from "vitest";
import { computeContentConsistency } from "@/lib/content-calendar/consistency";
import { isContentItemOverdue, buildContentChecklist, type ContentItem } from "@/lib/content-calendar/types";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import { can } from "@/lib/permissions/can";

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
});
