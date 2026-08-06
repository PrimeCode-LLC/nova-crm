"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { WallProgressBarPosition } from "@/lib/wall-preferences";

export type WallScene = {
  id: string;
  /** Short name for dots / counter */
  label: string;
  /** Motivational line under the counter */
  tagline: string;
  content: React.ReactNode;
};

const DEFAULT_DWELL_MS = 15_000;
const DEFAULT_RESUME_IDLE_MS = 8_000;

function ProgressBar({
  durationMs,
  paused,
  cycleKey,
}: {
  durationMs: number;
  paused: boolean;
  /** Bump to restart the CSS animation (new scene / dwell change). */
  cycleKey: number;
}) {
  return (
    <div className="relative h-1 overflow-hidden rounded-full bg-muted/70">
      <div
        key={cycleKey}
        className={cn(
          "h-full origin-left rounded-full bg-gradient-to-r from-primary/80 to-primary will-change-transform",
          paused && "opacity-50",
        )}
        style={{
          animationName: "wall-progress",
          animationDuration: `${durationMs}ms`,
          animationTimingFunction: "linear",
          animationFillMode: "forwards",
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}

export function WallSceneCarousel({
  scenes,
  className,
  dwellMs = DEFAULT_DWELL_MS,
  resumeIdleMs = DEFAULT_RESUME_IDLE_MS,
  showProgressBar = true,
  progressBarPosition = "top",
}: {
  scenes: WallScene[];
  className?: string;
  dwellMs?: number;
  resumeIdleMs?: number;
  showProgressBar?: boolean;
  progressBarPosition?: WallProgressBarPosition;
}) {
  const count = scenes.length;
  const [index, setIndex] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [cycleKey, setCycleKey] = React.useState(0);
  const pauseUntilRef = React.useRef(0);
  const indexRef = React.useRef(0);
  const dwellMsRef = React.useRef(Math.max(3_000, dwellMs));
  const resumeIdleMsRef = React.useRef(Math.max(1_000, resumeIdleMs));
  /** Elapsed ms in the current scene before the latest pause (for resume timeout). */
  const elapsedBeforePauseRef = React.useRef(0);
  const sceneStartedAtRef = React.useRef(0);

  React.useEffect(() => {
    dwellMsRef.current = Math.max(3_000, dwellMs);
  }, [dwellMs]);

  React.useEffect(() => {
    resumeIdleMsRef.current = Math.max(1_000, resumeIdleMs);
  }, [resumeIdleMs]);

  React.useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Reset progress when dwell length changes so the bar stays honest.
  React.useEffect(() => {
    elapsedBeforePauseRef.current = 0;
    sceneStartedAtRef.current = performance.now();
    setCycleKey((k) => k + 1);
  }, [dwellMs]);

  // If a scene is removed, clamp the active index.
  React.useEffect(() => {
    if (count === 0) return;
    if (index >= count) {
      setIndex(0);
      elapsedBeforePauseRef.current = 0;
      sceneStartedAtRef.current = performance.now();
      setCycleKey((k) => k + 1);
    }
  }, [count, index]);

  const goTo = React.useCallback(
    (next: number) => {
      if (count === 0) return;
      const normalized = ((next % count) + count) % count;
      setIndex(normalized);
      elapsedBeforePauseRef.current = 0;
      sceneStartedAtRef.current = performance.now();
      setCycleKey((k) => k + 1);
    },
    [count],
  );

  const pauseBriefly = React.useCallback(() => {
    const now = Date.now();
    const wasPaused = now < pauseUntilRef.current;
    if (!wasPaused) {
      // Capture how far we were into the dwell before pausing.
      const running = performance.now() - sceneStartedAtRef.current;
      elapsedBeforePauseRef.current = Math.min(
        dwellMsRef.current,
        elapsedBeforePauseRef.current + Math.max(0, running),
      );
      setPaused(true);
    }
    pauseUntilRef.current = now + resumeIdleMsRef.current;
  }, []);

  // Advance scenes with a single timeout (no 50ms React progress ticks).
  React.useEffect(() => {
    if (count <= 1) return;

    let timeoutId = 0;
    let pollId = 0;

    const scheduleAdvance = (delayMs: number) => {
      window.clearTimeout(timeoutId);
      sceneStartedAtRef.current = performance.now();
      timeoutId = window.setTimeout(() => {
        const next = (indexRef.current + 1) % count;
        setIndex(next);
        elapsedBeforePauseRef.current = 0;
        sceneStartedAtRef.current = performance.now();
        setCycleKey((k) => k + 1);
      }, Math.max(0, delayMs));
    };

    const remaining = () =>
      Math.max(0, dwellMsRef.current - elapsedBeforePauseRef.current);

    if (paused) {
      // Poll pause expiry lightly — only setState when actually resuming.
      pollId = window.setInterval(() => {
        if (Date.now() >= pauseUntilRef.current) {
          setPaused(false);
        }
      }, 250);
      return () => {
        window.clearInterval(pollId);
        window.clearTimeout(timeoutId);
      };
    }

    scheduleAdvance(remaining());
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(pollId);
    };
  }, [count, index, paused, cycleKey]);

  React.useEffect(() => {
    if (count <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        pauseBriefly();
        goTo(indexRef.current - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        pauseBriefly();
        goTo(indexRef.current + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, goTo, pauseBriefly]);

  if (count === 0) return null;

  const safeIndex = Math.min(index, count - 1);
  const scene = scenes[safeIndex] ?? scenes[0];
  const dwell = Math.max(3_000, dwellMs);
  const bar = showProgressBar ? (
    <ProgressBar durationMs={dwell} paused={paused} cycleKey={cycleKey} />
  ) : null;

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", className)}
      onPointerMove={pauseBriefly}
    >
      {progressBarPosition === "top" && bar ? <div className="shrink-0">{bar}</div> : null}

      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          progressBarPosition === "top" && bar && "mt-3",
        )}
      >
        {/* Mount only the active scene — inactive boards must not stay alive off-screen. */}
        <div
          key={scene.id}
          className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
        >
          {scene.content}
        </div>
      </div>

      <div className="mt-3 shrink-0 space-y-2">
        {progressBarPosition === "bottom" && bar ? bar : null}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {safeIndex + 1} / {count}
              <span className="mx-1.5 text-border">·</span>
              {scene.label}
            </p>
            <p className="truncate text-sm font-medium tracking-tight text-foreground">
              {scene.tagline}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {paused ? (
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Paused
              </span>
            ) : null}
            {scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Show ${s.label}`}
                aria-current={i === safeIndex ? "true" : undefined}
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === safeIndex
                    ? "w-6 bg-foreground"
                    : "w-2 bg-muted-foreground/35 hover:bg-muted-foreground/55",
                )}
                onClick={() => {
                  pauseBriefly();
                  goTo(i);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
