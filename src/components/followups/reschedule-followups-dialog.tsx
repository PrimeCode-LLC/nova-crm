"use client";

import * as React from "react";
import { CalendarClock, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  customDueAtFromInputs,
  defaultCustomDueInputs,
  dueAtForReschedulePreset,
  formatFollowupDueLabel,
  type ReschedulePresetId,
} from "@/lib/followup-due-display";
import { formatInstantInZone } from "@/lib/org-timezone";

const PRESETS: {
  id: Exclude<ReschedulePresetId, "custom">;
  label: string;
}[] = [
  { id: "plus1h", label: "+1 hour" },
  { id: "plus2h", label: "+2 hours" },
  { id: "tomorrow9", label: "Tomorrow 9 AM" },
  { id: "tomorrowSame", label: "Tomorrow same time" },
  { id: "nextMonday9", label: "Next Monday 9 AM" },
];

export function RescheduleFollowupsDialog({
  open,
  onOpenChange,
  count,
  skippedNonEmailCount = 0,
  timeZone,
  referenceDueAt,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Email followups that will be updated. */
  count: number;
  /** LinkedIn / other channel steps skipped from this bulk action. */
  skippedNonEmailCount?: number;
  timeZone: string;
  /** Used for "same time" and custom defaults (typically first selected). */
  referenceDueAt?: string;
  onConfirm: (dueAt: string) => void | Promise<void>;
}) {
  const [preset, setPreset] = React.useState<ReschedulePresetId>("tomorrow9");
  const [busy, setBusy] = React.useState(false);
  const defaults = React.useMemo(
    () => defaultCustomDueInputs(timeZone, referenceDueAt),
    [timeZone, referenceDueAt],
  );
  const [dueDate, setDueDate] = React.useState(defaults.dueDate);
  const [dueTime, setDueTime] = React.useState(defaults.dueTime);

  React.useEffect(() => {
    if (!open) return;
    setPreset("tomorrow9");
    const next = defaultCustomDueInputs(timeZone, referenceDueAt);
    setDueDate(next.dueDate);
    setDueTime(next.dueTime);
    setBusy(false);
  }, [open, timeZone, referenceDueAt]);

  const previewIso = React.useMemo(() => {
    if (preset === "custom") {
      if (!dueDate) return "";
      return customDueAtFromInputs(dueDate, dueTime, timeZone);
    }
    return dueAtForReschedulePreset(preset, timeZone, { referenceDueAt });
  }, [preset, dueDate, dueTime, timeZone, referenceDueAt]);

  const previewLabel = previewIso
    ? formatInstantInZone(previewIso, timeZone, { year: true })
    : "";

  async function handleConfirm() {
    if (!previewIso) return;
    setBusy(true);
    try {
      onOpenChange(false);
      await onConfirm(previewIso);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Reschedule {count === 1 ? "email followup" : `${count} email followups`}
          </DialogTitle>
          <DialogDescription>
            Only email steps will be updated
            {skippedNonEmailCount > 0
              ? ` (${skippedNonEmailCount} LinkedIn/other skipped)`
              : ""}
            . Pick a new due date and time. Linked scheduled emails will be cancelled so you can
            re-queue them after.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant={preset === p.id ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={preset === "custom" ? "default" : "outline"}
              className="h-8 text-xs"
              onClick={() => setPreset("custom")}
            >
              Custom…
            </Button>
          </div>

          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="reschedule-date" className="text-xs">
                  Date
                </Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="reschedule-time" className="text-xs">
                  Time
                </Label>
                <Input
                  id="reschedule-time"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="h-9"
                />
              </div>
            </div>
          ) : null}

          <p
            className={cn(
              "text-sm tabular-nums",
              previewLabel ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {previewLabel
              ? count === 1
                ? `New due: ${previewLabel}`
                : `${count} followups → ${previewLabel}`
              : "Choose a valid date and time."}
          </p>

          {referenceDueAt && count === 1 ? (
            <p className="text-xs text-muted-foreground">
              Currently{" "}
              {formatFollowupDueLabel(referenceDueAt, "later", timeZone).label}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !previewIso}
            onClick={() => void handleConfirm()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Reschedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
