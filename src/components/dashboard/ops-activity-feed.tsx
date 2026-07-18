"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  CheckCircle2,
  Mail,
  MessageSquareReply,
  NotebookPen,
  Send,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserChip } from "@/components/common/user-chip";
import { buildOpsActivityFeed, type OpsFeedItem } from "@/lib/dashboard-ops-analytics";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TimelineEvent, TimelineEventType } from "@/lib/types";

const ICONS: Partial<Record<TimelineEventType | string, React.ComponentType<{ className?: string }>>> = {
  lead_created: UserPlus,
  email_sent: Send,
  email_replied: MessageSquareReply,
  followup_created: Mail,
  followup_completed: CheckCircle2,
  meeting_scheduled: CalendarPlus,
  meeting_completed: CalendarPlus,
  prospect_channel_pushed: Workflow,
  lead_task_created: CheckCircle2,
  lead_task_completed: CheckCircle2,
  note_added: NotebookPen,
  assignment_changed: Users,
  deal_created: CheckCircle2,
};

function FeedRow({ item, wall }: { item: OpsFeedItem; wall?: boolean }) {
  const Icon = ICONS[item.type] ?? Mail;
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
          {item.actorId ? <UserChip userId={item.actorId} size="xs" /> : null}
          <span>{fmtRelative(item.createdAt)}</span>
        </div>
      </div>
    </div>
  );

  if (item.leadId && !wall) {
    return (
      <Link href={`/leads/${item.leadId}`} className="block">
        {inner}
      </Link>
    );
  }
  return inner;
}

export function OpsActivityFeed({
  timelineByLead,
  wall,
  className,
}: {
  timelineByLead: Record<string, TimelineEvent[]>;
  wall?: boolean;
  className?: string;
}) {
  const items = React.useMemo(
    () => buildOpsActivityFeed({ timelineByLead, limit: wall ? 24 : 18 }),
    [timelineByLead, wall],
  );

  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="pb-2">
        <CardTitle className={cn("font-semibold", wall ? "text-base" : "text-sm")}>
          Live activity
        </CardTitle>
        <CardDescription className={cn(wall ? "text-sm" : "text-xs")}>
          Who added prospects, sent email, scheduled follow-ups
        </CardDescription>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-hidden pt-0">
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Activity will appear here as the team works.
          </p>
        ) : (
          <div
            className={cn(
              "h-full space-y-0.5 overflow-y-auto pr-1",
              wall && "max-h-[min(70vh,640px)]",
            )}
          >
            {items.map((item) => (
              <FeedRow key={item.id} item={item} wall={wall} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
