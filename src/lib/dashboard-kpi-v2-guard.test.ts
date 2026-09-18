/**
 * Guard: production dashboard must not rely on client aggregate helpers when
 * DASHBOARD_KPI_API_V2 is on. Demo mode may still compute client-side.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("dashboard KPI V2 production guard", () => {
  it("dashboard page prefers API payload when kpiV2 is enabled", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
      "utf8",
    );
    expect(src).toContain("useDashboardKpis");
    expect(src).toContain("isDashboardKpiApiV2Enabled");
    expect(src).toMatch(/if \(kpiV2 && dashboardKpis\.payload\?\.workflow\)/);
    // Production path must not aggregate workspace arrays when V2 is on.
    expect(src).toMatch(/kpiV2 && !isDemo/);
    expect(src).toMatch(
      /kpiV2 && !isDemo[\s\S]*?leads:\s*\[\s*\]/,
    );
  });

  it("demo path is the only intended client-aggregate escape hatch", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(app)/dashboard/page.tsx"),
      "utf8",
    );
    expect(src).toContain("enabled: kpiV2 && !isDemo");
  });
});
