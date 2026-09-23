import { leadFromPostgresRow, memberLeadScopeWhere } from "@/lib/db/list-leads-postgres";
import { withOrganizationScope } from "@/lib/db/tenant-scope";
import { endOfZonedDay, startOfZonedDay } from "@/lib/org-timezone";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";
import {
  countStrategyDayProgress,
  type StrategyDayProgress,
} from "@/lib/prospecting-strategy/progress";

/** Safety stop for one org-local day. The response says when this bound is hit. */
export const STRATEGY_DAY_PROGRESS_ROW_CAP = 4000;

export type StrategyDaySubject = {
  userId: string;
  strategyAssignmentIds: string[];
};

/**
 * Score today's prospects on the server. Callers pass only subjects the viewer may see.
 * Rows are not returned to the client.
 */
export async function loadStrategyDayProgress(input: {
  organizationId: string;
  subjects: readonly StrategyDaySubject[];
  narrowToMember: boolean;
  viewerUid: string;
  outreachThreshold?: number;
  now?: Date;
}): Promise<{
  results: { userId: string; strategyAssignmentIds: string[]; progress: StrategyDayProgress }[];
  truncated: boolean;
}> {
  const organizationId = input.organizationId.trim();
  const now = input.now ?? new Date();
  const timeZone = await getOrgTimezoneServer(organizationId);
  const dayStart = startOfZonedDay(now, timeZone);
  const dayEnd = new Date(endOfZonedDay(now, timeZone).getTime() + 1);
  const narrow = input.narrowToMember && Boolean(input.viewerUid.trim());

  const rows = await withOrganizationScope(organizationId, (tx) =>
    tx.lead.findMany({
      where: {
        organizationId,
        intakeKind: "prospect",
        createdAt: { gte: dayStart, lt: dayEnd },
        ...(narrow ? memberLeadScopeWhere(input.viewerUid) : {}),
      },
      orderBy: { createdAt: "desc" },
      take: STRATEGY_DAY_PROGRESS_ROW_CAP + 1,
    }),
  );

  const truncated = rows.length > STRATEGY_DAY_PROGRESS_ROW_CAP;
  const leads = (truncated ? rows.slice(0, STRATEGY_DAY_PROGRESS_ROW_CAP) : rows).map((row) =>
    leadFromPostgresRow(row, { slim: false }),
  );
  const threshold = input.outreachThreshold ?? 45;
  const results = [];
  for (const subject of input.subjects) {
    const userId = subject.userId.trim();
    if (!userId) continue;
    if (narrow && userId !== input.viewerUid.trim()) continue;
    results.push({
      userId,
      strategyAssignmentIds: subject.strategyAssignmentIds,
      progress: countStrategyDayProgress({
        leads,
        userId,
        strategyAssignmentIds: subject.strategyAssignmentIds,
        outreachThreshold: threshold,
        dayStart,
        dayEnd,
      }),
    });
  }
  return { results, truncated };
}
