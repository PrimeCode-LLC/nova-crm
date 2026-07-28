"use client";

import * as React from "react";
import Link from "next/link";
import { Clapperboard, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONTENT_CHECKLIST_STEP_LABELS,
  CONTENT_OPEN_STATUSES,
  type ContentItem,
} from "@/lib/content-calendar/types";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { fmtRelative } from "@/lib/format";

type PlateRow = {
  id: string;
  title: string;
  stepLabel: string;
  href: string;
  dueAt?: string;
  overdue: boolean;
};

function buildMyContentRows(items: readonly ContentItem[], currentUserId: string, now: number): PlateRow[] {
  const rows: PlateRow[] = [];
  for (const item of items) {
    if (!CONTENT_OPEN_STATUSES.includes(item.status)) continue;
    const checklist = item.checklist ?? [];
    if (checklist.length === 0) {
      if (item.assigneeUserId !== currentUserId && item.ownerUserId !== currentUserId) continue;
      const due = item.dueAt ? new Date(item.dueAt).getTime() : Number.NaN;
      const overdue = Number.isFinite(due) && due < now;
      if (!overdue) continue;
      rows.push({
        id: item.id,
        title: item.title,
        stepLabel: "Content",
        href: `/content/${item.id}`,
        dueAt: item.dueAt,
        overdue: true,
      });
      continue;
    }
    for (const step of checklist) {
      if (step.status !== "pending") continue;
      if (step.assigneeUserId !== currentUserId) continue;
      const dueRaw = step.dueAt || item.dueAt;
      const due = dueRaw ? new Date(dueRaw).getTime() : Number.NaN;
      rows.push({
        id: `${item.id}-${step.key}`,
        title: item.title,
        stepLabel: CONTENT_CHECKLIST_STEP_LABELS[step.key],
        href: `/content/${item.id}`,
        dueAt: dueRaw,
        overdue: Number.isFinite(due) && due < now,
      });
    }
  }
  return rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const at = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

/** Personal content checklist plate for dashboard. */
export function MyContentPlate({
  currentUserId,
  subjectLabel,
  className,
  limit = 6,
}: {
  currentUserId: string;
  /** When set, headings refer to this teammate instead of "you" / "My". */
  subjectLabel?: string;
  className?: string;
  limit?: number;
}) {
  const { items, loading } = useContentCalendarData();
  const [now] = React.useState(() => Date.now());
  const rows = React.useMemo(
    () => buildMyContentRows(items, currentUserId, now).slice(0, limit),
    [items, currentUserId, now, limit],
  );
  const total = React.useMemo(
    () => buildMyContentRows(items, currentUserId, now).length,
    [items, currentUserId, now],
  );
  const title = subjectLabel ? `${subjectLabel}'s content` : "My content";
  const description = subjectLabel
    ? `Checklist steps assigned to ${subjectLabel} across brands.`
    : "Checklist steps assigned to you across brands.";
  const emptyCopy = subjectLabel
    ? `No content steps on ${subjectLabel}'s plate.`
    : "No content steps on your plate.";

  return (
    <Card className={cn("min-h-0 shrink-0", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Clapperboard className="h-4 w-4" aria-hidden />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {total > 0 ? <Badge variant="secondary">{total}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {emptyCopy}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={row.href}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">
                      {row.stepLabel} · {row.title}
                    </span>
                    {row.dueAt ? (
                      <span
                        className={cn(
                          "block truncate text-xs",
                          row.overdue ? "text-amber-600" : "text-muted-foreground",
                        )}
                      >
                        {row.overdue ? "Overdue" : "Due"} {fmtRelative(row.dueAt)}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link href="/content" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Open calendar
        </Link>
      </CardContent>
    </Card>
  );
}
