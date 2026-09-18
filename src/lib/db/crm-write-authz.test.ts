import { describe, expect, it } from "vitest";
import {
  assertCrmLeadMutationAllowed,
  leadPatchNeedsAuthz,
} from "@/lib/db/crm-write-authz";

describe("crm-write-authz", () => {
  it("detects archive/owner patches that need authz", () => {
    expect(leadPatchNeedsAuthz({ ownerId: "u1" }, [])).toBe(true);
    expect(leadPatchNeedsAuthz({ archivedAt: "2026-01-01" }, [])).toBe(true);
    expect(leadPatchNeedsAuthz({}, ["archivedAt"])).toBe(true);
    expect(leadPatchNeedsAuthz({ stage: "qualified" }, [])).toBe(false);
  });

  it("rejects delete for members", async () => {
    const result = await assertCrmLeadMutationAllowed({
      organizationId: "org",
      entity: "lead",
      id: "l1",
      action: "delete",
      viewerRole: "member",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("allows non-lead entities without lead lookup", async () => {
    const result = await assertCrmLeadMutationAllowed({
      organizationId: "org",
      entity: "account",
      id: "a1",
      action: "delete",
      viewerRole: "member",
    });
    expect(result).toEqual({ ok: true, lead: null });
  });

  it("allows lead upsert create when row is missing (no authz block)", async () => {
    // getLeadFromPostgres returns null without DATABASE_URL / org — treated as create.
    const result = await assertCrmLeadMutationAllowed({
      organizationId: "org",
      entity: "lead",
      id: "new-lead",
      action: "upsert",
      viewerRole: "member",
      patch: { ownerId: "u1", stage: "new" },
    });
    expect(result).toEqual({ ok: true, lead: null });
  });
});
