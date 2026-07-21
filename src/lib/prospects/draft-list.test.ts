import { describe, expect, it } from "vitest";
import type { ProspectDraft } from "./draft-types";
import { filterProspectDrafts, prospectDraftTitle } from "./draft-list";

function draft(overrides: Partial<ProspectDraft> = {}): ProspectDraft {
  return {
    id: "pd-1",
    organizationId: "org-1",
    userId: "user-1",
    revision: 2,
    status: "active",
    origin: "manual",
    fields: {},
    sources: [],
    sourceCount: 0,
    missingRequiredFields: ["companyName", "contactName"],
    completionPercent: 0,
    createdAt: "2026-07-21T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    lastSavedAt: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("prospect draft list helpers", () => {
  it("uses full form metadata as a title fallback", () => {
    expect(prospectDraftTitle(draft({ form: { bizName: "Acme" } as ProspectDraft["form"] }))).toBe(
      "Acme",
    );
  });

  it("filters by search, source, and readiness", () => {
    const drafts = [
      draft({
        id: "ready",
        origin: "intent_radar",
        fields: { companyName: { value: "Northstar" } as ProspectDraft["fields"]["companyName"] },
        missingRequiredFields: [],
      }),
      draft({
        id: "manual",
        fields: { companyName: { value: "Acme" } as ProspectDraft["fields"]["companyName"] },
      }),
    ];

    expect(
      filterProspectDrafts(drafts, {
        search: "north",
        source: "intent_radar",
        readiness: "ready",
      }).map((item) => item.id),
    ).toEqual(["ready"]);
  });
});
