"use client";

import * as React from "react";
import { useOrgTimezone } from "@/hooks/use-org-timezone";
import { formatTimezoneDisplayLabel } from "@/lib/org-timezone";
import { cn } from "@/lib/utils";

function formatOrgClock(now: Date, timeZone: string): { time: string; abbr: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).formatToParts(now);

    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
    const abbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const time = [hour && minute ? `${hour}:${minute}` : "", dayPeriod].filter(Boolean).join(" ");
    return { time, abbr };
  } catch {
    return { time: "", abbr: "" };
  }
}

export function OrgTimezoneClock({ className }: { className?: string }) {
  const timeZone = useOrgTimezone();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) {
    return (
      <span
        className={cn(
          "hidden sm:inline-flex h-8 min-w-[5.5rem] items-center justify-end px-1 tabular-nums text-xs text-muted-foreground",
          className,
        )}
        aria-hidden
      />
    );
  }

  const { time, abbr } = formatOrgClock(now, timeZone);
  if (!time) return null;

  return (
    <time
      dateTime={now.toISOString()}
      title={formatTimezoneDisplayLabel(timeZone, now)}
      className={cn(
        "hidden sm:inline-flex h-8 items-center gap-1.5 px-1 tabular-nums text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="font-medium text-foreground/80">{time}</span>
      {abbr ? <span className="text-[10px] uppercase tracking-wide">{abbr}</span> : null}
    </time>
  );
}
