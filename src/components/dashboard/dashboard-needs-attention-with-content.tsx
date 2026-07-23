"use client";

import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import type { Followup, FollowupPlan, Lead, LeadTask } from "@/lib/types";

/** Loads content calendar items and forwards overdue posts into Needs attention. */
export function DashboardNeedsAttentionWithContent({
  leads,
  followups,
  plans,
  tasks,
  currentUserId,
  wall,
  className,
}: {
  leads: readonly Lead[];
  followups: readonly Followup[];
  plans: readonly FollowupPlan[];
  tasks: readonly LeadTask[];
  currentUserId: string;
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
      currentUserId={currentUserId}
      wall={wall}
      className={className}
    />
  );
}
