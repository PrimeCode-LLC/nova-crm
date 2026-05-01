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
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: number; // percent change
  icon?: LucideIcon;
  deltaType?: "auto" | "positive-up" | "positive-down";
  className?: string;
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

  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          {Icon && (
            <Icon className="h-4 w-4 text-muted-foreground/70" />
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {delta != null && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium tabular-nums",
                trend === "flat" && "bg-muted text-muted-foreground",
                trend !== "flat" &&
                  (isGood
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"),
              )}
            >
              <TrendIcon className="h-3 w-3" />
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
        {hint && (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
