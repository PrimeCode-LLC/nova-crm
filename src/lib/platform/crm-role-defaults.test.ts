import { describe, expect, it } from "vitest";
import {
  defaultCrmRoleIdForOrgRole,
  shouldUpgradeCrmRoleOnBackfill,
} from "./crm-role-defaults";

describe("defaultCrmRoleIdForOrgRole", () => {
  it("maps workspace roles to CRM defaults", () => {
    expect(defaultCrmRoleIdForOrgRole("owner")).toBe("director");
    expect(defaultCrmRoleIdForOrgRole("admin")).toBe("manager");
    expect(defaultCrmRoleIdForOrgRole("manager")).toBe("manager");
    expect(defaultCrmRoleIdForOrgRole("member")).toBe("salesperson");
  });
});

describe("shouldUpgradeCrmRoleOnBackfill", () => {
  it("upgrades missing roles and owners stuck on salesperson", () => {
    expect(shouldUpgradeCrmRoleOnBackfill("owner", undefined)).toBe(true);
    expect(shouldUpgradeCrmRoleOnBackfill("owner", "salesperson")).toBe(true);
    expect(shouldUpgradeCrmRoleOnBackfill("owner", "director")).toBe(false);
    expect(shouldUpgradeCrmRoleOnBackfill("member", "salesperson")).toBe(false);
  });
});
