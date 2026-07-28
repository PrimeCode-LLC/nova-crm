"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Camera, CheckSquare, Clapperboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UserChip } from "@/components/common/user-chip";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { buildContentWallBoard, type ContentWallTone } from "@/lib/content-calendar/wall-board";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

function toneShell(tone: ContentWallTone): string {
  if (tone === "danger") return "border-destructive/35 bg-destructive/10";
  if (tone === "warn") return "border-amber-500/35 bg-amber-500/10";
  if (tone === "success") return "border-emerald-500/35 bg-emerald-500/10";
  return "border-border/60 bg-card/80";
}

function toneValue(tone: ContentWallTone): string {
  if (tone === "danger") return "text-destructive";
  if (tone === "warn") return "text-amber-300";
  if (tone === "success") return "text-emerald-300";
  return "text-foreground";
}

function QueueColumn({
  title,
  icon: Icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  const hasKids = React.Children.count(children) > 0;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border/60 bg-card/40">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <Badge variant="secondary" className="ml-auto h-5 tabular-nums">
          {count}
        </Badge>
      </div>
      {hasKids ? (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">{children}</ul>
      ) : (
        <p className="flex flex-1 items-center justify-center px-3 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      )}
    </div>
  );
}

/** TV / wall Content scene: brand pulse + checklist / schedule / capture queues. */
export function ContentWallBoard({ className }: { className?: string }) {
  const { brands, items, captures, loading } = useContentCalendarData();
  const [now] = React.useState(() => new Date());
  const board = React.useMemo(
    () => buildContentWallBoard({ brands, items, captures, now, queueLimit: 14 }),
    [brands, items, captures, now],
  );

  const brandCols =
    board.brands.length <= 3
      ? "grid-cols-3"
      : board.brands.length === 4
        ? "grid-cols-4"
        : board.brands.length === 5
          ? "grid-cols-5"
          : "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6";

  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-3", className)}>
      <div className="shrink-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-4 w-4 text-muted-foreground" aria-hidden />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Brand performance · this week
          </p>
          {loading ? (
            <span className="text-[11px] text-muted-foreground">Loading…</span>
          ) : null}
        </div>
        {board.brands.length === 0 && !loading ? (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            No active brands yet. Add brands in Content → Brands.
          </p>
        ) : (
          <div className={cn("grid gap-2", brandCols)}>
            {board.brands.map((b) => (
              <div
                key={b.brandId}
                className={cn(
                  "rounded-lg border px-2.5 py-2 shadow-sm backdrop-blur-[2px]",
                  toneShell(b.tone),
                )}
              >
                <p className="truncate text-sm font-semibold tracking-tight">{b.name}</p>
                <p className={cn("mt-0.5 text-lg font-bold tabular-nums", toneValue(b.tone))}>
                  {b.published}/{b.planned || "–"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{b.statusLabel}</p>
                <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  {b.overdue > 0 ? (
                    <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-destructive">
                      {b.overdue} overdue
                    </span>
                  ) : null}
                  {b.scheduled > 0 ? (
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-200">
                      {b.scheduled} queued
                    </span>
                  ) : null}
                  {b.captureTarget > 0 ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        b.captureIdle || b.captureBehind
                          ? "bg-amber-500/15 text-amber-200"
                          : "bg-muted/40",
                      )}
                    >
                      Cap {b.captureWeekCount}/{b.captureTarget}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        <QueueColumn
          title="Pending tasks"
          icon={CheckSquare}
          count={board.checklist.length}
          empty="Production queue clear"
        >
          {board.checklist.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href}
                className={cn(
                  "block rounded-md border px-2.5 py-1.5 text-sm",
                  row.tone === "danger"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border/70 bg-background/40",
                )}
              >
                <span className="line-clamp-1 font-medium">{row.title}</span>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {row.ownerId ? (
                    <UserChip userId={row.ownerId} size="xs" className="max-w-[7rem] shrink" />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 truncate text-[11px]",
                      row.overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {[row.detail, row.brandName, row.dueAt ? fmtRelative(row.dueAt) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </QueueColumn>

        <QueueColumn
          title="Pending scheduling"
          icon={CalendarClock}
          count={board.scheduling.length}
          empty="Nothing waiting to schedule"
        >
          {board.scheduling.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href}
                className={cn(
                  "block rounded-md border px-2.5 py-1.5 text-sm",
                  row.tone === "danger"
                    ? "border-destructive/30 bg-destructive/5"
                    : row.tone === "warn"
                      ? "border-amber-500/30 bg-amber-500/5"
                      : "border-border/70 bg-background/40",
                )}
              >
                <span className="line-clamp-1 font-medium">{row.title}</span>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {row.ownerId ? (
                    <UserChip userId={row.ownerId} size="xs" className="max-w-[7rem] shrink" />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 truncate text-[11px]",
                      row.overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {[row.detail, row.brandName, row.dueAt ? fmtRelative(row.dueAt) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </QueueColumn>

        <QueueColumn
          title="Pending capture"
          icon={Camera}
          count={board.capture.length}
          empty="Capture cadence healthy"
        >
          {board.capture.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href}
                className={cn(
                  "block rounded-md border px-2.5 py-1.5 text-sm",
                  row.tone === "danger"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <span className="line-clamp-1 font-medium">{row.title}</span>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {row.ownerId ? (
                    <UserChip userId={row.ownerId} size="xs" className="max-w-[7rem] shrink" />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 truncate text-[11px]",
                      row.overdue ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {row.detail}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </QueueColumn>
      </div>
    </div>
  );
}
