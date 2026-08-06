import { describe, expect, it } from "vitest";
import {
  archiveHomeLabel,
  buildArchivePatch,
  buildRestoreAsProspectPatch,
  buildRestorePatch,
  filterActiveLeads,
  filterArchivedLeads,
  isLeadArchived,
} from "@/lib/leads/lead-archive";
import type { Lead } from "@/lib/types";

function stub(partial: Partial<Lead>): Lead {
  return {
    id: "l1",
    accountId: "a1",
    contactId: "c1",
    channel: "cold_email",
    stage: "new",
    temperature: "warm",
    priority: "medium",
    ownerId: "u1",
    contactName: "Ada",
    companyName: "Acme",
    touches: 0,
    isIdle: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("lead-archive", () => {
  it("detects archived rows", () => {
    expect(isLeadArchived(stub({}))).toBe(false);
    expect(isLeadArchived(stub({ archivedAt: "  " }))).toBe(false);
    expect(isLeadArchived(stub({ archivedAt: "2026-08-01T00:00:00.000Z" }))).toBe(true);
  });

  it("filters active vs archived", () => {
    const rows = [
      stub({ id: "a", archivedAt: undefined }),
      stub({ id: "b", archivedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(filterActiveLeads(rows).map((r) => r.id)).toEqual(["a"]);
    expect(filterArchivedLeads(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("builds archive and restore patches", () => {
    const archived = buildArchivePatch({
      actorId: "u1",
      reason: "lost",
      now: "2026-08-06T12:00:00.000Z",
    });
    expect(archived.archivedAt).toBe("2026-08-06T12:00:00.000Z");
    expect(archived.archivedBy).toBe("u1");
    expect(archived.archiveReason).toBe("lost");

    const restored = buildRestorePatch({ now: "2026-08-06T13:00:00.000Z" });
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.archivedBy).toBeUndefined();
    expect(restored.archiveReason).toBeUndefined();
    expect(restored.lastActivityAt).toBe("2026-08-06T13:00:00.000Z");
  });

  it("restore as prospect sets intakeKind", () => {
    const patch = buildRestoreAsProspectPatch({ now: "2026-08-06T13:00:00.000Z" });
    expect(patch.intakeKind).toBe("prospect");
    expect(patch.archivedAt).toBeUndefined();
  });

  it("labels home by intake", () => {
    expect(archiveHomeLabel(stub({}))).toBe("Leads");
    expect(archiveHomeLabel(stub({ intakeKind: "sales_lead" }))).toBe("Leads");
    expect(archiveHomeLabel(stub({ intakeKind: "prospect" }))).toBe("Prospects");
  });
});
