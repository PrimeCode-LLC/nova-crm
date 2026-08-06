import { Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  size = "md",
  showWordmark = true,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
}) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const iconDim = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-6 w-6" : "h-4.5 w-4.5";
  const text = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base";

  return (
    <Link
      href="/"
      className={cn(
        "group inline-flex items-center gap-2.5 outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 rounded-lg",
        className,
      )}
      aria-label={`${SITE.name} home`}
    >
      <span
        className={cn(
          "relative flex items-center justify-center rounded-xl bg-primary text-primary-foreground",
          "shadow-lg shadow-primary/30 transition-transform group-hover:scale-[1.03]",
          dim,
        )}
      >
        <Zap className={iconDim} />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 ring-2 ring-background">
          <Sparkles className="h-2.5 w-2.5 text-white" />
        </span>
      </span>
      {showWordmark && (
        <span className={cn("font-semibold tracking-tight", text)}>
          {SITE.name}
        </span>
      )}
    </Link>
  );
}
