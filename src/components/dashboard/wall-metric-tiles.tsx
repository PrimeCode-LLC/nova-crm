import { cn } from "@/lib/utils";

export type WallMetricTone = "default" | "muted" | "success" | "accent" | "warn" | "info";

export type WallMetricItem = {
  label: string;
  value: string;
  tone?: WallMetricTone;
};

type Accent = {
  shell: string;
  label: string;
  value: string;
};

/** Map common sales metrics to a readable wall accent. */
function accentFor(item: WallMetricItem): Accent {
  if (item.tone === "success") {
    return {
      shell: "border-emerald-500/35 bg-emerald-500/10",
      label: "text-emerald-400/80",
      value: "text-emerald-300",
    };
  }
  if (item.tone === "warn") {
    return {
      shell: "border-amber-500/35 bg-amber-500/10",
      label: "text-amber-400/80",
      value: "text-amber-300",
    };
  }
  if (item.tone === "info") {
    return {
      shell: "border-sky-500/35 bg-sky-500/10",
      label: "text-sky-400/80",
      value: "text-sky-300",
    };
  }
  if (item.tone === "accent") {
    return {
      shell: "border-chart-1/40 bg-chart-1/10",
      label: "text-chart-1/90",
      value: "text-foreground",
    };
  }
  if (item.tone === "muted") {
    return {
      shell: "border-border/50 bg-muted/20",
      label: "text-muted-foreground",
      value: "text-muted-foreground",
    };
  }

  const key = item.label.toLowerCase();
  if (key.includes("won") || key.includes("lead")) {
    return {
      shell: "border-emerald-500/35 bg-emerald-500/10",
      label: "text-emerald-400/80",
      value: "text-emerald-300",
    };
  }
  if (key.includes("reply") || key.includes("replies")) {
    return {
      shell: "border-violet-500/35 bg-violet-500/10",
      label: "text-violet-400/80",
      value: "text-violet-200",
    };
  }
  if (key.includes("sent") || key.includes("email")) {
    return {
      shell: "border-sky-500/35 bg-sky-500/10",
      label: "text-sky-400/80",
      value: "text-sky-200",
    };
  }
  if (key.includes("prospect") || key.includes("quality") || key.includes("qualified")) {
    return {
      shell: "border-chart-1/40 bg-chart-1/10",
      label: "text-chart-1/90",
      value: "text-foreground",
    };
  }
  if (key.includes("pipeline") || key.includes("scheduled")) {
    return {
      shell: "border-amber-500/30 bg-amber-500/10",
      label: "text-amber-400/80",
      value: "text-amber-200",
    };
  }
  if (key.includes("overdue") || key.includes("failed")) {
    return {
      shell: "border-destructive/35 bg-destructive/10",
      label: "text-destructive/90",
      value: "text-destructive",
    };
  }

  return {
    shell: "border-border/60 bg-card/80",
    label: "text-muted-foreground",
    value: "text-foreground",
  };
}

/** Dense metric tiles for TV / wall boards - readable from across a room. */
export function WallMetricTiles({
  items,
  className,
  columns,
  compact,
}: {
  items: WallMetricItem[];
  className?: string;
  /** Prefer an explicit column count when you know the metric set size. */
  columns?: 3 | 4 | 6 | 8;
  /** Tighter padding/type for dense boards (e.g. non-wall strategy grids). */
  compact?: boolean;
}) {
  // Use fixed column counts (not `sm:`) - wall panels are often narrower than the
  // viewport breakpoint, which was collapsing 4-col grids into 2-per-row.
  const colClass =
    columns === 3
      ? "grid-cols-3"
      : columns === 4
        ? "grid-cols-4"
        : columns === 8
          ? "grid-cols-8"
          : columns === 6
            ? "grid-cols-6"
            : items.length <= 3
              ? "grid-cols-3"
              : items.length <= 4
                ? "grid-cols-4"
                : items.length <= 6
                  ? "grid-cols-6"
                  : "grid-cols-4";

  return (
    <div className={cn("grid", compact ? "gap-1" : "gap-1.5", colClass, className)}>
      {items.map((m) => {
        const accent = accentFor(m);
        return (
          <div
            key={m.label}
            className={cn(
              "border text-center shadow-sm backdrop-blur-[2px]",
              // One wall density for Team + Strategy so both scenes match.
              compact ? "rounded-md px-1.5 py-1" : "rounded-lg px-2 py-1.5",
              accent.shell,
            )}
          >
            <p
              className={cn(
                "truncate uppercase tracking-wide",
                compact
                  ? "text-[8px] font-semibold tracking-[0.08em]"
                  : "text-[10px] font-medium",
                accent.label,
              )}
            >
              {m.label}
            </p>
            <p
              className={cn(
                "truncate tabular-nums tracking-tight",
                compact ? "mt-0.5 text-xs font-bold" : "mt-0.5 text-sm font-semibold",
                accent.value,
              )}
            >
              {m.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
