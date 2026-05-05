import type { DemoNotification } from "@/lib/inbox-demo-notifications";
import type { LeadTask, User } from "@/lib/types";

/** Inbox rows for tasks assigned to the viewer (open tasks only). */
export function buildLeadTaskInboxNotifications(
  tasks: LeadTask[],
  viewerId: string,
  users: User[],
): DemoNotification[] {
  const rows: DemoNotification[] = [];
  for (const t of tasks) {
    if (t.completedAt) continue;
    if (t.assigneeId !== viewerId) continue;
    const creator = users.find((u) => u.id === t.createdById);
    const senderLabel =
      creator?.displayName?.trim() ||
      creator?.email?.split("@")[0] ||
      t.createdById;
    const href = t.leadId ? `/leads/${t.leadId}?tab=tasks` : "/tasks";
    rows.push({
      id: `lt-inbox-${t.id}`,
      kind: "assignment",
      read: false,
      sender: t.createdById,
      message: `${senderLabel} assigned you: ${t.title}${t.contextCompany ? ` · ${t.contextCompany}` : ""}`,
      target: t.title,
      targetHref: href,
      timestamp: t.createdAt,
    });
  }
  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
