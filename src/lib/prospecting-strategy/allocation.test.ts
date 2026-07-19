import { describe, expect, it } from "vitest";
import {
  allocatedDailyTarget,
  allocationIsValid,
  allocationTotal,
  dailyTargetSource,
  effectiveDailyTarget,
} from "@/lib/prospecting-strategy/allocation";
import type { StrategyAssignment } from "@/lib/prospecting-strategy/types";

function assignment(partial: Partial<StrategyAssignment> & Pick<StrategyAssignment, "id">): StrategyAssignment {
  return {
    organizationId: "org",
    strategyId: "ps-1",
    userId: "u-1",
    assignmentType: "primary",
    priority: 50,
    allocationPct: 100,
    status: "active",
    assignedBy: "u-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("prospecting strategy allocation", () => {
  it("splits 150 across 50/30/20", () => {
    const a = assignment({ id: "a", allocationPct: 50 });
    const b = assignment({ id: "b", allocationPct: 30 });
    const c = assignment({ id: "c", allocationPct: 20 });
    expect(allocatedDailyTarget(a, 150)).toBe(75);
    expect(allocatedDailyTarget(b, 150)).toBe(45);
    expect(allocatedDailyTarget(c, 150)).toBe(30);
    expect(allocationTotal([a, b, c])).toBe(100);
    expect(allocationIsValid([a, b, c])).toBe(true);
  });

  it("uses assignment override over strategy default", () => {
    const a = assignment({ id: "a", allocationPct: 100, targetOverride: 100 });
    expect(effectiveDailyTarget(a, 150)).toBe(100);
    expect(dailyTargetSource(a, 150)).toBe("assignment_override");
    expect(allocatedDailyTarget(a, 150)).toBe(100);
  });

  it("rejects allocations that do not total 100", () => {
    const a = assignment({ id: "a", allocationPct: 60 });
    const b = assignment({ id: "b", allocationPct: 30 });
    expect(allocationIsValid([a, b])).toBe(false);
  });
});
