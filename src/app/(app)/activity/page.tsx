"use client";

import Link from "next/link";
import { PageBody, PageHeader } from "@/components/common/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Daily rollup / activityCounters UI was retired. Route kept for nav/permissions.
 * Timeline events live on the dashboard (activityRecords / OwnerOpsBoard feed).
 */
export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        description="Manual daily rollups are no longer used."
      />
      <PageBody>
        <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            LinkedIn / Upwork counter logging and the daily rollup form have been removed.
            Live team activity and outreach events appear on the dashboard; workspace audit
            history is under Admin → Activity logs.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }))}>
              Go to dashboard
            </Link>
            <Link
              href="/admin/logs"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Activity logs
            </Link>
          </div>
        </div>
      </PageBody>
    </>
  );
}
