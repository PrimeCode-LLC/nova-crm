"use client";

import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";

/** Loads content calendar items and forwards checklist / overdue posts into Needs attention. */
export function DashboardNeedsAttentionWithContent({
  leads,
  followups,
  plans,
  tasks,
  currentUserId,
  contentScope = "mine",
  wall,
  className,
}: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  currentUserId: string;
  contentScope?: "mine" | "team";
  wall?: boolean;
  className?: string;
}) {
  const { items: contentItems } = useContentCalendarData();
  return (
    <DashboardNeedsAttention
      leads={leads}
      followups={followups}
      plans={plans}
      tasks={tasks}
      contentItems={contentItems}
      contentScope={contentScope}
      currentUserId={currentUserId}
      wall={wall}
      className={className}
    />
  );
}
