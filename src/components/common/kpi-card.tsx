import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  deltaType = "auto",
  className,
  href,
  onClick,
  selected,
  dense,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number; // percent change
  icon?: LucideIcon;
  deltaType?: "auto" | "positive-up" | "positive-down";
  className?: string;
  /** When set, the whole card navigates (preferred over onClick for dashboard KPI drill-down). */
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  /** Tighter padding/type for wall / dense strips. */
  dense?: boolean;
}) {
  let trend: "up" | "down" | "flat" = "flat";
  if (delta != null) {
    if (delta > 0) trend = "up";
    else if (delta < 0) trend = "down";
  }
  const isGood =
    deltaType === "positive-down"
      ? trend === "down"
      : trend === "up";
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;

  const interactive = Boolean(href || onClick);

  const card = (
    <Card
      className={cn(
        "relative h-full overflow-hidden transition-colors",
        interactive && "cursor-pointer hover:bg-muted/40",
        selected && "ring-2 ring-primary/60 border-primary/40",
        className,
      )}
      role={interactive && !href ? "button" : undefined}
      tabIndex={interactive && !href ? 0 : undefined}
      onClick={href ? undefined : onClick}
      onKeyDown={
        interactive && !href
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <CardContent className={cn("flex h-full flex-col", dense ? "p-2.5" : "p-4")}>
        <div className="flex items-center justify-between">
          <span
            className={cn(
              "font-medium uppercase tracking-wide text-muted-foreground",
              dense ? "text-[10px]" : "text-xs",
            )}
          >
            {label}
          </span>
          {Icon ? (
            <Icon
              className={cn("text-muted-foreground/70", dense ? "h-3.5 w-3.5" : "h-4 w-4")}
            />
          ) : null}
        </div>
        <div className={cn("flex items-baseline gap-2", dense ? "mt-1" : "mt-2")}>
          <span
            className={cn("font-semibold tabular-nums", dense ? "text-xl" : "text-2xl")}
          >
            {value}
          </span>
          {delta != null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                trend === "flat" && "bg-muted text-muted-foreground",
                trend !== "flat" &&
                  (isGood
                    ? "bg-success/10 text-success"
                    : "bg-destructive/10 text-destructive"),
              )}
            >
              <TrendIcon className="h-3 w-3" />
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        {/* Always reserve hint line height so KPI rows stay aligned when a card has no hint. */}
        <p
          className={cn(
            "text-muted-foreground",
            dense ? "mt-0.5 min-h-4 text-[11px]" : "mt-1 min-h-4 text-xs",
            !hint && "invisible",
          )}
        >
          {hint || "\u00A0"}
        </p>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block h-full rounded-xl text-inherit no-underline outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {card}
      </Link>
    );
  }

  return card;
}
