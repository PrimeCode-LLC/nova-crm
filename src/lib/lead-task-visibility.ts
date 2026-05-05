import type { LeadTask, TimelineEvent, User } from "./types";

/**
 * Org-level or CRM roles that may see **all** team tasks in the tenant (oversight).
 * Aligns with `seesAllLeadsInTenant` / platform conventions.
 */
export function canViewAllLeadTasksInTenant(viewer: User): boolean {
  if (viewer.isSuperAdmin) return true;
  if (viewer.roleId === "director") return true;
  if (viewer.orgRole === "owner" || viewer.orgRole === "admin") return true;
  return false;
}

/** Whether this user may see this task (participant or oversight role). */
export function leadTaskVisibleForViewer(t: LeadTask, viewer: User): boolean {
  if (canViewAllLeadTasksInTenant(viewer)) return true;
  return t.assigneeId === viewer.id || t.createdById === viewer.id;
}

export function filterLeadTasksForViewer(tasks: readonly LeadTask[], viewer: User): LeadTask[] {
  return tasks.filter((t) => leadTaskVisibleForViewer(t, viewer));
}

export function filterLeadTasksForLeadDetail(
  tasks: readonly LeadTask[],
  leadId: string,
  viewer: User,
): LeadTask[] {
  return tasks.filter((t) => t.leadId === leadId && leadTaskVisibleForViewer(t, viewer));
}

/** Resolve viewer profile for permission checks (minimal fallback = not oversight). */
export function workspaceViewerForLeadTasks(
  getUserById: (id: string) => User | undefined,
  currentUserId: string,
): User {
  return (
    getUserById(currentUserId) ?? {
      id: currentUserId,
      email: "",
      displayName: "",
      roleId: "salesperson",
      status: "active",
      createdAt: new Date().toISOString(),
    }
  );
}

/**
 * Task-related timeline rows are not public on the lead. Hide unless the viewer may see the task,
 * or (legacy events without `payload.taskId`) only oversight roles.
 */
export function leadTaskTimelineEventVisible(
  e: TimelineEvent,
  viewer: User,
  tasks: readonly LeadTask[],
): boolean {
  if (e.type !== "lead_task_created" && e.type !== "lead_task_completed") return true;
  const taskId =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) && "taskId" in e.payload
      ? String((e.payload as { taskId?: unknown }).taskId ?? "")
      : "";
  if (taskId) {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return canViewAllLeadTasksInTenant(viewer);
    return leadTaskVisibleForViewer(t, viewer);
  }
  return canViewAllLeadTasksInTenant(viewer);
}
