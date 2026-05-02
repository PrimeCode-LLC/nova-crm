import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/** Same mark as `src/app/icon.svg`: Lucide Zap on primary rounded square. */
export function AppMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground",
        className,
      )}
    >
      <Zap className="size-4" />
    </div>
  );
}
