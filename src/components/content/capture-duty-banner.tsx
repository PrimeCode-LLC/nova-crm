"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Camera, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  brandsNeedingCaptureAttention,
  captureDutyBannerCopy,
} from "@/lib/content-calendar/capture-policy";
import { useContentCalendarData } from "@/lib/hooks/use-content-calendar-data";
import { can } from "@/lib/permissions/can";
import { useNavAccessContext } from "@/lib/hooks/use-nav-access-context";
import { cn } from "@/lib/utils";

/**
 * Prompts the assigned capturer when weekly/idle capture duty is behind.
 * Hidden on wall mode and when the viewer cannot open the content calendar.
 */
export function CaptureDutyBanner({
  className,
  compact = false,
}: {
  className?: string;
  /** Tighter padding for embedding under page headers. */
  compact?: boolean;
}) {
  const pathname = usePathname();
  const permissionSubject = useNavAccessContext();
  const { brands, captures, currentUserId, loading } = useContentCalendarData();
  const [nowMs] = React.useState(() => Date.now());
  const [dismissedKey, setDismissedKey] = React.useState<string | null>(null);

  const isWallMode =
    pathname === "/dashboard/wall" || pathname.startsWith("/dashboard/wall/");
  const canViewContent = can(permissionSubject, "content_calendar", "view");

  const attention = React.useMemo(
    () =>
      brandsNeedingCaptureAttention({
        brands,
        captures,
        currentUserId,
        nowMs,
      }),
    [brands, captures, currentUserId, nowMs],
  );

  const copy = React.useMemo(() => captureDutyBannerCopy(attention), [attention]);
  const attentionKey = attention.map((a) => a.brand.id).sort().join("|");

  if (isWallMode || !canViewContent || loading || !copy || dismissedKey === attentionKey) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-md border border-amber-500/35 bg-amber-500/8 text-sm",
        compact ? "px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Camera
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-foreground leading-snug">{copy.headline}</p>
          {!compact ? (
            <p className="text-xs text-muted-foreground leading-relaxed">{copy.detail}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {copy.detail}{" "}
              <Link
                href="/content/capture"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Capture now
              </Link>
            </p>
          )}
          {!compact ? (
            <div className="pt-1.5">
              <Link
                href="/content/capture"
                className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
              >
                <Camera className="h-3.5 w-3.5" aria-hidden />
                Capture now
              </Link>
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss capture reminder"
          onClick={() => setDismissedKey(attentionKey)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
