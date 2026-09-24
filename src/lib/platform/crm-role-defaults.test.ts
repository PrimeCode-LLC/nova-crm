import { describe, expect, it } from "vitest";
import {
  defaultCrmRoleIdForOrgRole,
  shouldUpgradeCrmRoleForOrgRole,
  shouldUpgradeCrmRoleOnBackfill,
} from "./crm-role-defaults";
import {
  crmRoleRank,
  shouldAssignHigherCrmRole,
} from "@/lib/permissions/admin-feature-access-rank";

describe("defaultCrmRoleIdForOrgRole", () => {
  it("maps workspace roles to CRM defaults", () => {
    expect(defaultCrmRoleIdForOrgRole("owner")).toBe("director");
    expect(defaultCrmRoleIdForOrgRole("admin")).toBe("manager");
    expect(defaultCrmRoleIdForOrgRole("manager")).toBe("manager");
    expect(defaultCrmRoleIdForOrgRole("member")).toBe("salesperson");
  });
});

describe("shouldAssignHigherCrmRole", () => {
  it("assigns when current is missing", () => {
    expect(shouldAssignHigherCrmRole(undefined, "manager")).toBe(true);
    expect(shouldAssignHigherCrmRole("", "manager")).toBe(true);
  });

  it("upgrades salesperson to manager", () => {
    expect(shouldAssignHigherCrmRole("salesperson", "manager")).toBe(true);
  });

  it("does not demote director to manager", () => {
    expect(shouldAssignHigherCrmRole("director", "manager")).toBe(false);
  });

  it("does not overwrite custom roles", () => {
    expect(shouldAssignHigherCrmRole("custom_closer", "manager")).toBe(false);
    expect(crmRoleRank("custom_closer")).toBeUndefined();
  });

  it("does not upgrade equal ranks", () => {
    expect(shouldAssignHigherCrmRole("manager", "manager")).toBe(false);
  });
});

describe("shouldUpgradeCrmRoleForOrgRole", () => {
  it("upgrades admin invite when stuck on salesperson", () => {
    expect(shouldUpgradeCrmRoleForOrgRole("admin", "salesperson")).toBe(true);
  });

  it("does not demote director when inviting as admin", () => {
    expect(shouldUpgradeCrmRoleForOrgRole("admin", "director")).toBe(false);
  });

  it("does not demote manager when inviting as member", () => {
    expect(shouldUpgradeCrmRoleForOrgRole("member", "manager")).toBe(false);
  });

  it("does not overwrite custom CRM roles", () => {
    expect(shouldUpgradeCrmRoleForOrgRole("admin", "acme_custom")).toBe(false);
  });

  it("fills missing role for any org role", () => {
    expect(shouldUpgradeCrmRoleForOrgRole("member", undefined)).toBe(true);
    expect(shouldUpgradeCrmRoleForOrgRole("owner", undefined)).toBe(true);
  });
});

describe("shouldUpgradeCrmRoleOnBackfill", () => {
  it("upgrades missing roles and owners stuck on salesperson", () => {
    expect(shouldUpgradeCrmRoleOnBackfill("owner", undefined)).toBe(true);
    expect(shouldUpgradeCrmRoleOnBackfill("owner", "salesperson")).toBe(true);
    expect(shouldUpgradeCrmRoleOnBackfill("owner", "director")).toBe(false);
  });

  it("upgrades admin stuck on salesperson (generalized)", () => {
    expect(shouldUpgradeCrmRoleOnBackfill("admin", "salesperson")).toBe(true);
    expect(shouldUpgradeCrmRoleOnBackfill("member", "salesperson")).toBe(false);
  });
});
