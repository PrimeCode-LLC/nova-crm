import { describe, expect, it } from "vitest";
import { buildBrandDefaultsFromPack } from "@/lib/content-calendar/strategy-packs";
import {
  buildContentWallBoard,
  buildContentWallBrandCards,
  buildContentWallCaptureQueue,
  buildContentWallChecklistQueue,
  buildContentWallSchedulingQueue,
} from "@/lib/content-calendar/wall-board";
import type { ContentBrand, ContentItem } from "@/lib/content-calendar/types";
import { parseWallPreferences } from "@/lib/wall-preferences";

function brand(partial: Partial<ContentBrand> & Pick<ContentBrand, "id" | "name">): ContentBrand {
  const defaults = buildBrandDefaultsFromPack({ kind: "company", name: partial.name });
  return {
    organizationId: "org",
    kind: "company",
    ...defaults,
    goal: defaults.primaryOutcome,
    proofSources: "",
    preferredCtas: "",
    knowledgeLibraryIds: [],
    ownerUserId: "u1",
    defaultOwnerUserId: "u1",
    responsibilities: {
      planner: "u1",
      writer: "u1",
      designer: "u1",
      poster: "u1",
      capturer: "u1",
      approver: "u1",
    },
    capturePolicy: {
      capturesPerWeek: 2,
      idleDays: 7,
      requiredFields: ["problem", "solution"],
      remindersEnabled: true,
      requirementsNotes: "",
    },
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function item(
  partial: Partial<ContentItem> & Pick<ContentItem, "id" | "status" | "dueAt" | "publishAt">,
): ContentItem {
  return {
    organizationId: "org",
    brandId: "b1",
    pillarKey: "operator_lesson",
    title: "Post title",
    angle: "Angle",
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

describe("content wall board", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");

  it("builds brand cards with publish and capture health", () => {
    const brands = [
      brand({ id: "b1", name: "Nova" }),
      brand({ id: "b2", name: "Founder", kind: "founder" }),
    ];
    const items = [
      item({
        id: "i1",
        brandId: "b1",
        status: "published",
        publishAt: "2026-07-21T10:00:00.000Z",
        dueAt: "2026-07-21T10:00:00.000Z",
        completedAt: "2026-07-21T11:00:00.000Z",
      }),
      item({
        id: "i2",
        brandId: "b1",
        status: "draft",
        publishAt: "2026-07-20T10:00:00.000Z",
        dueAt: "2026-07-20T10:00:00.000Z",
        checklist: [
          {
            key: "write",
            status: "pending",
            assigneeUserId: "u1",
            dueAt: "2026-07-19T10:00:00.000Z",
          },
        ],
      }),
    ];
    const cards = buildContentWallBrandCards({
      brands,
      items,
      captures: [],
      now,
    });
    expect(cards).toHaveLength(2);
    const nova = cards.find((c) => c.brandId === "b1")!;
    expect(nova.published).toBe(1);
    expect(nova.overdue).toBeGreaterThanOrEqual(1);
    expect(nova.tone).toBe("danger");
    expect(cards[0]?.brandId).toBe("b1"); // overdue first
  });

  it("splits checklist vs scheduling queues", () => {
    const brands = [brand({ id: "b1", name: "Nova" })];
    const items = [
      item({
        id: "write-me",
        status: "draft",
        publishAt: "2026-07-25T10:00:00.000Z",
        dueAt: "2026-07-25T10:00:00.000Z",
        checklist: [
          { key: "write", status: "pending", assigneeUserId: "u1" },
          { key: "approve", status: "pending", assigneeUserId: "u2" },
          { key: "publish", status: "pending", assigneeUserId: "u1" },
        ],
      }),
      item({
        id: "need-slot",
        status: "approved",
        publishAt: "2026-07-24T10:00:00.000Z",
        dueAt: "2026-07-24T10:00:00.000Z",
      }),
      item({
        id: "soon",
        status: "scheduled",
        publishAt: "2026-07-23T10:00:00.000Z",
        dueAt: "2026-07-23T10:00:00.000Z",
      }),
    ];

    const checklist = buildContentWallChecklistQueue({ brands, items, now });
    expect(checklist.some((r) => r.detail === "Review copy")).toBe(true);
    expect(checklist.some((r) => r.detail === "Approve")).toBe(true);
    expect(checklist.some((r) => r.detail === "Publish")).toBe(false);

    const scheduling = buildContentWallSchedulingQueue({ brands, items, now });
    expect(scheduling.some((r) => r.id.includes("write-me-publish"))).toBe(true);
    expect(scheduling.some((r) => r.detail === "Needs schedule")).toBe(true);
    expect(scheduling.some((r) => r.detail === "Publishing soon")).toBe(true);
  });

  it("flags brands behind capture cadence", () => {
    const brands = [
      brand({
        id: "b1",
        name: "Nova",
        capturePolicy: {
          capturesPerWeek: 3,
          idleDays: 7,
          requiredFields: ["problem", "solution"],
          remindersEnabled: true,
          requirementsNotes: "",
        },
      }),
    ];
    const capture = buildContentWallCaptureQueue({
      brands,
      captures: [
        {
          brandId: "b1",
          createdAt: "2026-07-20T10:00:00.000Z",
          status: "indexed",
        },
      ],
      now,
    });
    expect(capture).toHaveLength(1);
    expect(capture[0]?.detail).toContain("1/3");
  });

  it("assembles a full board model", () => {
    const board = buildContentWallBoard({
      brands: [brand({ id: "b1", name: "Nova" })],
      items: [
        item({
          id: "i1",
          status: "approved",
          publishAt: "2026-07-24T10:00:00.000Z",
          dueAt: "2026-07-24T10:00:00.000Z",
        }),
      ],
      captures: [],
      now,
      queueLimit: 5,
    });
    expect(board.brands).toHaveLength(1);
    expect(board.scheduling.length).toBeGreaterThan(0);
    expect(board.capture.length).toBeGreaterThan(0);
  });
});

describe("wall preferences content scene", () => {
  it("defaults content scene on and merges older saved prefs", () => {
    const prefs = parseWallPreferences({
      dwellSeconds: 15,
      scenes: { priorities: true, team: false, pipeline: true },
    });
    expect(prefs.scenes.content).toBe(true);
    expect(prefs.scenes.team).toBe(false);
  });
});
