"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarClock, Clock, Plus, Sparkles } from "lucide-react";
import type { Followup } from "@/lib/types";
import { PRIORITY_TONE } from "@/lib/constants";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { UserChip } from "@/components/common/user-chip";

export function LeadFollowups({ followups }: { followups: Followup[] }) {
  const open = followups.filter((f) => !f.completedAt);
  const done = followups.filter((f) => f.completedAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Open followups</p>
          <p className="text-xs text-muted-foreground">
            Manual reminders + auto-generated idle warnings.
          </p>
        </div>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" /> Add followup
        </Button>
      </div>

      <ul className="space-y-2">
        {open.map((f) => {
          const due = new Date(f.dueAt);
          const overdue = due.getTime() < Date.now();
          return (
            <li
              key={f.id}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 bg-card",
                overdue && "border-destructive/30 bg-destructive/5",
              )}
            >
              <Checkbox />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{f.title}</span>
                  <Badge className={cn("rounded-md border-transparent text-[10px]", PRIORITY_TONE[f.priority].className)}>
                    {PRIORITY_TONE[f.priority].label}
                  </Badge>
                  {f.auto && (
                    <Badge variant="outline" className="text-[10px] gap-1">
                      <Sparkles className="h-2.5 w-2.5" /> Auto
                    </Badge>
                  )}
                </div>
                {f.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{f.description}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <UserChip userId={f.ownerId} size="xs" nameOnly />
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs tabular-nums",
                    overdue ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  <Clock className="h-3 w-3" />
                  {fmtDate(f.dueAt, "MMM d")} · {fmtRelative(f.dueAt)}
                </span>
              </div>
            </li>
          );
        })}
        {open.length === 0 && (
          <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto h-5 w-5 mb-2 opacity-60" />
            No open followups. Add one to stay on top of this lead.
          </div>
        )}
      </ul>

      {done.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-2">
            Completed
          </p>
          <ul className="space-y-1 mt-2">
            {done.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 rounded-md border px-3 py-1.5 bg-muted/20 opacity-70"
              >
                <Checkbox checked disabled />
                <span className="text-sm line-through text-muted-foreground truncate flex-1">
                  {f.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtRelative(f.completedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
