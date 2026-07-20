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
const TICK_MS = 50;

function ProgressBar({
  progress,
  paused,
}: {
  progress: number;
  paused: boolean;
}) {
  return (
    <div className="relative h-1 overflow-hidden rounded-full bg-muted/70">
      <div
        className={cn(
          "h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-[width] ease-linear",
          paused ? "opacity-50 duration-300" : "duration-75",
        )}
        style={{ width: `${progress * 100}%` }}
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
  const [progress, setProgress] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const pauseUntilRef = React.useRef(0);
  const elapsedRef = React.useRef(0);
  const indexRef = React.useRef(0);
  const dwellMsRef = React.useRef(dwellMs);
  const resumeIdleMsRef = React.useRef(resumeIdleMs);

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
    elapsedRef.current = 0;
    setProgress(0);
  }, [dwellMs]);

  // If a scene is removed, clamp the active index.
  React.useEffect(() => {
    if (count === 0) return;
    if (index >= count) {
      setIndex(0);
      elapsedRef.current = 0;
      setProgress(0);
    }
  }, [count, index]);

  const goTo = React.useCallback(
    (next: number) => {
      if (count === 0) return;
      const normalized = ((next % count) + count) % count;
      setIndex(normalized);
      elapsedRef.current = 0;
      setProgress(0);
    },
    [count],
  );

  const pauseBriefly = React.useCallback(() => {
    pauseUntilRef.current = Date.now() + resumeIdleMsRef.current;
    setPaused((was) => (was ? was : true));
  }, []);

  React.useEffect(() => {
    if (count <= 1) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      const shouldPause = now < pauseUntilRef.current;
      setPaused((was) => (was === shouldPause ? was : shouldPause));
      if (shouldPause) return;

      elapsedRef.current += TICK_MS;
      const ratio = Math.min(1, elapsedRef.current / dwellMsRef.current);
      setProgress(ratio);

      if (elapsedRef.current >= dwellMsRef.current) {
        const next = (indexRef.current + 1) % count;
        setIndex(next);
        elapsedRef.current = 0;
        setProgress(0);
      }
    }, TICK_MS);

    return () => window.clearInterval(id);
  }, [count]);

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

  const scene = scenes[Math.min(index, count - 1)] ?? scenes[0];
  const bar = showProgressBar ? <ProgressBar progress={progress} paused={paused} /> : null;

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
        {scenes.map((s, i) => {
          const active = i === index;
          return (
            <div
              key={s.id}
              aria-hidden={!active}
              className={cn(
                "absolute inset-0 flex min-h-0 flex-col overflow-hidden transition-opacity duration-[400ms] ease-out",
                active ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none",
              )}
            >
              {s.content}
            </div>
          );
        })}
      </div>

      <div className="mt-3 shrink-0 space-y-2">
        {progressBarPosition === "bottom" && bar ? bar : null}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {index + 1} / {count}
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
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "h-2 rounded-full transition-all duration-300",
                  i === index
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
