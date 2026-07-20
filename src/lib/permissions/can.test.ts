import { describe, expect, it } from "vitest";
import {
  actionAllowed,
  moduleAllows,
  scopeAllowed,
} from "@/lib/permissions/evaluate";
import { SYSTEM_ROLE_PRESETS } from "@/lib/permissions/role-presets";
import { can, canAction, canAdminFeature } from "@/lib/permissions/can";

describe("permission evaluate", () => {
  it("director preset can view roles and manage roles", () => {
    const d = SYSTEM_ROLE_PRESETS.director;
    expect(moduleAllows(d.modules, "roles", "view")).toBe(true);
    expect(actionAllowed(d.actions, "roles.manage")).toBe(true);
    expect(scopeAllowed(d.modules, "leads")).toBe("all");
  });

  it("salesperson cannot view admin roles module", () => {
    const s = SYSTEM_ROLE_PRESETS.salesperson;
    expect(moduleAllows(s.modules, "roles", "view")).toBe(false);
    expect(actionAllowed(s.actions, "roles.manage")).toBe(false);
    expect(scopeAllowed(s.modules, "leads")).toBe("own");
  });

  it("can() uses legacy preset when no roleSnapshot", () => {
    expect(can({ roleId: "director", isSuperAdmin: false }, "ai_knowledge", "view")).toBe(
      true,
    );
    expect(can({ roleId: "salesperson", isSuperAdmin: false }, "ai_knowledge", "view")).toBe(
      false,
    );
  });

  it("canAction respects outreach.create_campaign on team_lead", () => {
    expect(
      canAction({ roleId: "team_lead", isSuperAdmin: false }, "outreach.create_campaign"),
    ).toBe(true);
    expect(
      canAction({ roleId: "salesperson", isSuperAdmin: false }, "outreach.create_campaign"),
    ).toBe(false);
  });

  it("canAdminFeature maps create_campaigns action", () => {
    expect(
      canAdminFeature({ roleId: "manager", isSuperAdmin: false }, "create_campaigns"),
    ).toBe(true);
    expect(
      canAdminFeature({ roleId: "salesperson", isSuperAdmin: false }, "create_campaigns"),
    ).toBe(false);
  });
});
