import { Badge } from "@/components/ui/badge";
import { STAGES_BY_KEY } from "@/lib/constants";
import type { PipelineStage } from "@/lib/types";
import { cn } from "@/lib/utils";

const toneClass: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  blue: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
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
        toneClass[s.tone],
        className,
      )}
    >
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {s.label}
    </Badge>
  );
}
