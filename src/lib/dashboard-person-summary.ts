/**
 * Person-scoped dashboard task gauges (P0.11) — shared types + pure compute.
 * Server Redis/Firestore I/O lives in `dashboard-person-summary-server.ts`.
 */

export type PersonDashboardTaskGauges = {
  myOpenTasks: number;
  overdueTasks: number;
  waitingOnOthers: number;
  updatedAt: string;
};

export function personDashboardCacheKey(organizationId: string, userId: string): string {
  return `dash:person:v1:${organizationId.trim()}:${userId.trim()}`;
}

function validTime(iso: unknown): number | undefined {
  if (typeof iso !== "string" || !iso) return undefined;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : undefined;
}

export function computePersonDashboardTaskGauges(
  tasks: readonly {
    assigneeId?: string | null;
    createdById?: string | null;
    completedAt?: string | null;
    dueAt?: string | null;
  }[],
  userId: string,
  nowMs: number = Date.now(),
): Omit<PersonDashboardTaskGauges, "updatedAt"> {
  const openTasks = tasks.filter((task) => !task.completedAt);
  return {
    myOpenTasks: openTasks.filter((task) => task.assigneeId === userId).length,
    overdueTasks: openTasks.filter((task) => {
      const due = validTime(task.dueAt);
      return task.assigneeId === userId && due !== undefined && due < nowMs;
    }).length,
    waitingOnOthers: openTasks.filter(
      (task) => task.createdById === userId && task.assigneeId !== userId,
    ).length,
  };
}
