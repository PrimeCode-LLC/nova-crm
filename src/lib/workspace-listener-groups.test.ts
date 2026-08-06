import { describe, expect, it } from "vitest";
import {
  CORE_WORKSPACE_GROUPS,
  DETACHABLE_WORKSPACE_GROUPS,
  LISTENER_GROUP_GRACE_MS,
  expireUnusedWorkspaceGroups,
  groupsForPathname,
  mergeWorkspaceGroups,
} from "./workspace-listener-groups";

describe("groupsForPathname", () => {
  it("returns no extra groups for settings/shell-only routes", () => {
    expect(groupsForPathname("/settings")).toEqual([]);
    expect(groupsForPathname("/team-chat")).toEqual([]);
    expect(groupsForPathname("/notifications")).toEqual([]);
  });

  it("maps archive like leads list", () => {
    expect(groupsForPathname("/archive")).toEqual(
      expect.arrayContaining(["directory", "plans", "campaigns"]),
    );
  });

  it("maps leads list and detail", () => {
    expect(groupsForPathname("/leads")).toEqual(
      expect.arrayContaining(["directory", "plans", "campaigns"]),
    );
    expect(groupsForPathname("/leads")).not.toContain("leadDetail");
    expect(groupsForPathname("/leads/abc")).toEqual(
      expect.arrayContaining(["directory", "deals", "plans", "timeline", "leadDetail", "campaigns"]),
    );
  });

  it("maps dashboard to ops groups without unbounded leadDetail", () => {
    const groups = groupsForPathname("/dashboard");
    expect(groups).toEqual(
      expect.arrayContaining(["deals", "plans", "timeline", "activity", "campaigns"]),
    );
    expect(groups).not.toContain("leadDetail");
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

describe("expireUnusedWorkspaceGroups", () => {
  const t0 = 1_000_000;

  it("never drops core", () => {
    const current = new Set(["core", "activity"] as const);
    const lastNeededAt = new Map([["activity" as const, t0]]);
    const next = expireUnusedWorkspaceGroups({
      current,
      lastNeededAt,
      stillNeeded: new Set(),
      now: t0 + LISTENER_GROUP_GRACE_MS + 1,
    });
    expect(next.has("core")).toBe(true);
    expect(next.has("activity")).toBe(false);
  });

  it("keeps groups still needed by the current route even if lastNeeded is old", () => {
    const current = new Set(["core", "activity", "timeline"] as const);
    const lastNeededAt = new Map([
      ["activity" as const, t0],
      ["timeline" as const, t0],
    ]);
    const next = expireUnusedWorkspaceGroups({
      current,
      lastNeededAt,
      stillNeeded: new Set(["activity"]),
      now: t0 + LISTENER_GROUP_GRACE_MS + 1,
    });
    expect(next.has("activity")).toBe(true);
    expect(next.has("timeline")).toBe(false);
  });

  it("keeps detachable groups inside the grace window", () => {
    const current = new Set(["core", "campaigns", "directory"] as const);
    const lastNeededAt = new Map([
      ["campaigns" as const, t0],
      ["directory" as const, t0],
    ]);
    const next = expireUnusedWorkspaceGroups({
      current,
      lastNeededAt,
      stillNeeded: new Set(),
      now: t0 + LISTENER_GROUP_GRACE_MS - 1,
    });
    expect(next.has("campaigns")).toBe(true);
    expect(next.has("directory")).toBe(true);
  });

  it("drops heavy groups after grace when not needed", () => {
    const current = new Set([
      "core",
      "activity",
      "timeline",
      "campaigns",
      "directory",
      "leadDetail",
    ] as const);
    const lastNeededAt = new Map(
      (["activity", "timeline", "campaigns", "directory", "leadDetail"] as const).map(
        (g) => [g, t0] as const,
      ),
    );
    const next = expireUnusedWorkspaceGroups({
      current,
      lastNeededAt,
      stillNeeded: new Set(),
      now: t0 + LISTENER_GROUP_GRACE_MS + 1,
    });
    expect([...next]).toEqual(["core"]);
    for (const g of DETACHABLE_WORKSPACE_GROUPS) {
      if (["activity", "timeline", "campaigns", "directory", "leadDetail"].includes(g)) {
        expect(next.has(g)).toBe(false);
      }
    }
  });

  it("keeps a group with no lastNeededAt timestamp (fail-safe)", () => {
    const current = new Set(["core", "plans"] as const);
    const next = expireUnusedWorkspaceGroups({
      current,
      lastNeededAt: new Map(),
      stillNeeded: new Set(),
      now: t0 + LISTENER_GROUP_GRACE_MS + 1,
    });
    expect(next.has("plans")).toBe(true);
  });
});
