"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Followup, LeadPriority } from "@/lib/types";

const dialogFooterClassName =
  "mx-0 mb-0 gap-2 rounded-none border-t bg-muted/30 px-6 py-4 sm:flex-row sm:justify-end";

function newEntityId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function buildDueAt(date: Date, startTime: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(startTime.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const due = new Date(date);
  due.setHours(hours, minutes, 0, 0);
  return due.toISOString();
}

export function CalendarTaskDialog({
  open,
  onOpenChange,
  currentUserId,
  initialDate,
  initialStartTime,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  initialDate?: Date;
  initialStartTime?: string;
  onCreate: (task: Followup) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [dateYmd, setDateYmd] = React.useState("");
  const [startTime, setStartTime] = React.useState("09:00");
  const [priority, setPriority] = React.useState<LeadPriority>("medium");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const base = initialDate ?? new Date();
    setTitle("");
    setDescription("");
    setDateYmd(format(base, "yyyy-MM-dd"));
    setStartTime(initialStartTime ?? "09:00");
    setPriority("medium");
  }, [open, initialDate, initialStartTime]);

  function handleSave() {
    const t = title.trim();
    if (!t) {
      toast.error("Add a title for this task");
      return;
    }
    if (!dateYmd) {
      toast.error("Pick a date");
      return;
    }
    const dueAt = buildDueAt(new Date(`${dateYmd}T12:00:00`), startTime);
    if (!dueAt) {
      toast.error("Pick a valid time");
      return;
    }
    const task: Followup = {
      id: newEntityId("f"),
      title: t,
      description: description.trim() || undefined,
      dueAt,
      ownerId: currentUserId,
      priority,
      auto: false,
    };
    setSaving(true);
    try {
      onCreate(task);
      toast.success("Task added to calendar");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const duePreview = React.useMemo(() => {
    if (!dateYmd) return null;
    const dueAt = buildDueAt(new Date(`${dateYmd}T12:00:00`), startTime);
    if (!dueAt) return null;
    return format(parseISO(dueAt), "EEEE, MMM d · h:mm a");
  }, [dateYmd, startTime]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-3 border-b px-6 py-5 pr-12">
          <DialogTitle className="sr-only">Create task</DialogTitle>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add title"
            className="h-11 min-h-11 border-0 bg-transparent px-0 py-2 text-xl font-semibold leading-normal shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          <p className="text-sm text-muted-foreground">Task · shows on your calendar</p>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div>
            <Label htmlFor="task-date">Date</Label>
            <Input
              id="task-date"
              type="date"
              value={dateYmd}
              onChange={(e) => setDateYmd(e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="task-time">Time</Label>
              <Input
                id="task-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => {
                  if (v) setPriority(v as LeadPriority);
                }}
              >
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue>{priority}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["low", "medium", "high"] as const).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {duePreview && (
            <p className="text-sm text-muted-foreground">{duePreview}</p>
          )}

          <div>
            <Label htmlFor="task-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description"
              rows={3}
              className="mt-1.5 resize-none"
            />
          </div>
        </div>

        <DialogFooter className={dialogFooterClassName}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !title.trim()} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
