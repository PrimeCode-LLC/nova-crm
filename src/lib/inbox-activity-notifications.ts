import type { DemoNotification, NotificationKind } from "@/lib/inbox-demo-notifications";
import type { ActivityRecord, Lead, User } from "@/lib/types";

const MAX_ROWS = 40;
/** Only surface fairly recent log lines in the bell / Notifications feed. */
const MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

function kindFromActivityType(type: string): NotificationKind {
  const t = type.toLowerCase();
  if (t.includes("stage")) return "stage";
  if (t.includes("followup")) return "followup";
  if (t.includes("mention")) return "mention";
  if (t.includes("task") || t.includes("assign")) return "assignment";
  if (t.includes("idle")) return "idle";
  return "form";
}

function humanizeType(type: string): string {
  return type.replace(/_/g, " ");
}

/**
 * Turns Activity page log rows into the same notification shape as tasks / demo seeds.
 * Skips rows authored by the viewer so your own manual logs do not ping you.
 */
export function buildActivityInboxNotifications(
  records: ActivityRecord[],
  viewerId: string,
  users: User[],
  getLeadById: (id: string) => Lead | undefined,
): DemoNotification[] {
  const now = Date.now();
  const cutoff = now - MAX_AGE_MS;
  const rows: DemoNotification[] = [];

  for (const r of records) {
    if (r.userId === viewerId) continue;
    const ts = new Date(r.occurredAt).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;

    const u = users.find((x) => x.id === r.userId);
    const actor =
      u?.displayName?.trim() || u?.email?.split("@")[0]?.trim() || "Teammate";
    const lead = r.leadId ? getLeadById(r.leadId) : undefined;
    const leadBit = lead ? ` · ${lead.contactName}` : "";
    const summary = (r.summary?.trim() || humanizeType(r.type)).trim();

    rows.push({
      id: `ar-inbox-${r.id}`,
      kind: kindFromActivityType(r.type),
      read: false,
      sender: r.userId,
      message: `${actor}: ${summary}${leadBit}`,
      target: summary.slice(0, 80),
      targetHref: r.leadId ? `/leads/${r.leadId}` : "/activity",
      timestamp: r.occurredAt,
    });
  }

  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_ROWS);
}
