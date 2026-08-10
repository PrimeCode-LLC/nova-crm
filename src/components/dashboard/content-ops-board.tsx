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
import { useContentOpsSummary } from "@/hooks/use-content-ops-summary";

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
  subjectLabel,
}: {
  currentUserId: string;
  /** When set, plate copy refers to this teammate instead of "you". */
  subjectLabel?: string;
}) {
  const { brands, items, captures, loading } = useContentCalendarData();
  const summary = useContentOpsSummary({ enabled: !subjectLabel });
  const [now] = React.useState(() => Date.now());
  const liveMetrics = React.useMemo(
    () => contentOpsMetrics(items, currentUserId, now),
    [items, currentUserId, now],
  );
  const liveActiveBrands = brands.filter((b) => b.active).length;
  const liveRecentCaptures = captures.filter((c) => {
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) && now - t < 7 * 86_400_000;
  }).length;

  const useSummary =
    summary.enabled && summary.org && summary.person && !subjectLabel;
  const myOpenSteps = useSummary ? summary.person!.myOpenSteps : liveMetrics.myOpenSteps;
  const scheduledThisWeek = useSummary
    ? summary.org!.scheduledThisWeek
    : liveMetrics.scheduledThisWeek;
  const publishedThisWeek = useSummary
    ? summary.org!.publishedThisWeek
    : liveMetrics.publishedThisWeek;
  const activeBrands = useSummary ? summary.org!.activeBrands : liveActiveBrands;
  const recentCaptures = useSummary ? summary.org!.recentCaptures : liveRecentCaptures;
  const showLoading = useSummary ? summary.loading : loading;

  const plateHint = subjectLabel
    ? `Checklist steps assigned to ${subjectLabel}`
    : "Checklist steps assigned to you";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label={subjectLabel ? "On their plate" : "On my plate"}
          value={showLoading ? "…" : myOpenSteps}
          hint={plateHint}
          icon={Clapperboard}
          href="/content"
          tone={myOpenSteps > 0 ? "warn" : "default"}
        />
        <KpiCard
          label="Scheduled this week"
          value={showLoading ? "…" : scheduledThisWeek}
          hint="Approved / scheduled publish slots"
          icon={CalendarDays}
          href="/content"
          tone={scheduledThisWeek > 0 ? "info" : "default"}
        />
        <KpiCard
          label="Published this week"
          value={showLoading ? "…" : publishedThisWeek}
          hint="Completed in the last 7 days"
          icon={Layers}
          href="/content"
          tone={publishedThisWeek > 0 ? "success" : "default"}
        />
        <KpiCard
          label="Captures (7d)"
          value={showLoading ? "…" : recentCaptures}
          hint={`${activeBrands} active brand${activeBrands === 1 ? "" : "s"}`}
          icon={Camera}
          href="/content/capture"
          tone={recentCaptures === 0 ? "warn" : "default"}
        />
      </div>

      <MyContentPlate currentUserId={currentUserId} subjectLabel={subjectLabel} limit={10} />

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
