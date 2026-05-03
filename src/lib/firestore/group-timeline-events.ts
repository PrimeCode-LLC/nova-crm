import type { TimelineEvent } from "@/lib/types";

/** Groups flat timeline docs into the `timelineByLead` snapshot shape (newest first per lead). */
export function groupTimelineEventsByLead(events: readonly TimelineEvent[]): Record<string, TimelineEvent[]> {
  const out: Record<string, TimelineEvent[]> = {};
  for (const e of events) {
    if (!e.leadId) continue;
    if (!out[e.leadId]) out[e.leadId] = [];
    out[e.leadId].push(e);
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return out;
}
