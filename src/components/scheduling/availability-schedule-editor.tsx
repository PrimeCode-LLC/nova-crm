"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AvailabilitySchedule, WeekdayKey } from "@/lib/types";
import { WEEKDAY_KEYS } from "@/lib/scheduling/defaults";
import { buildTimezoneOptions, formatTimezoneLabel } from "@/lib/scheduling/timezone-options";

type DayDraft = {
  enabled: boolean;
  start: string;
  end: string;
};

function scheduleToDraft(schedule: AvailabilitySchedule): Record<WeekdayKey, DayDraft> {
  const draft = {} as Record<WeekdayKey, DayDraft>;
  for (const day of WEEKDAY_KEYS) {
    const slots = schedule.weekly[day] ?? [];
    const first = slots[0];
    draft[day] = {
      enabled: slots.length > 0,
      start: first?.start ?? "09:00",
      end: first?.end ?? "17:00",
    };
  }
  return draft;
}

function draftToWeekly(draft: Record<WeekdayKey, DayDraft>): AvailabilitySchedule["weekly"] {
  const weekly = {} as AvailabilitySchedule["weekly"];
  for (const day of WEEKDAY_KEYS) {
    const row = draft[day];
    weekly[day] = row.enabled ? [{ start: row.start, end: row.end }] : [];
  }
  return weekly;
}

function isValidTimeRange(start: string, end: string): boolean {
  if (!start || !end) return false;
  return start < end;
}

export function AvailabilityScheduleEditor({
  schedule,
  isDemo,
  onSaved,
}: {
  schedule: AvailabilitySchedule;
  isDemo: boolean;
  onSaved: (schedule: AvailabilitySchedule) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [timezone, setTimezone] = React.useState(schedule.timezone);
  const [minNoticeHours, setMinNoticeHours] = React.useState(String(schedule.minNoticeHours));
  const [maxDaysAhead, setMaxDaysAhead] = React.useState(String(schedule.maxDaysAhead));
  const [days, setDays] = React.useState(() => scheduleToDraft(schedule));

  const timezoneOptions = React.useMemo(
    () => buildTimezoneOptions(schedule.timezone),
    [schedule.timezone],
  );

  React.useEffect(() => {
    if (!open) return;
    setTimezone(schedule.timezone);
    setMinNoticeHours(String(schedule.minNoticeHours));
    setMaxDaysAhead(String(schedule.maxDaysAhead));
    setDays(scheduleToDraft(schedule));
  }, [open, schedule]);

  function updateDay(day: WeekdayKey, patch: Partial<DayDraft>) {
    setDays((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  async function handleSave() {
    const notice = Number(minNoticeHours);
    const ahead = Number(maxDaysAhead);
    if (!Number.isFinite(notice) || notice < 0 || notice > 168) {
      toast.error("Minimum notice must be between 0 and 168 hours");
      return;
    }
    if (!Number.isFinite(ahead) || ahead < 1 || ahead > 365) {
      toast.error("Booking window must be between 1 and 365 days");
      return;
    }
    for (const day of WEEKDAY_KEYS) {
      const row = days[day];
      if (row.enabled && !isValidTimeRange(row.start, row.end)) {
        toast.error(`Invalid hours for ${day}: end time must be after start time`);
        return;
      }
    }

    const weekly = draftToWeekly(days);
    setSaving(true);
    try {
      if (isDemo) {
        onSaved({
          ...schedule,
          timezone,
          minNoticeHours: notice,
          maxDaysAhead: ahead,
          weekly,
          updatedAt: new Date().toISOString(),
        });
        setOpen(false);
        toast.success("Schedule updated (demo)");
        return;
      }

      const res = await fetch("/api/scheduling/availability", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleId: schedule.id,
          timezone,
          minNoticeHours: notice,
          maxDaysAhead: ahead,
          weekly,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error ?? "Could not save schedule");
        return;
      }
      onSaved(j.schedule as AvailabilitySchedule);
      setOpen(false);
      toast.success("Schedule updated");
    } catch {
      toast.error("Could not save schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Edit schedule
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit working hours</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="schedule-timezone">Time zone</Label>
              <Select
                value={timezone}
                onValueChange={(value) => {
                  if (value) setTimezone(value);
                }}
              >
                <SelectTrigger id="schedule-timezone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {timezoneOptions.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {formatTimezoneLabel(tz)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="min-notice">Minimum notice (hours)</Label>
                <Input
                  id="min-notice"
                  type="number"
                  min={0}
                  max={168}
                  value={minNoticeHours}
                  onChange={(e) => setMinNoticeHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-ahead">Book up to (days ahead)</Label>
                <Input
                  id="max-ahead"
                  type="number"
                  min={1}
                  max={365}
                  value={maxDaysAhead}
                  onChange={(e) => setMaxDaysAhead(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Weekly hours</Label>
              {WEEKDAY_KEYS.map((day) => {
                const row = days[day];
                return (
                  <div
                    key={day}
                    className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <span className="w-24 capitalize text-sm text-muted-foreground">{day}</span>
                    <Switch
                      checked={row.enabled}
                      onCheckedChange={(enabled) => updateDay(day, { enabled })}
                      aria-label={`${day} available`}
                    />
                    {row.enabled ? (
                      <div className="flex flex-1 items-center gap-2">
                        <Input
                          type="time"
                          value={row.start}
                          onChange={(e) => updateDay(day, { start: e.target.value })}
                          className="w-[7.5rem]"
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={row.end}
                          onChange={(e) => updateDay(day, { end: e.target.value })}
                          className="w-[7.5rem]"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Unavailable</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
