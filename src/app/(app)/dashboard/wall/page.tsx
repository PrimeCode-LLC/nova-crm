"use client";

import * as React from "react";
import Link from "next/link";
import { Maximize2, Minimize2, Monitor, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { OwnerOpsBoard } from "@/components/dashboard/owner-ops-board";
import { cn } from "@/lib/utils";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useSidebar } from "@/components/ui/sidebar";
import { computeDashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import { showOwnerOpsDashboard } from "@/lib/dashboard-ops-analytics";
import { DEFAULT_DASHBOARD_WIDGETS } from "@/lib/dashboard-preferences";
import { roleAtLeast } from "@/lib/platform/org-role";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { OrgMemberRole } from "@/lib/types";

export default function DashboardWallPage() {
  const {
    leads,
    deals,
    followups,
    followupPlans,
    leadTasks,
    users,
    timelineByLead,
    currentUserId,
    getUserById,
    workspaceLoading,
    isDemo,
    viewerOrgRole,
  } = useWorkspace();

  const viewer = currentUserId ? getUserById(currentUserId) : undefined;
  const allowed = showOwnerOpsDashboard(viewer);
  const { setOpen, setOpenMobile } = useSidebar();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [clock, setClock] = React.useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [fsError, setFsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setOpen(false);
    setOpenMobile(false);
  }, [setOpen, setOpenMobile]);

  React.useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  React.useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      if (document.fullscreenElement) setFsError(null);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const range: DashboardTimeRangeKey = "7d";
  const metrics = React.useMemo(
    () =>
      computeDashboardWorkflowMetrics({
        leads,
        followups,
        plans: followupPlans,
        tasks: leadTasks,
        currentUserId,
        range,
      }),
    [leads, followups, followupPlans, leadTasks, currentUserId],
  );

  const orgRole = (viewerOrgRole ?? viewer?.orgRole) as OrgMemberRole | undefined;
  const orgMeetingsScope = orgRole ? roleAtLeast(orgRole, "manager") : false;

  async function enterFullscreen() {
    setFsError(null);
    const el = rootRef.current ?? document.documentElement;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      }
    } catch {
      setFsError("Browser blocked fullscreen. Click again, or press F11 / Ctrl+Cmd+F.");
    }
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await enterFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setFsError("Could not toggle fullscreen. Try F11 (Windows) or Ctrl+Cmd+F (Mac).");
    }
  }

  if (workspaceLoading) {
    return (
      <div className="fixed inset-0 z-[200] bg-background p-6">
        <WorkspacePageSkeleton />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-background p-8">
        <p className="text-sm text-muted-foreground">Wall mode is for owners and managers.</p>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!isDemo && leads.length === 0) {
    return (
      <div className="fixed inset-0 z-[200] overflow-auto bg-background p-8">
        <WorkspaceEmptyHint
          title="No data for the wall board yet"
          description="Add prospects, leads, and outreach activity so the board has something to show."
        />
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-background"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-chart-1/5 via-transparent to-transparent" />

      {!isFullscreen ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-lg">
            <Monitor className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Enter TV / wall display</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Hides the CRM sidebar and top bar. Fullscreen also hides browser tabs and the address
              bar — required for a clean office screen.
            </p>
            <Button type="button" className="mt-5 w-full gap-2" onClick={() => void enterFullscreen()}>
              <Maximize2 className="h-4 w-4" />
              Enter fullscreen
            </Button>
            {fsError ? <p className="mt-3 text-xs text-destructive">{fsError}</p> : null}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Tip for a dedicated TV: open this URL in Chrome and use F11, or launch with{" "}
              <code className="rounded bg-muted px-1 py-0.5">--kiosk</code>.
            </p>
            <Link
              href="/dashboard"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-3")}
            >
              Cancel
            </Link>
          </div>
        </div>
      ) : null}

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-5 py-3 backdrop-blur-md">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sales ops · live
          </p>
          <h1 className="text-lg font-semibold tracking-tight">Command board</h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden tabular-nums text-sm text-muted-foreground sm:block">
            {clock.toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
          >
            <X className="h-3.5 w-3.5" />
            Exit
          </Link>
        </div>
      </header>

      <div className="relative z-10 min-h-0 flex-1 overflow-auto p-4 md:p-5">
        <OwnerOpsBoard
          metrics={metrics}
          leads={leads}
          deals={deals}
          followups={followups}
          plans={followupPlans}
          tasks={leadTasks}
          users={users}
          timelineByLead={timelineByLead}
          range={range}
          currentUserId={currentUserId}
          orgMeetingsScope={orgMeetingsScope}
          widgets={DEFAULT_DASHBOARD_WIDGETS}
          wall
        />
      </div>
    </div>
  );
}
