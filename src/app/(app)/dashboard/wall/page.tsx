"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, Monitor, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { OwnerOpsBoard } from "@/components/dashboard/owner-ops-board";
import {
  WallPinLockOverlay,
  WallPinSetupFields,
  clearStoredWallPinHash,
  hashWallPin,
  isValidWallPin,
  readStoredWallPinHash,
  writeStoredWallPinHash,
  WALL_PIN_GUARD_ACTOR,
} from "@/components/dashboard/wall-pin-lock";
import { cn } from "@/lib/utils";
import { WorkspacePageSkeleton } from "@/components/common/workspace-page-skeleton";
import { WorkspaceEmptyHint } from "@/components/common/workspace-empty-hint";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import { useSidebar } from "@/components/ui/sidebar";
import { computeDashboardWorkflowMetrics } from "@/lib/dashboard-workflow";
import { showOwnerOpsDashboard } from "@/lib/dashboard-ops-analytics";
import { DEFAULT_DASHBOARD_WIDGETS } from "@/lib/dashboard-preferences";
import { roleAtLeast } from "@/lib/platform/org-role";
import { getFirebaseDb } from "@/lib/firebase/client";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { persistUserNotificationCreate } from "@/lib/notifications/persist-user-notification-client";
import type { DashboardTimeRangeKey } from "@/lib/dashboard-date-range";
import type { OrgActivityEvent, OrgMemberRole } from "@/lib/types";

function newOrgActivityId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `oa-${crypto.randomUUID()}`;
  }
  return `oa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function lockEscapeKey() {
  try {
    const kb = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } })
      .keyboard;
    if (kb?.lock) await kb.lock(["Escape"]);
  } catch {
    /* unsupported or permission denied */
  }
}

function unlockEscapeKey() {
  try {
    const kb = (navigator as Navigator & { keyboard?: { unlock?: () => void } }).keyboard;
    kb?.unlock?.();
  } catch {
    /* ignore */
  }
}

export default function DashboardWallPage() {
  const router = useRouter();
  const {
    leads,
    deals,
    followups,
    followupPlans,
    leadTasks,
    users,
    timelineByLead,
    orgActivityEvents,
    activityRecords,
    currentUserId,
    getUserById,
    workspaceLoading,
    isDemo,
    viewerOrgRole,
    organizationId,
    addOrgActivityEvent,
  } = useWorkspace();

  const viewer = currentUserId ? getUserById(currentUserId) : undefined;
  const allowed = showOwnerOpsDashboard(viewer);
  const { setOpen, setOpenMobile } = useSidebar();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [clock, setClock] = React.useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [fsError, setFsError] = React.useState<string | null>(null);

  const [pin, setPin] = React.useState("");
  const [pinConfirm, setPinConfirm] = React.useState("");
  const [pinSetupError, setPinSetupError] = React.useState<string | null>(null);
  const [armedHash, setArmedHash] = React.useState<string | null>(() => readStoredWallPinHash());
  const [lockOpen, setLockOpen] = React.useState(() => Boolean(readStoredWallPinHash()));
  const armedRef = React.useRef(Boolean(readStoredWallPinHash()));
  const lockOpenRef = React.useRef(Boolean(readStoredWallPinHash()));
  const lastAttemptLogAtRef = React.useRef(0);

  React.useEffect(() => {
    armedRef.current = Boolean(armedHash);
  }, [armedHash]);

  React.useEffect(() => {
    lockOpenRef.current = lockOpen;
  }, [lockOpen]);

  React.useEffect(() => {
    setOpen(false);
    setOpenMobile(false);
  }, [setOpen, setOpenMobile]);

  React.useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      unlockEscapeKey();
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  function emitWallActivity(
    type: "wall_exit_denied" | "wall_exit_attempt" | "wall_exited",
    summary: string,
  ) {
    if (!currentUserId) return;
    const event: OrgActivityEvent = {
      id: newOrgActivityId(),
      type,
      actorId: currentUserId,
      summary,
      createdAt: new Date().toISOString(),
      href: "/dashboard/wall",
      entityType: "wall",
      entityId: "display",
    };
    addOrgActivityEvent(event);
  }

  function recordExitAttempt(reason: string, notify = true) {
    const now = Date.now();
    // Avoid flooding Live activity if Esc / fullscreen / Exit fire together.
    if (now - lastAttemptLogAtRef.current < 1500) return;
    lastAttemptLogAtRef.current = now;

    const summaries: Record<string, string> = {
      escape: "Escape pressed on the wall display (exit attempt)",
      fullscreen_lost: "Fullscreen left on the wall display (exit attempt)",
      exit_button: "Exit clicked on the wall display (exit attempt)",
      minimize: "Minimize clicked on the wall display (exit attempt)",
      back: "Browser Back used on the wall display (exit attempt)",
    };
    emitWallActivity("wall_exit_attempt", summaries[reason] ?? `Exit attempt on the wall display (${reason})`);

    if (!notify || isDemo || !currentUserId || !organizationId || !isFirebaseWebConfigured()) return;
    void (async () => {
      try {
        const db = getFirebaseDb();
        await persistUserNotificationCreate(db, {
          organizationId,
          recipientId: currentUserId,
          actorId: WALL_PIN_GUARD_ACTOR,
          kind: "security",
          message: "Someone tried to leave wall mode without entering the PIN.",
          target: "Wall display",
          targetHref: "/dashboard/wall",
        });
      } catch {
        /* best-effort */
      }
    })();
  }

  function openLockWithAttempt(reason: string) {
    if (!armedRef.current) return;
    const alreadyOpen = lockOpenRef.current;
    setLockOpen(true);
    if (!alreadyOpen) {
      recordExitAttempt(reason);
    } else if (reason === "escape") {
      // Still record repeated Esc presses while the lock is showing.
      recordExitAttempt("escape");
    }
  }

  React.useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    const onFs = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (fs) {
        setFsError(null);
        void lockEscapeKey();
        if (armedRef.current) setLockOpen(false);
      } else {
        unlockEscapeKey();
        if (armedRef.current) openLockWithAttempt("fullscreen_lost");
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("fullscreenchange", onFs);
    };
    // openLockWithAttempt closes over stable refs; re-bind only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Log Esc even when Keyboard Lock keeps fullscreen open. */
  React.useEffect(() => {
    if (!armedHash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!armedRef.current) return;
      e.preventDefault();
      openLockWithAttempt("escape");
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedHash]);

  /** Warn on tab close/reload while armed. */
  React.useEffect(() => {
    if (!armedHash) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [armedHash]);

  /** Trap browser Back while armed — re-open lock instead of leaving. */
  React.useEffect(() => {
    if (!armedHash) return;
    const marker = { wallPin: true };
    window.history.pushState(marker, "", window.location.href);
    const onPop = () => {
      if (!armedRef.current) return;
      window.history.pushState(marker, "", window.location.href);
      openLockWithAttempt("back");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedHash]);

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
      await lockEscapeKey();
    } catch {
      setFsError("Browser blocked fullscreen. Click again, or press F11 / Ctrl+Cmd+F.");
    }
  }

  async function armAndEnterFullscreen() {
    setPinSetupError(null);
    if (!isValidWallPin(pin)) {
      setPinSetupError("PIN must be 4–6 digits.");
      return;
    }
    if (pin !== pinConfirm) {
      setPinSetupError("PINs do not match.");
      return;
    }
    const hash = await hashWallPin(pin);
    writeStoredWallPinHash(hash);
    setArmedHash(hash);
    armedRef.current = true;
    setPin("");
    setPinConfirm("");
    await enterFullscreen();
    // If the browser blocked fullscreen, stay on the board with Exit still PIN-gated.
    if (!document.fullscreenElement) {
      setLockOpen(false);
    }
  }

  function requestExit() {
    if (armedHash) {
      openLockWithAttempt("exit_button");
      return;
    }
    router.push("/dashboard");
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await enterFullscreen();
      } else if (armedHash) {
        openLockWithAttempt("minimize");
      } else {
        await document.exitFullscreen();
      }
    } catch {
      setFsError("Could not toggle fullscreen. Try F11 (Windows) or Ctrl+Cmd+F (Mac).");
    }
  }

  async function onDeniedAttempt() {
    emitWallActivity("wall_exit_denied", "Wrong PIN entered on the wall display");
    if (isDemo || !currentUserId || !organizationId || !isFirebaseWebConfigured()) return;
    try {
      const db = getFirebaseDb();
      await persistUserNotificationCreate(db, {
        organizationId,
        recipientId: currentUserId,
        actorId: WALL_PIN_GUARD_ACTOR,
        kind: "security",
        message: "Someone entered a wrong PIN trying to exit wall mode.",
        target: "Wall display",
        targetHref: "/dashboard/wall",
      });
    } catch {
      /* best-effort */
    }
  }

  async function onUnlockSuccess() {
    emitWallActivity("wall_exited", "Wall display unlocked and exited");
    clearStoredWallPinHash();
    setArmedHash(null);
    armedRef.current = false;
    setLockOpen(false);
    unlockEscapeKey();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
    router.push("/dashboard");
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

  const showSetupGate = !isFullscreen && !armedHash && !lockOpen;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[200] flex flex-col overflow-hidden bg-background"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-chart-1/5 via-transparent to-transparent" />

      {showSetupGate ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-w-md rounded-xl border bg-card p-6 text-center shadow-lg">
            <Monitor className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold tracking-tight">Enter TV / wall display</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Hides the CRM sidebar and top bar. Set an exit PIN so the board stays protected if you
              step away.
            </p>
            <WallPinSetupFields
              className="mt-4"
              pin={pin}
              confirm={pinConfirm}
              onPinChange={setPin}
              onConfirmChange={setPinConfirm}
              error={pinSetupError}
            />
            <Button
              type="button"
              className="mt-5 w-full gap-2"
              onClick={() => void armAndEnterFullscreen()}
            >
              <Maximize2 className="h-4 w-4" />
              Arm PIN & enter fullscreen
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

      {armedHash ? (
        <WallPinLockOverlay
          open={lockOpen}
          pinHash={armedHash}
          onUnlock={() => void onUnlockSuccess()}
          onDenied={() => void onDeniedAttempt()}
          onReenterFullscreen={() => void enterFullscreen()}
        />
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={requestExit}
          >
            <X className="h-3.5 w-3.5" />
            Exit
          </Button>
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
          orgActivityEvents={orgActivityEvents}
          activityRecords={activityRecords}
          range={range}
          currentUserId={currentUserId}
          orgMeetingsScope={orgMeetingsScope}
          widgets={DEFAULT_DASHBOARD_WIDGETS}
          wall
          isDemo={isDemo}
        />
      </div>
    </div>
  );
}
