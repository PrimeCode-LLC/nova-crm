"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  CheckCircle2,
  Crosshair,
  Mail,
  MessageSquareReply,
  NotebookPen,
  Package,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
  Workflow,
  Rss,
  EyeOff,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserChip } from "@/components/common/user-chip";
import { buildOpsActivityFeed, type OpsFeedItem } from "@/lib/dashboard-ops-analytics";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityRecord, OrgActivityEvent, TimelineEvent } from "@/lib/types";

const ICONS: Partial<Record<string, React.ComponentType<{ className?: string }>>> = {
  lead_created: UserPlus,
  email_sent: Send,
  email_replied: MessageSquareReply,
  email_auto_replied: MessageSquareReply,
  followup_created: Mail,
  followup_completed: CheckCircle2,
  followup_plan_paused: Mail,
  meeting_scheduled: CalendarPlus,
  meeting_completed: CalendarPlus,
  prospect_channel_pushed: Workflow,
  lead_moved_back_to_prospect: Workflow,
  lead_task_created: CheckCircle2,
  lead_task_completed: CheckCircle2,
  note_added: NotebookPen,
  assignment_changed: Users,
  deal_created: CheckCircle2,
  stage_changed: Workflow,
  ai_analysis: Sparkles,
  strategy_created: Crosshair,
  strategy_updated: Crosshair,
  strategy_deleted: Crosshair,
  strategy_assigned: Crosshair,
  strategy_assignment_updated: Crosshair,
  strategy_assignment_paused: Crosshair,
  strategy_assignment_activated: Crosshair,
  strategy_assignment_removed: Crosshair,
  strategy_pack_imported: Package,
  intake_promoted: UploadCloud,
  intake_dismissed: EyeOff,
  intake_deleted: Trash2,
  intake_pool_emptied: Trash2,
  scraper_run: Rss,
  import_completed: UploadCloud,
  wall_exit_denied: ShieldAlert,
  wall_exit_attempt: ShieldAlert,
  wall_exited: ShieldCheck,
};

function feedHref(item: OpsFeedItem): string | undefined {
  if (item.href) return item.href;
  if (item.leadId) return `/leads/${item.leadId}`;
  return undefined;
}

function FeedRow({ item, wall }: { item: OpsFeedItem; wall?: boolean }) {
  const Icon = ICONS[item.type] ?? Mail;
  const href = feedHref(item);
  const inner = (
    <div
      className={cn(
        "flex gap-2.5 rounded-md px-2 py-2 transition-colors",
        !wall && "hover:bg-muted/40",
        wall && "animate-in fade-in slide-in-from-right-2 duration-500",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted",
          wall && "h-8 w-8",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5 text-muted-foreground", wall && "h-4 w-4")} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("leading-snug text-foreground", wall ? "text-sm" : "text-xs")}>
          {item.summary}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {item.actorId === "system" ? (
            <span>System</span>
          ) : item.actorId ? (
            <UserChip userId={item.actorId} size="xs" />
          ) : null}
          <span>{fmtRelative(item.createdAt)}</span>
        </div>
      </div>
    </div>
  );

  if (href && !wall) {
    return (
      <Link href={href} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function OpsActivityFeed({
  timelineByLead,
  orgActivityEvents,
  activityRecords,
  wall,
  className,
}: {
  timelineByLead: Record<string, TimelineEvent[]>;
  orgActivityEvents?: readonly OrgActivityEvent[];
  activityRecords?: readonly ActivityRecord[];
  wall?: boolean;
  className?: string;
}) {
  const items = React.useMemo(
    () =>
      buildOpsActivityFeed({
        timelineByLead,
        orgActivityEvents,
        activityRecords,
        limit: wall ? 24 : 18,
      }),
    [timelineByLead, orgActivityEvents, activityRecords, wall],
  );

  return (
    <Card
      className={cn(
        "flex min-h-0 flex-col",
        wall && "max-h-[min(70vh,640px)]",
        className,
      )}
    >
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
          Live activity
        </CardTitle>
        <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
          Prospects, outreach, follow-ups, scrapers, strategy, and imports
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-y-auto pt-0">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Activity will appear here as the team works.
          </p>
        ) : (
          <div className="space-y-0.5 pr-1">
            {items.map((item) => (
              <FeedRow key={item.id} item={item} wall={wall} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
