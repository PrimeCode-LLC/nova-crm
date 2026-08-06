import { describe, expect, it } from "vitest";
import {
  CORE_WORKSPACE_GROUPS,
  groupsForPathname,
  mergeWorkspaceGroups,
} from "./workspace-listener-groups";

describe("groupsForPathname", () => {
  it("returns no extra groups for settings/shell-only routes", () => {
    expect(groupsForPathname("/settings")).toEqual([]);
    expect(groupsForPathname("/team-chat")).toEqual([]);
    expect(groupsForPathname("/notifications")).toEqual([]);
  });

  it("maps leads list and detail", () => {
    expect(groupsForPathname("/leads")).toEqual(
      expect.arrayContaining(["directory", "plans", "campaigns"]),
    );
    expect(groupsForPathname("/leads")).not.toContain("leadDetail");
    expect(groupsForPathname("/leads/abc")).toEqual(
      expect.arrayContaining(["directory", "deals", "plans", "leadDetail", "campaigns"]),
    );
  });

  it("maps dashboard to heavy groups", () => {
    expect(groupsForPathname("/dashboard")).toEqual(
      expect.arrayContaining(["deals", "plans", "leadDetail", "activity", "campaigns"]),
    );
  });

  it("maps inbox to directory and plans", () => {
    expect(groupsForPathname("/inbox")).toEqual(
      expect.arrayContaining(["directory", "plans"]),
    );
    expect(groupsForPathname("/inbox")).not.toContain("activity");
  });

  it("merge always includes core", () => {
    const merged = mergeWorkspaceGroups(CORE_WORKSPACE_GROUPS, groupsForPathname("/inbox"));
    expect(merged.has("core")).toBe(true);
    expect(merged.has("directory")).toBe(true);
    expect(merged.has("plans")).toBe(true);
  });
});
