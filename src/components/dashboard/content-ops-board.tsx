"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays, Camera, Clapperboard, Layers } from "lucide-react";
import { KpiCard } from "@/components/common/kpi-card";
import { MyContentPlate } from "@/components/dashboard/my-content-plate";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONTENT_OPEN_STATUSES,
  type ContentItem,
} from "@/lib/content-calendar/types";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function endOfWeek(from: Date): number {
  const x = new Date(from);
  const day = x.getDay();
  const daysUntilSun = 7 - day;
  x.setDate(x.getDate() + daysUntilSun);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function contentOpsMetrics(items: readonly ContentItem[], currentUserId: string, now: number) {
  const weekEnd = endOfWeek(new Date(now));
  const weekStart = startOfDay(new Date(now));
  let myOpenSteps = 0;
  let scheduledThisWeek = 0;
  let publishedThisWeek = 0;

  for (const item of items) {
    const publishAt = item.publishAt ? new Date(item.publishAt).getTime() : Number.NaN;
    if (
      Number.isFinite(publishAt) &&
      publishAt >= weekStart &&
      publishAt <= weekEnd &&
      (item.status === "scheduled" || item.status === "approved")
    ) {
      scheduledThisWeek += 1;
    }
    if (item.status === "published" && item.completedAt) {
      const done = new Date(item.completedAt).getTime();
      if (Number.isFinite(done) && done >= weekStart && done <= weekEnd) {
        publishedThisWeek += 1;
      }
    }
    if (!CONTENT_OPEN_STATUSES.includes(item.status)) continue;
    const checklist = item.checklist ?? [];
    if (checklist.length === 0) {
      if (item.assigneeUserId === currentUserId || item.ownerUserId === currentUserId) {
        myOpenSteps += 1;
      }
      continue;
    }
    for (const step of checklist) {
      if (step.status === "pending" && step.assigneeUserId === currentUserId) {
        myOpenSteps += 1;
      }
    }
  }

  return { myOpenSteps, scheduledThisWeek, publishedThisWeek };
}

/** Content-team dashboard: personal plate + calendar pulse. No sales widgets. */
export function ContentOpsBoard({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const { brands, items, captures, loading } = useContentCalendarData();
  const [now] = React.useState(() => Date.now());
  const metrics = React.useMemo(
    () => contentOpsMetrics(items, currentUserId, now),
    [items, currentUserId, now],
  );
  const activeBrands = brands.filter((b) => b.active).length;
  const recentCaptures = captures.filter((c) => {
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) && now - t < 7 * 86_400_000;
  }).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="On my plate"
          value={loading ? "…" : metrics.myOpenSteps}
          hint="Checklist steps assigned to you"
          icon={Clapperboard}
          href="/content"
          tone={metrics.myOpenSteps > 0 ? "warn" : "default"}
        />
        <KpiCard
          label="Scheduled this week"
          value={loading ? "…" : metrics.scheduledThisWeek}
          hint="Approved / scheduled publish slots"
          icon={CalendarDays}
          href="/content"
          tone={metrics.scheduledThisWeek > 0 ? "info" : "default"}
        />
        <KpiCard
          label="Published this week"
          value={loading ? "…" : metrics.publishedThisWeek}
          hint="Completed in the last 7 days"
          icon={Layers}
          href="/content"
          tone={metrics.publishedThisWeek > 0 ? "success" : "default"}
        />
        <KpiCard
          label="Captures (7d)"
          value={loading ? "…" : recentCaptures}
          hint={`${activeBrands} active brand${activeBrands === 1 ? "" : "s"}`}
          icon={Camera}
          href="/content/capture"
          tone={recentCaptures === 0 ? "warn" : "default"}
        />
      </div>

      <MyContentPlate currentUserId={currentUserId} limit={10} />

      <div className="flex flex-wrap gap-2">
        <Link href="/content" className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
          Open calendar
        </Link>
        <Link
          href="/content/capture"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Capture proof
        </Link>
        <Link
          href="/content/brands"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Brands
        </Link>
      </div>
    </div>
  );
}
