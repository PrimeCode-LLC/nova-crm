"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildTimezoneOptions,
  formatTimezoneDisplayLabel,
  getBrowserTimezone,
} from "@/lib/scheduling/timezone-options";
import { BROWSER_TZ_VALUE } from "@/lib/scheduling/workspace-timezone";

export function WorkspaceTimezoneField({
  id = "workspace-timezone",
  label,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  label: string;
  /** Sticky IANA zone, or "" for browser fallback. */
  value: string;
  onChange: (timezone: string) => void;
  disabled?: boolean;
}) {
  const tzOptions = React.useMemo(() => buildTimezoneOptions(value || undefined), [value]);
  const browserTz = React.useMemo(() => getBrowserTimezone(), []);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Select
        value={value.trim() ? value : BROWSER_TZ_VALUE}
        onValueChange={(next) => {
          if (!next) return;
          onChange(next === BROWSER_TZ_VALUE ? "" : next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue placeholder="Use browser timezone" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BROWSER_TZ_VALUE}>
            Use my browser timezone ({formatTimezoneDisplayLabel(browserTz)})
          </SelectItem>
          {tzOptions.map((tz) => (
            <SelectItem key={tz} value={tz}>
              {formatTimezoneDisplayLabel(tz)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Shared workspace clock for the header, follow-up due dates, dashboards, email send days,
          daily limits, and working hours. Prefer a sticky zone like America/New_York for the whole
          team.
        </span>
      </p>
    </div>
  );
}
