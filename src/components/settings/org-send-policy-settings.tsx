"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_ORG_SEND_POLICY, resolveOrgSendPolicy } from "@/lib/email/org-send-policy";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import type { AvailabilityTimeSlot, OrgEmailSendPolicy, WeekdayKey } from "@/lib/types";

const DAY_LABEL: Record<WeekdayKey, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export function OrgSendPolicyFields({
  value,
  onChange,
  disabled,
}: {
  value: OrgEmailSendPolicy;
  onChange: (next: OrgEmailSendPolicy) => void;
  disabled?: boolean;
}) {
  const policy = resolveOrgSendPolicy(value);
  const ceilingInput =
    policy.dailyCeiling != null ? String(policy.dailyCeiling) : "";

  function setDayEnabled(day: WeekdayKey, enabled: boolean) {
    onChange({
      ...policy,
      weekly: {
        ...policy.weekly,
        [day]: enabled ? [{ start: "09:00", end: "17:00" }] : [],
      },
    });
  }

  function setDaySlot(day: WeekdayKey, patch: Partial<AvailabilityTimeSlot>) {
    const current = policy.weekly[day]?.[0] ?? { start: "09:00", end: "17:00" };
    onChange({
      ...policy,
      weekly: {
        ...policy.weekly,
        [day]: [{ ...current, ...patch }],
      },
    });
  }

  function setCeiling(raw: string) {
    const trimmed = raw.trim();
    const dailyCeiling =
      trimmed === ""
        ? null
        : Number.isFinite(Number(trimmed)) && Number(trimmed) > 0
          ? Math.floor(Number(trimmed))
          : null;
    onChange({ ...policy, dailyCeiling, weekdayOnly: true });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs">Email working hours</Label>
        <p className="text-xs text-muted-foreground">
          Auto and bulk sequence scheduling stay inside these hours and skip closed days,
          using the workspace timezone above.
        </p>
        <div className="space-y-2 rounded-md border p-3">
          {WEEKDAY_KEYS.map((day) => {
            const slot = policy.weekly[day]?.[0];
            const enabled = Boolean(slot);
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <Switch
                  checked={enabled}
                  onCheckedChange={(v) => setDayEnabled(day, v)}
                  id={`send-day-${day}`}
                  disabled={disabled}
                />
                <Label htmlFor={`send-day-${day}`} className="w-10 text-xs">
                  {DAY_LABEL[day]}
                </Label>
                <Input
                  type="time"
                  className="h-8 w-[7.5rem]"
                  disabled={disabled || !enabled}
                  value={slot?.start ?? "09:00"}
                  onChange={(e) => setDaySlot(day, { start: e.target.value })}
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="h-8 w-[7.5rem]"
                  disabled={disabled || !enabled}
                  value={slot?.end ?? "17:00"}
                  onChange={(e) => setDaySlot(day, { end: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="org-daily-ceiling">
          Organization daily send ceiling (optional)
        </Label>
        <Input
          id="org-daily-ceiling"
          type="number"
          min={1}
          placeholder="No org-wide cap"
          value={ceilingInput}
          disabled={disabled}
          onChange={(e) => setCeiling(e.target.value)}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Caps sent + queued emails per org day across every inbox. Leave blank to use mailbox
          limits only.
        </p>
      </div>
    </div>
  );
}

export function emptySendPolicyDraft(): OrgEmailSendPolicy {
  return resolveOrgSendPolicy(DEFAULT_ORG_SEND_POLICY);
}
