import type { StrategyAssignment } from "@/lib/prospecting-strategy/types";

/** Active assignments for a user whose date window includes `now`. */
export function activeAssignmentsForUser(
  assignments: StrategyAssignment[],
  userId: string,
  now = new Date(),
): StrategyAssignment[] {
  const t = now.getTime();
  return assignments.filter((a) => {
    if (a.userId !== userId) return false;
    if (a.status !== "active") return false;
    if (a.startDate) {
      const start = Date.parse(a.startDate);
      if (!Number.isNaN(start) && t < start) return false;
    }
    if (a.endDate) {
      const end = Date.parse(a.endDate);
      if (!Number.isNaN(end) && t > end) return false;
    }
    return true;
  });
}

export function allocationTotal(assignments: StrategyAssignment[]): number {
  return assignments.reduce((sum, a) => sum + (Number.isFinite(a.allocationPct) ? a.allocationPct : 0), 0);
}

export function allocationIsValid(assignments: StrategyAssignment[], tolerance = 0.5): boolean {
  if (assignments.length === 0) return true;
  return Math.abs(allocationTotal(assignments) - 100) <= tolerance;
}

/**
 * Effective daily target for an assignment.
 * Precedence: assignment override → strategy default → globalDefault.
 */
export function effectiveDailyTarget(
  assignment: StrategyAssignment,
  strategyDefault: number | undefined,
  globalDefault = 150,
): number {
  if (assignment.targetOverride != null && Number.isFinite(assignment.targetOverride)) {
    return Math.max(0, Math.round(assignment.targetOverride));
  }
  const base =
    strategyDefault != null && Number.isFinite(strategyDefault) ? strategyDefault : globalDefault;
  return Math.max(0, Math.round(base));
}

/** Split a total daily target across assignments by allocation %. */
export function allocatedDailyTarget(
  assignment: StrategyAssignment,
  strategyDefault: number | undefined,
  globalDefault = 150,
): number {
  const total = effectiveDailyTarget(assignment, strategyDefault, globalDefault);
  const pct = Number.isFinite(assignment.allocationPct) ? assignment.allocationPct : 0;
  return Math.max(0, Math.round((total * pct) / 100));
}

export type TargetSource = "assignment_override" | "strategy_default" | "global_default";

export function dailyTargetSource(
  assignment: StrategyAssignment,
  strategyDefault: number | undefined,
): TargetSource {
  if (assignment.targetOverride != null && Number.isFinite(assignment.targetOverride)) {
    return "assignment_override";
  }
  if (strategyDefault != null && Number.isFinite(strategyDefault)) {
    return "strategy_default";
  }
  return "global_default";
}

export function targetSourceLabel(source: TargetSource): string {
  switch (source) {
    case "assignment_override":
      return "overridden for this assignment";
    case "strategy_default":
      return "inherited from strategy";
    default:
      return "global default";
  }
}
