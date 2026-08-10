/**
 * Ops scoreboard cache keys + payload types (P0.13) — client-safe.
 */

import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { InboxPerfRow, OpsScorecardRow } from "@/lib/dashboard-ops-analytics";
import type { TeamCommandRow } from "@/lib/dashboard-team-command";
import type { StrategyScoreboardRow } from "@/lib/dashboard-strategy-scoreboard";

export type OpsScoreboardsPayload = {
  range: DashboardTimeRangeKey;
  outreachThreshold: number;
  teamCommand: TeamCommandRow[];
  strategy: {
    rows: StrategyScoreboardRow[];
    attributionCoverage: number;
    prospectsInRange: number;
    attributedInRange: number;
  };
  inbox: InboxPerfRow[];
  opsScorecard: OpsScorecardRow[];
  updatedAt: string;
};

export function opsScoreboardsCacheKey(
  organizationId: string,
  range: DashboardTimeRangeKey,
): string {
  return `dash:ops-scoreboards:v1:${organizationId.trim()}:${range}`;
}

export function isOpsScoreboardsRange(value: string): value is DashboardTimeRangeKey {
  return (
    value === "today" ||
    value === "12h" ||
    value === "1d" ||
    value === "7d" ||
    value === "30d" ||
    value === "90d" ||
    value === "qtd" ||
    value === "ytd" ||
    value === "all"
  );
}
