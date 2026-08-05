import { afterEach, describe, expect, it } from "vitest";
import {
  clearLegacyAccountTimezone,
  formatWorkspaceTimezoneChoice,
  LS_ACCOUNT_SETTINGS,
  normalizeWorkspaceTimezone,
  readLegacyAccountTimezone,
  workspaceTimezonesDiffer,
} from "@/lib/scheduling/workspace-timezone";

describe("workspace timezone sync helpers", () => {
  afterEach(() => {
    localStorage.removeItem(LS_ACCOUNT_SETTINGS);
  });

  it("treats empty, whitespace, and null as the same browser-fallback value", () => {
    expect(normalizeWorkspaceTimezone("  America/New_York ")).toBe("America/New_York");
    expect(normalizeWorkspaceTimezone("")).toBe("");
    expect(normalizeWorkspaceTimezone("   ")).toBe("");
    expect(normalizeWorkspaceTimezone(null)).toBe("");
    expect(workspaceTimezonesDiffer("", "   ")).toBe(false);
    expect(workspaceTimezonesDiffer("America/New_York", "Asia/Karachi")).toBe(true);
    expect(workspaceTimezonesDiffer("America/New_York", "America/New_York")).toBe(false);
  });

  it("labels browser fallback distinctly from a sticky zone", () => {
    expect(formatWorkspaceTimezoneChoice("America/New_York")).toContain("America/New York");
    expect(formatWorkspaceTimezoneChoice("")).toMatch(/browser timezone/i);
  });

  it("reads and clears the legacy Account localStorage timezone", () => {
    localStorage.setItem(
      LS_ACCOUNT_SETTINGS,
      JSON.stringify({ orgName: "Nova Inc.", timezone: "UTC+5 (PKT)" }),
    );
    expect(readLegacyAccountTimezone()).toBe("UTC+5 (PKT)");
    clearLegacyAccountTimezone();
    expect(readLegacyAccountTimezone()).toBe(null);
    expect(JSON.parse(localStorage.getItem(LS_ACCOUNT_SETTINGS) ?? "{}")).toEqual({
      orgName: "Nova Inc.",
    });
  });
});
