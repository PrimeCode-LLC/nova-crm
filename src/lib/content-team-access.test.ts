import { describe, expect, it } from "vitest";
import {
  defaultDashboardPreferences,
  resolveContentLayout,
  resolveFrontlineLayout,
  resolveOpsLayout,
} from "@/lib/dashboard-preferences";
import { canAccessNavItem, type NavAccessContext, type NavItem } from "@/lib/nav";
import { buildDemoContentCalendar, DEMO_CONTENT_USER_ID } from "@/lib/demo-content-calendar";
import { resolveModuleHrefForPath } from "@/lib/permissions/resolve-module-href";
import { LayoutDashboard } from "lucide-react";

function nav(href: string, label: string): NavItem {
  return { href, label, icon: LayoutDashboard };
}

describe("content_team dashboard + access", () => {
  it("auto-resolves content layout for content_team", () => {
    const prefs = defaultDashboardPreferences();
    expect(resolveContentLayout("content_team", prefs)).toBe(true);
    expect(resolveFrontlineLayout("content_team", prefs)).toBe(false);
    expect(resolveOpsLayout(true, "content_team", prefs)).toBe(false);
  });

  it("hides sales nav for content_team without a roleSnapshot (demo)", () => {
    const ctx: NavAccessContext = {
      roleId: "content_team",
      isSuperAdmin: false,
      roleSnapshot: null,
      roleLoading: false,
    };
    expect(canAccessNavItem(nav("/dashboard", "Dashboard"), ctx)).toBe(true);
    expect(canAccessNavItem(nav("/content", "Content"), ctx)).toBe(true);
    expect(canAccessNavItem(nav("/inbox", "Inbox"), ctx)).toBe(true);
    expect(canAccessNavItem(nav("/leads", "Leads"), ctx)).toBe(false);
    expect(canAccessNavItem(nav("/pipeline", "Pipeline"), ctx)).toBe(false);
    expect(canAccessNavItem(nav("/deals", "Deals"), ctx)).toBe(false);
  });

  it("resolves nested content and leads paths for module gating", () => {
    expect(resolveModuleHrefForPath("/content/brands")).toBe("/content");
    expect(resolveModuleHrefForPath("/leads/abc")).toBe("/leads");
    expect(resolveModuleHrefForPath("/settings")).toBe("/settings");
  });

  it("seeds demo content with checklist work for the content persona", () => {
    const seed = buildDemoContentCalendar(DEMO_CONTENT_USER_ID);
    expect(seed.brands.length).toBeGreaterThan(0);
    expect(
      seed.items.some((i) => i.checklist?.some((s) => s.assigneeUserId === DEMO_CONTENT_USER_ID)),
    ).toBe(true);
  });
});
