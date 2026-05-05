import { Badge } from "@/components/ui/badge";
import { STAGES_BY_KEY } from "@/lib/constants";
import type { PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STAGE_TONE_CLASS: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  blue: "bg-info/10 text-info border-info/20",
  cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
  green: "bg-success/10 text-success border-success/20",
  red: "bg-destructive/10 text-destructive border-destructive/20",
  amber: "bg-warning/10 text-warning border-warning/20",
};

export function StageBadge({
  stage,
  className,
}: {
  stage: PipelineStage;
  className?: string;
}) {
  const s = STAGES_BY_KEY[stage];
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md font-medium capitalize",
        STAGE_TONE_CLASS[s.tone],
        className,
      )}
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {s.label}
    </Badge>
  );
}
