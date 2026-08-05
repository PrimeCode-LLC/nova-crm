"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  BROWSER_TZ_VALUE,
  clearLegacyAccountTimezone,
  formatWorkspaceTimezoneChoice,
  readLegacyAccountTimezone,
  workspaceTimezonesDiffer,
  type WorkspaceTimezoneSide,
} from "@/lib/scheduling/workspace-timezone";

const OTHER_HREF: Record<WorkspaceTimezoneSide, string> = {
  account: "/admin/organization",
  organization: "/settings?tab=account",
};

const OTHER_LABEL: Record<WorkspaceTimezoneSide, string> = {
  account: "Organization settings",
  organization: "Settings → Account",
};

const THIS_LABEL: Record<WorkspaceTimezoneSide, string> = {
  account: "Settings → Account",
  organization: "Organization settings",
};

export function WorkspaceTimezoneField({
  id = "workspace-timezone",
  label,
  value,
  onChange,
  savedTimezone,
  side,
  disabled,
}: {
  id?: string;
  label: string;
  /** Sticky IANA zone, or "" for browser fallback. */
  value: string;
  onChange: (timezone: string) => void;
  savedTimezone: string;
  side: WorkspaceTimezoneSide;
  disabled?: boolean;
}) {
  const tzOptions = React.useMemo(() => buildTimezoneOptions(value || undefined), [value]);
  const browserTz = React.useMemo(() => getBrowserTimezone(), []);
  const [legacyTimezone, setLegacyTimezone] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLegacyTimezone(readLegacyAccountTimezone());
  }, []);

  const draftDiffers = workspaceTimezonesDiffer(value, savedTimezone);
  const legacyDiffers = Boolean(legacyTimezone) && workspaceTimezonesDiffer(legacyTimezone, savedTimezone);
  const showMismatch = draftDiffers || legacyDiffers;

  function matchSaved() {
    onChange(savedTimezone);
  }

  function dismissLegacy() {
    clearLegacyAccountTimezone();
    setLegacyTimezone(null);
  }

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

      {showMismatch ? (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-foreground">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <div className="space-y-1.5 min-w-0">
              <p className="font-medium text-warning">Timezone differs from the other settings page</p>
              <p className="text-muted-foreground">
                {THIS_LABEL[side]} is set to{" "}
                <span className="font-medium text-foreground">{formatWorkspaceTimezoneChoice(value)}</span>
                . {OTHER_LABEL[side]} currently uses{" "}
                <span className="font-medium text-foreground">
                  {formatWorkspaceTimezoneChoice(savedTimezone)}
                </span>
                . Nova only applies one workspace clock — keep these the same.
              </p>
              {legacyDiffers ? (
                <p className="text-muted-foreground">
                  This browser also still has an older Account timezone (
                  <span className="font-medium text-foreground">{legacyTimezone}</span>
                  ) that is not used anywhere. Dismiss it, or save a real IANA zone below.
                </p>
              ) : null}
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>
                  Change the dropdown here, then save, to update both {THIS_LABEL[side]} and{" "}
                  {OTHER_LABEL[side]}.
                </li>
                <li>
                  Or{" "}
                  <Link href={OTHER_HREF[side]} className="font-medium text-foreground underline underline-offset-2">
                    open {OTHER_LABEL[side]}
                  </Link>{" "}
                  if that page should stay as it is and you want to edit it there instead.
                </li>
                <li>
                  This timezone is Nova&apos;s shared workspace clock: follow-up due dates and overdue,
                  dashboard &quot;today&quot;, email send days and daily limits, working hours for auto
                  scheduling, capture reminders, and the header clock.
                </li>
              </ul>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {draftDiffers ? (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={matchSaved}>
                    Match {OTHER_LABEL[side]}
                  </Button>
                ) : null}
                {legacyDiffers ? (
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={dismissLegacy}>
                    Dismiss old browser timezone
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Same setting as{" "}
            <Link href={OTHER_HREF[side]} className="underline underline-offset-2">
              {OTHER_LABEL[side]}
            </Link>
            . Used for follow-ups, dashboards, email send days, daily limits, and working hours.
          </span>
        </p>
      )}
    </div>
  );
}
