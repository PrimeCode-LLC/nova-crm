"use client";

import * as React from "react";
import { addMinutes, differenceInMinutes, format, parseISO } from "date-fns";
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
import type { Lead, Meeting, SchedulingLink } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";

const DURATION_OPTIONS = ["15", "30", "45", "60", "90"] as const;
const NO_EVENT_TYPE = "__none__";

const dialogFooterClassName =
  "mx-0 mb-0 gap-2 rounded-none border-t bg-muted/30 px-6 py-4 sm:flex-row sm:justify-end";

function linkLabel(link: SchedulingLink): string {
  return `${link.title} · ${link.durationMin} min`;
}

function demoSlotsForDate(date: Date): { startAt: string; endAt: string }[] {
  const slots: { startAt: string; endAt: string }[] = [];
  for (const hour of [9, 11, 14, 16]) {
    const start = new Date(date);
    start.setHours(hour, 0, 0, 0);
    const end = addMinutes(start, 30);
    slots.push({ startAt: start.toISOString(), endAt: end.toISOString() });
  }
  return slots;
}

function parseTimeOnDate(date: Date, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function buildMeetingWindow(
  date: Date,
  startTime: string,
  endTime: string,
): { startAt: string; endAt: string } | null {
  const start = parseTimeOnDate(date, startTime);
  let end = parseTimeOnDate(date, endTime);
  if (!start || !end) return null;
  if (end <= start) end = addMinutes(end, 24 * 60);
  if (differenceInMinutes(end, start) < 5) return null;
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

function defaultEndTime(startTime: string, durationMin: number): string {
  const base = parseTimeOnDate(new Date(2000, 0, 1), startTime);
  if (!base) return "10:00";
  return format(addMinutes(base, durationMin), "HH:mm");
}

export function ScheduleMeetingDialog({
  open,
  onOpenChange,
  hostId,
  hostLabel,
  calendarEmail,
  links,
  isDemo,
  initialDate,
  initialStartTime,
  defaultAttendeeName,
  defaultAttendeeEmail,
  lead,
  hostOptions,
  onHostChange,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostId: string;
  hostLabel: string;
  /** Connected Google Calendar account email for the selected host, when known. */
  calendarEmail?: string;
  links: SchedulingLink[];
  isDemo?: boolean;
  initialDate?: Date;
  initialStartTime?: string;
  defaultAttendeeName?: string;
  defaultAttendeeEmail?: string;
  lead?: Lead;
  hostOptions?: { id: string; label: string }[];
  onHostChange?: (hostId: string) => void;
  onBooked?: (meeting: Meeting) => void;
}) {
  const [eventTitle, setEventTitle] = React.useState("");
  const [dateYmd, setDateYmd] = React.useState("");
  const [selectedLinkId, setSelectedLinkId] = React.useState("");
  const [attendeeName, setAttendeeName] = React.useState("");
  const [attendeeEmail, setAttendeeEmail] = React.useState("");
  const [startTime, setStartTime] = React.useState("09:00");
  const [endTime, setEndTime] = React.useState("09:30");
  const [description, setDescription] = React.useState("");
  const [slots, setSlots] = React.useState<{ startAt: string; endAt: string }[]>([]);
  const [booking, setBooking] = React.useState(false);

  const hostLinks = React.useMemo(
    () => links.filter((l) => l.hostId === hostId && l.active),
    [links, hostId],
  );

  const selectedLink = selectedLinkId
    ? hostLinks.find((l) => l.id === selectedLinkId) ?? null
    : null;

  const selectedDate = React.useMemo(
    () => (dateYmd ? new Date(`${dateYmd}T12:00:00`) : undefined),
    [dateYmd],
  );

  // Seed once per open — workspace refresh must not wipe attendee / time fields.
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    const base = initialDate ?? new Date();
    const start = initialStartTime ?? "09:00";
    setEventTitle("");
    setDateYmd(format(base, "yyyy-MM-dd"));
    setAttendeeName(lead?.contactName ?? defaultAttendeeName ?? "");
    setAttendeeEmail(lead?.contactEmail ?? defaultAttendeeEmail ?? "");
    setSelectedLinkId("");
    setStartTime(start);
    setEndTime(defaultEndTime(start, 30));
    setDescription("");
  }, [open, initialDate, initialStartTime, lead, defaultAttendeeName, defaultAttendeeEmail]);

  React.useEffect(() => {
    if (!open || !selectedDate || isDemo || !selectedLink) {
      setSlots([]);
      return;
    }
    const ymd = format(selectedDate, "yyyy-MM-dd");
    void fetch(
      `/api/scheduling/availability?hostId=${encodeURIComponent(hostId)}&date=${ymd}&durationMin=${selectedLink.durationMin}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setSlots(j.slots ?? []);
        else setSlots([]);
      })
      .catch(() => setSlots([]));
  }, [open, selectedDate, hostId, isDemo, selectedLink]);

  const visibleSlots = isDemo && selectedDate ? demoSlotsForDate(selectedDate) : slots;

  const meetingWindow = React.useMemo(() => {
    if (!selectedDate) return null;
    return buildMeetingWindow(selectedDate, startTime, endTime);
  }, [selectedDate, startTime, endTime]);

  const durationLabel = React.useMemo(() => {
    if (!meetingWindow) return null;
    const mins = differenceInMinutes(parseISO(meetingWindow.endAt), parseISO(meetingWindow.startAt));
    return `${mins} min`;
  }, [meetingWindow]);

  const durationPreset =
    meetingWindow &&
    DURATION_OPTIONS.find(
      (d) =>
        differenceInMinutes(parseISO(meetingWindow.endAt), parseISO(meetingWindow.startAt)) ===
        Number(d),
    );

  function handleEventTypeChange(value: string | null) {
    if (!value || value === NO_EVENT_TYPE) {
      setSelectedLinkId("");
      return;
    }
    setSelectedLinkId(value);
    const link = hostLinks.find((l) => l.id === value);
    if (link?.durationMin) {
      setEndTime(defaultEndTime(startTime, link.durationMin));
    }
  }

  function applySuggestedSlot(slot: { startAt: string; endAt: string }) {
    setStartTime(format(parseISO(slot.startAt), "HH:mm"));
    setEndTime(format(parseISO(slot.endAt), "HH:mm"));
  }

  function applyDuration(minutes: string) {
    setEndTime(defaultEndTime(startTime, Number(minutes) || 30));
  }

  async function confirmBook() {
    if (!meetingWindow || !attendeeName.trim() || !attendeeEmail.trim()) {
      toast.error("Fill in guest details, date, and time");
      return;
    }
    const title = eventTitle.trim() || selectedLink?.title || "Meeting";
    if (isDemo) {
      toast.success("Event saved (demo)", {
        description: `${title} on ${fmtDate(meetingWindow.startAt, "MMM d, h:mm a")}`,
      });
      onOpenChange(false);
      return;
    }
    setBooking(true);
    try {
      const res = await fetch("/api/scheduling/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostId,
          schedulingLinkId: selectedLink?.id,
          title,
          startAt: meetingWindow.startAt,
          endAt: meetingWindow.endAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          attendeeName: attendeeName.trim(),
          attendeeEmail: attendeeEmail.trim(),
          attendeeNotes: description.trim() || undefined,
          leadId: lead?.id,
          leadOwnerId: lead?.ownerId,
        }),
      });
      const j = await res.json();
      if (!j.ok) {
        toast.error(j.error ?? "Could not save event");
        return;
      }
      onBooked?.(j.item as Meeting);
      toast.success("Event saved");
      onOpenChange(false);
    } finally {
      setBooking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="gap-3 border-b px-6 py-5 pr-12">
          <DialogTitle className="sr-only">
            {lead ? `Book meeting for ${lead.companyName}` : "Create event"}
          </DialogTitle>
          <Input
            value={eventTitle}
            onChange={(e) => setEventTitle(e.target.value)}
            placeholder="Add title"
            className="h-11 min-h-11 border-0 bg-transparent px-0 py-2 text-xl font-semibold leading-normal shadow-none focus-visible:border-0 focus-visible:ring-0"
          />
          {hostOptions && hostOptions.length > 1 && onHostChange ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Calendar</span>
                <Select
                  value={hostId}
                  onValueChange={(v) => {
                    if (v) onHostChange(v);
                  }}
                >
                  <SelectTrigger className="h-8 w-full max-w-xs">
                    <SelectValue placeholder="Select calendar">
                      {hostOptions.find((o) => o.id === hostId)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {hostOptions.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {calendarEmail ? (
                <p className="text-xs text-muted-foreground">{calendarEmail}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Calendar · <span className="font-medium text-foreground">{hostLabel}</span>
              {calendarEmail ? (
                <>
                  {" "}
                  · <span className="font-medium text-foreground">{calendarEmail}</span>
                </>
              ) : null}
            </p>
          )}
        </DialogHeader>

        <div className="max-h-[min(70vh,560px)] space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-3">
            <div>
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                type="date"
                value={dateYmd}
                onChange={(e) => setDateYmd(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="event-start">Start</Label>
                <Input
                  id="event-start"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="event-end">End</Label>
                <Input
                  id="event-end"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Duration</Label>
                <Select
                  value={durationPreset ?? "custom"}
                  onValueChange={(v) => {
                    if (v && v !== "custom") applyDuration(v);
                  }}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue>{durationLabel ?? "Custom"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d} min
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {meetingWindow && (
              <p className="text-sm text-muted-foreground">
                {format(parseISO(meetingWindow.startAt), "EEEE, MMM d · h:mm a")} –{" "}
                {format(parseISO(meetingWindow.endAt), "h:mm a")}
                {durationLabel ? ` (${durationLabel})` : ""}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>
                Event type{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Select
                value={selectedLinkId || NO_EVENT_TYPE}
                onValueChange={handleEventTypeChange}
              >
                <SelectTrigger className="mt-1.5 w-full sm:max-w-sm">
                  <SelectValue placeholder="None">
                    {selectedLink ? linkLabel(selectedLink) : "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_EVENT_TYPE}>None</SelectItem>
                  {hostLinks.map((link) => (
                    <SelectItem key={link.id} value={link.id}>
                      {linkLabel(link)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hostLinks.length === 0 && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  No event types yet. You can still save this event, or create one under Event types.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="schedule-attendee-name">Guest name</Label>
              <Input
                id="schedule-attendee-name"
                value={attendeeName}
                onChange={(e) => setAttendeeName(e.target.value)}
                placeholder={lead ? lead.contactName : "Jane Doe"}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="schedule-attendee-email">Guest email</Label>
              <Input
                id="schedule-attendee-email"
                type="email"
                value={attendeeEmail}
                onChange={(e) => setAttendeeEmail(e.target.value)}
                placeholder="jane@company.com"
                className="mt-1.5"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="event-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description"
              rows={3}
              className="mt-1.5 resize-none"
            />
          </div>

          {selectedLink && selectedDate && visibleSlots.length > 0 && (
            <div>
              <Label>Suggested times</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Based on your availability for this event type.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {visibleSlots.map((slot) => {
                  const slotStart = format(parseISO(slot.startAt), "HH:mm");
                  const isActive = startTime === slotStart;
                  return (
                    <button
                      key={slot.startAt}
                      type="button"
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm transition-colors",
                        isActive && "border-primary bg-primary text-primary-foreground",
                      )}
                      onClick={() => applySuggestedSlot(slot)}
                    >
                      {format(parseISO(slot.startAt), "h:mm a")}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className={dialogFooterClassName}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !meetingWindow || booking || !attendeeName.trim() || !attendeeEmail.trim()
            }
            onClick={() => void confirmBook()}
          >
            {booking ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
