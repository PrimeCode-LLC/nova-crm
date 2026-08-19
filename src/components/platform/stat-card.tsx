import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  className,
  tone = "default",
}: {
  title: string;
  value: string | number;
  description?: string;
  icon?: LucideIcon;
  className?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning/30"
      : tone === "danger"
        ? "border-destructive/30"
        : "";

  return (
    <Card className={cn(toneClass, className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {description ? (
          <CardDescription className="mt-1">{description}</CardDescription>
        ) : null}
      </CardContent>
    </Card>
  );
}
