"use client";

import * as React from "react";
import Link from "next/link";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
  subDays,
} from "date-fns";
import { CalendarPlus, ChevronLeft, ChevronRight, ListTodo, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScheduleMeetingDialog } from "@/components/scheduling/schedule-meeting-dialog";
import { CalendarCreateMenu } from "@/components/scheduling/calendar-create-menu";
import { CalendarTaskDialog } from "@/components/scheduling/calendar-task-dialog";
import { useAuth } from "@/components/providers/auth-provider";
import { useWorkspace } from "@/components/providers/workspace-mode-provider";
import type { ExternalCalendarEvent, Meeting, SchedulingLink } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { syncGoogleCalendarClient } from "@/lib/scheduling/sync-google-calendar-client";
import { toast } from "sonner";

type CalendarViewMode = "day" | "week" | "month" | "schedule";

const VIEW_LABELS: Record<CalendarViewMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  schedule: "Agenda",
};

const HOUR_START = 6;
const HOUR_END = 22;
const DAY_VIEW_HOUR_START = 0;
const DAY_VIEW_HOUR_END = 24;
const HOUR_HEIGHT = 48;

function meetingColor(m: Meeting): string {
  if (m.status === "cancelled") return "bg-muted text-muted-foreground border-muted";
  if (m.status === "completed") return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/30";
  if (m.status === "no_show") return "bg-amber-500/20 text-amber-900 dark:text-amber-200 border-amber-500/30";
  return "bg-primary/15 text-primary border-primary/25";
}

function meetingsForDay(meetings: Meeting[], day: Date): Meeting[] {
  return meetings
    .filter((m) => m.status !== "cancelled" && isSameDay(parseISO(m.startAt), day))
    .sort((a, b) => parseISO(a.startAt).getTime() - parseISO(b.startAt).getTime());
}

function externalForDay(events: ExternalCalendarEvent[], day: Date): ExternalCalendarEvent[] {
  return events
    .filter((e) => isSameDay(parseISO(e.startAt), day))
    .sort((a, b) => parseISO(a.startAt).getTime() - parseISO(b.startAt).getTime());
}

function externalEventColor(): string {
  return "bg-violet-500/20 text-violet-900 dark:text-violet-200 border-violet-500/30";
}

type CalendarTaskEntry = {
  id: string;
  title: string;
  dueAt: string;
  kind: "followup" | "lead_task";
};

function taskEventColor(): string {
  return "bg-amber-500/20 text-amber-950 dark:text-amber-100 border-amber-500/30";
}

function tasksForDay(tasks: CalendarTaskEntry[], day: Date): CalendarTaskEntry[] {
  return tasks
    .filter((t) => isSameDay(parseISO(t.dueAt), day))
    .sort((a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime());
}

function renderTimeGridColumn(input: {
  day: Date;
  hourStart: number;
  hourEnd: number;
  dayMeetings: Meeting[];
  dayExternal: ExternalCalendarEvent[];
  dayTasks: CalendarTaskEntry[];
  onSlotClick: (day: Date, hour: number) => void;
  onMeetingClick: (meeting: Meeting) => void;
  onExternalClick: (event: ExternalCalendarEvent) => void;
}) {
  const {
    day,
    hourStart,
    hourEnd,
    dayMeetings,
    dayExternal,
    dayTasks,
    onSlotClick,
    onMeetingClick,
    onExternalClick,
  } = input;
  const hourCount = hourEnd - hourStart;
  const gridHeight = hourCount * HOUR_HEIGHT;

  return (
    <div
      key={day.toISOString()}
      className={cn("relative border-l", isToday(day) && "bg-primary/[0.03]")}
      style={{ height: gridHeight }}
    >
      {Array.from({ length: hourCount }, (_, i) => {
        const hour = hourStart + i;
        return (
          <button
            key={i}
            type="button"
            aria-label={`Create event on ${format(day, "MMM d")} at ${format(new Date(2000, 0, 1, hour), "h a")}`}
            className="absolute z-0 w-full border-b border-dashed border-border/50 hover:bg-primary/5"
            style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
            onClick={() => onSlotClick(day, hour)}
          />
        );
      })}
      {isToday(day) && new Date().getHours() >= hourStart && new Date().getHours() < hourEnd && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-red-500"
          style={{
            top:
              ((new Date().getHours() - hourStart) * 60 + new Date().getMinutes()) *
              (HOUR_HEIGHT / 60),
          }}
        />
      )}
      {dayExternal
        .filter((e) => !e.allDay)
        .map((e) => {
          const start = parseISO(e.startAt);
          const end = parseISO(e.endAt);
          const topMin = start.getHours() * 60 + start.getMinutes() - hourStart * 60;
          const durationMin = (end.getTime() - start.getTime()) / 60_000;
          const top = (topMin / 60) * HOUR_HEIGHT;
          const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 22);
          if (topMin < 0 || topMin >= hourCount * 60) return null;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onExternalClick(e)}
              className={cn(
                "absolute left-0.5 right-0.5 z-20 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight",
                externalEventColor(),
              )}
              style={{ top, height }}
            >
              <span className="font-semibold">{e.title}</span>
              <br />
              {format(start, "h:mm a")}
            </button>
          );
        })}
      {dayMeetings.map((m) => {
        const start = parseISO(m.startAt);
        const end = parseISO(m.endAt);
        const topMin = start.getHours() * 60 + start.getMinutes() - hourStart * 60;
        const durationMin = (end.getTime() - start.getTime()) / 60_000;
        const top = (topMin / 60) * HOUR_HEIGHT;
        const height = Math.max((durationMin / 60) * HOUR_HEIGHT, 22);
        if (topMin < 0 || topMin >= hourCount * 60) return null;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onMeetingClick(m)}
            className={cn(
              "absolute left-0.5 right-0.5 z-20 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight",
              meetingColor(m),
            )}
            style={{ top, height }}
          >
            <span className="font-semibold">{m.title}</span>
            <br />
            {format(start, "h:mm a")}
          </button>
        );
      })}
      {dayTasks.map((t) => {
        const start = parseISO(t.dueAt);
        const topMin = start.getHours() * 60 + start.getMinutes() - hourStart * 60;
        const top = (topMin / 60) * HOUR_HEIGHT;
        if (topMin < 0 || topMin >= hourCount * 60) return null;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute left-0.5 right-0.5 z-20 overflow-hidden rounded border px-1 py-0.5 text-left text-[10px] leading-tight",
              taskEventColor(),
            )}
            style={{ top, height: 22 }}
          >
            <span className="font-semibold">{t.title}</span>
            <br />
            {format(start, "h:mm a")}
          </div>
        );
      })}
    </div>
  );
}

export function SchedulingCalendarView({
  meetings,
  hostLabel,
  hostId,
  links = [],
  externalConnected,
  isDemo,
  loading,
  onMeetingBooked,
  onCreateAppointmentSchedule,
}: {
  meetings: Meeting[];
  hostLabel: string;
  hostId?: string;
  links?: SchedulingLink[];
  externalConnected?: boolean;
  isDemo?: boolean;
  loading?: boolean;
  onMeetingBooked?: (meeting: Meeting) => void;
  onCreateAppointmentSchedule?: () => void;
}) {
  const { user: fbUser } = useAuth();
  const { followups, leadTasks, currentUserId, addFollowup } = useWorkspace();
  const [view, setView] = React.useState<CalendarViewMode>("month");
  const [cursor, setCursor] = React.useState(() => new Date());
  const [selectedDay, setSelectedDay] = React.useState<Date | null>(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [scheduleDate, setScheduleDate] = React.useState<Date | undefined>();
  const [scheduleStartTime, setScheduleStartTime] = React.useState<string | undefined>();
  const [selectedMeeting, setSelectedMeeting] = React.useState<Meeting | null>(null);
  const [showNova, setShowNova] = React.useState(true);
  const [showTasks, setShowTasks] = React.useState(true);
  const [showExternal, setShowExternal] = React.useState(true);
  const [externalEvents, setExternalEvents] = React.useState<ExternalCalendarEvent[]>([]);
  const [externalLoading, setExternalLoading] = React.useState(false);
  const [externalError, setExternalError] = React.useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = React.useState(false);
  const [selectedExternal, setSelectedExternal] = React.useState<ExternalCalendarEvent | null>(
    null,
  );
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const [syncingExternal, setSyncingExternal] = React.useState(false);

  const visibleMeetings = React.useMemo(() => {
    if (!showNova) return [];
    return meetings.filter((m) => m.status !== "cancelled");
  }, [meetings, showNova]);

  const visibleExternal = React.useMemo(() => {
    if (!showExternal || !externalConnected) return [];
    return externalEvents;
  }, [externalEvents, showExternal, externalConnected]);

  const calendarTasks = React.useMemo((): CalendarTaskEntry[] => {
    if (!showTasks) return [];
    const openFollowups = followups
      .filter((f) => !f.completedAt && f.ownerId === currentUserId)
      .map((f) => ({
        id: f.id,
        title: f.title,
        dueAt: f.dueAt,
        kind: "followup" as const,
      }));
    const openLeadTasks = leadTasks
      .filter((t) => !t.completedAt && t.assigneeId === currentUserId && t.dueAt)
      .map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt!,
        kind: "lead_task" as const,
      }));
    return [...openFollowups, ...openLeadTasks];
  }, [showTasks, followups, leadTasks, currentUserId]);

  const defaultGuestEmail =
    fbUser?.email?.trim() ||
    `${hostLabel.split(" ")[0]?.toLowerCase() ?? "guest"}@example.com`;
  const defaultGuestName =
    fbUser?.displayName?.trim() || hostLabel.replace(/\s*\(.*\)$/, "").trim() || "Guest";

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const monthDays = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weekStart = startOfWeek(cursor, { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const focusDay = selectedDay ?? cursor;

  const fetchRange = React.useMemo(() => {
    if (view === "day") {
      const from = new Date(focusDay);
      from.setHours(0, 0, 0, 0);
      const to = addDays(from, 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (view === "week") {
      const from = weekStart.toISOString();
      const to = addDays(weekDays[6]!, 1).toISOString();
      return { from, to };
    }
    return { from: gridStart.toISOString(), to: addDays(gridEnd, 1).toISOString() };
  }, [view, focusDay, weekStart, weekDays, gridStart, gridEnd]);

  React.useEffect(() => {
    if (!externalConnected || !showExternal || isDemo || !hostId) {
      setExternalEvents([]);
      setExternalError(null);
      setNeedsReconnect(false);
      return;
    }

    let cancelled = false;
    setExternalLoading(true);
    setExternalError(null);

    const params = new URLSearchParams({
      hostId,
      from: fetchRange.from,
      to: fetchRange.to,
    });

    fetch(`/api/scheduling/calendar-events?${params.toString()}`)
      .then(async (res) => {
        const j = await res.json();
        if (cancelled) return;
        if (!j.ok) {
          setExternalEvents([]);
          setExternalError(j.error ?? "Could not load Google Calendar events");
          return;
        }
        setExternalEvents(j.items ?? []);
        setNeedsReconnect(Boolean(j.needsReconnect));
        if (j.needsReconnect && (j.items ?? []).length === 0) {
          setExternalError(
            "Google access expired. Use Sync now to refresh, or reconnect in Availability.",
          );
        } else if ((j.items ?? []).length === 0 && !j.needsReconnect) {
          setExternalError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExternalEvents([]);
          setExternalError("Could not load Google Calendar events");
        }
      })
      .finally(() => {
        if (!cancelled) setExternalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    externalConnected,
    showExternal,
    isDemo,
    hostId,
    fetchRange.from,
    fetchRange.to,
    refreshNonce,
  ]);

  async function handleSyncExternal() {
    if (!hostId || isDemo) return;
    setSyncingExternal(true);
    try {
      const result = await syncGoogleCalendarClient({ hostId });
      if (result.ok) {
        toast.success(
          result.eventCount === 0
            ? "Google Calendar synced"
            : `Synced ${result.eventCount} Google Calendar event${result.eventCount === 1 ? "" : "s"}`,
        );
        setRefreshNonce((n) => n + 1);
        setExternalError(null);
        setNeedsReconnect(false);
        return;
      }
      toast.error(result.error ?? "Could not sync Google Calendar");
    } finally {
      setSyncingExternal(false);
    }
  }

  const headerLabel =
    view === "day"
      ? format(focusDay, "MMMM d, yyyy")
      : view === "month"
        ? format(cursor, "MMMM yyyy")
        : view === "week"
          ? `${format(weekStart, "MMM d")} – ${format(weekDays[6]!, "MMM d, yyyy")}`
          : format(cursor, "MMMM yyyy");

  function handleSlotClick(day: Date, hour: number) {
    openScheduleDialog(day, `${String(hour).padStart(2, "0")}:00`);
  }

  function openScheduleDialog(day?: Date, startTime?: string) {
    const target = day ?? selectedDay ?? cursor;
    setCursor(target);
    setSelectedDay(target);
    setScheduleDate(target);
    setScheduleStartTime(startTime);
    setScheduleOpen(true);
  }

  function openTaskDialog(day?: Date, startTime?: string) {
    const target = day ?? selectedDay ?? cursor;
    setCursor(target);
    setSelectedDay(target);
    setScheduleDate(target);
    setScheduleStartTime(startTime);
    setTaskOpen(true);
  }

  function selectDay(day: Date) {
    setCursor(day);
    setSelectedDay(day);
    setView("day");
  }

  function goToday() {
    const today = new Date();
    setCursor(today);
    setSelectedDay(today);
    if (view !== "month" && view !== "schedule") setView("day");
  }

  function goPrev() {
    setCursor((d) => {
      const next =
        view === "day" ? subDays(d, 1) : view === "week" ? subWeeks(d, 1) : subMonths(d, 1);
      if (view === "day") setSelectedDay(next);
      return next;
    });
  }

  function goNext() {
    setCursor((d) => {
      const next =
        view === "day" ? addDays(d, 1) : view === "week" ? addWeeks(d, 1) : addMonths(d, 1);
      if (view === "day") setSelectedDay(next);
      return next;
    });
  }

  const scheduleItems = React.useMemo(() => {
    return [...visibleMeetings].sort(
      (a, b) => parseISO(a.startAt).getTime() - parseISO(b.startAt).getTime(),
    );
  }, [visibleMeetings]);

  const agendaTasks = React.useMemo(() => {
    return [...calendarTasks].sort(
      (a, b) => parseISO(a.dueAt).getTime() - parseISO(b.dueAt).getTime(),
    );
  }, [calendarTasks]);

  return (
    <div className="flex min-h-[560px] flex-col gap-4 lg:flex-row">
      {/* Sidebar, Google Calendar style */}
      <aside className="w-full shrink-0 space-y-4 lg:w-[220px]">
        <CalendarCreateMenu
          className="w-full"
          disabled={!hostId}
          onCreateEvent={() => openScheduleDialog()}
          onCreateTask={() => openTaskDialog()}
          onCreateAppointmentSchedule={() => onCreateAppointmentSchedule?.()}
        />
        <Calendar
          mode="single"
          selected={selectedDay ?? cursor}
          onSelect={(d) => d && selectDay(d)}
          className="rounded-lg border p-2"
        />
        <div className="space-y-3 text-sm">
          <p className="font-medium text-muted-foreground">My calendars</p>
          <label className="flex items-center gap-2">
            <Checkbox checked={showNova} onCheckedChange={(v) => setShowNova(Boolean(v))} />
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
              Nova meetings
            </span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={showTasks} onCheckedChange={(v) => setShowTasks(Boolean(v))} />
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
              Tasks
            </span>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={showExternal}
              onCheckedChange={(v) => setShowExternal(Boolean(v))}
              disabled={!externalConnected}
            />
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm bg-violet-500" />
              {externalConnected ? "Google / Outlook" : "Connect in Availability"}
            </span>
          </label>
          <p className="text-xs text-muted-foreground pt-1">
            Viewing <span className="font-medium text-foreground">{hostLabel}</span>
          </p>
          {externalConnected && showExternal && !externalLoading && visibleExternal.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {visibleExternal.length} Google event{visibleExternal.length === 1 ? "" : "s"} in view
            </p>
          )}
          {externalConnected && showExternal && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5"
              disabled={syncingExternal || externalLoading || !hostId}
              onClick={() => void handleSyncExternal()}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", (syncingExternal || externalLoading) && "animate-spin")}
              />
              Sync now
            </Button>
          )}
          {externalError && (
            <p className="text-xs text-destructive">{externalError}</p>
          )}
          {needsReconnect && !externalError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Reconnect Google in Availability → Calendar settings.
            </p>
          )}
        </div>
      </aside>

      {/* Main calendar */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goPrev} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={goNext} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-lg font-semibold tabular-nums">{headerLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!hostId}
              onClick={() => openScheduleDialog()}
            >
              <CalendarPlus className="h-4 w-4" />
              New event
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => openTaskDialog()}
            >
              <ListTodo className="h-4 w-4" />
              New task
            </Button>
            <Select
              value={view}
              onValueChange={(v) => {
                if (v === "day" || v === "month" || v === "week" || v === "schedule") {
                  setView(v);
                  if (v === "day" && !selectedDay) setSelectedDay(cursor);
                }
              }}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue>{VIEW_LABELS[view]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="schedule">Agenda</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading calendar…</p>
        ) : view === "month" ? (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const dayMeetings = meetingsForDay(visibleMeetings, day);
                const dayExternal = externalForDay(visibleExternal, day);
                const dayTasks = tasksForDay(calendarTasks, day);
                const totalCount = dayMeetings.length + dayExternal.length + dayTasks.length;
                const inMonth = isSameMonth(day, cursor);
                const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => openScheduleDialog(day)}
                    className={cn(
                      "min-h-[100px] border-b border-r p-1.5 text-left last:border-r-0 transition-colors",
                      !inMonth && "bg-muted/20 text-muted-foreground",
                      isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                      inMonth && "hover:bg-muted/30",
                    )}
                  >
                    <span
                      className={cn(
                        "mb-1 flex h-7 w-7 items-center justify-center rounded-full text-sm",
                        isToday(day) && "bg-primary text-primary-foreground font-semibold",
                        isSelected && !isToday(day) && "bg-primary/15 font-semibold text-primary",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <div className="space-y-0.5">
                      {dayMeetings.slice(0, 3).map((m) => (
                        <span
                          key={m.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMeeting(m);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedMeeting(m);
                            }
                          }}
                          className={cn(
                            "block w-full truncate rounded px-1 py-0.5 text-left text-[11px] border cursor-pointer",
                            meetingColor(m),
                          )}
                        >
                          {format(parseISO(m.startAt), "h:mm a")} {m.title}
                        </span>
                      ))}
                      {dayMeetings.length < 3 &&
                        dayExternal.slice(0, Math.max(0, 3 - dayMeetings.length)).map((e) => (
                          <span
                            key={e.id}
                            role="button"
                            tabIndex={0}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSelectedExternal(e);
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                ev.stopPropagation();
                                setSelectedExternal(e);
                              }
                            }}
                            className={cn(
                              "block w-full truncate rounded px-1 py-0.5 text-left text-[11px] border cursor-pointer",
                              externalEventColor(),
                            )}
                          >
                            {e.allDay ? "All day" : format(parseISO(e.startAt), "h:mm a")} {e.title}
                          </span>
                        ))}
                      {dayMeetings.length + dayExternal.length < 3 &&
                        dayTasks
                          .slice(0, Math.max(0, 3 - dayMeetings.length - dayExternal.length))
                          .map((t) => (
                            <span
                              key={t.id}
                              className={cn(
                                "block w-full truncate rounded px-1 py-0.5 text-left text-[11px] border",
                                taskEventColor(),
                              )}
                            >
                              {format(parseISO(t.dueAt), "h:mm a")} {t.title}
                            </span>
                          ))}
                      {totalCount > 3 && (
                        <p className="px-1 text-[10px] text-muted-foreground">
                          +{totalCount - 3} more
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : view === "week" ? (
          <div className="overflow-x-auto rounded-lg border">
            <div className="grid min-w-[700px] grid-cols-[56px_repeat(7,1fr)] border-b bg-muted/40">
              <div />
              {weekDays.map((day) => (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "border-l py-2 text-center text-xs",
                    isToday(day) && "bg-primary/5",
                  )}
                >
                  <div className="font-medium text-muted-foreground">{format(day, "EEE")}</div>
                  <div
                    className={cn(
                      "mx-auto mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                      isToday(day) && "bg-primary text-primary-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </div>
                </div>
              ))}
            </div>
            <div className="relative grid min-w-[700px] grid-cols-[56px_repeat(7,1fr)]">
              <div className="border-r">
                {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i).map(
                  (h) => (
                    <div
                      key={h}
                      className="border-b text-right pr-2 text-[10px] text-muted-foreground"
                      style={{ height: HOUR_HEIGHT }}
                    >
                      {format(new Date(2000, 0, 1, h), "h a")}
                    </div>
                  ),
                )}
              </div>
              {weekDays.map((day) =>
                renderTimeGridColumn({
                  day,
                  hourStart: HOUR_START,
                  hourEnd: HOUR_END,
                  dayMeetings: meetingsForDay(visibleMeetings, day),
                  dayExternal: externalForDay(visibleExternal, day),
                  dayTasks: tasksForDay(calendarTasks, day),
                  onSlotClick: handleSlotClick,
                  onMeetingClick: setSelectedMeeting,
                  onExternalClick: setSelectedExternal,
                }),
              )}
            </div>
          </div>
        ) : view === "day" ? (
          <div className="overflow-hidden rounded-lg border">
            {tasksForDay(calendarTasks, focusDay).length > 0 && (
                <div className="border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {tasksForDay(calendarTasks, focusDay).length} pending task
                  {tasksForDay(calendarTasks, focusDay).length === 1 ? "" : "s"}
                </div>
              )}
            <div className="grid grid-cols-[56px_1fr] border-b bg-muted/40">
              <div />
              <div className={cn("py-3 text-center", isToday(focusDay) && "bg-primary/5")}>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {format(focusDay, "EEEE")}
                </div>
                <div
                  className={cn(
                    "mx-auto mt-1 flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold",
                    isToday(focusDay) && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(focusDay, "d")}
                </div>
              </div>
            </div>
            <div className="relative grid grid-cols-[56px_1fr]">
              <div className="border-r">
                {Array.from(
                  { length: DAY_VIEW_HOUR_END - DAY_VIEW_HOUR_START },
                  (_, i) => DAY_VIEW_HOUR_START + i,
                ).map((h) => (
                  <div
                    key={h}
                    className="border-b text-right pr-2 text-[10px] text-muted-foreground"
                    style={{ height: HOUR_HEIGHT }}
                  >
                    {format(new Date(2000, 0, 1, h), h === 0 ? "ha" : "h a")}
                  </div>
                ))}
              </div>
              {renderTimeGridColumn({
                day: focusDay,
                hourStart: DAY_VIEW_HOUR_START,
                hourEnd: DAY_VIEW_HOUR_END,
                dayMeetings: meetingsForDay(visibleMeetings, focusDay),
                dayExternal: externalForDay(visibleExternal, focusDay),
                dayTasks: tasksForDay(calendarTasks, focusDay),
                onSlotClick: handleSlotClick,
                onMeetingClick: setSelectedMeeting,
                onExternalClick: setSelectedExternal,
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {scheduleItems.length === 0 && visibleExternal.length === 0 && agendaTasks.length === 0 ? (
              <p className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
                No events yet. Use Create to add a meeting or task.
              </p>
            ) : (
              <>
                {scheduleItems.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMeeting(m)}
                    className="flex w-full items-start gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="w-24 shrink-0 text-sm text-muted-foreground">
                      {fmtDate(m.startAt, "EEE, MMM d")}
                      <br />
                      {format(parseISO(m.startAt), "h:mm a")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{m.title}</p>
                      <p className="text-sm text-muted-foreground">
                        with {m.attendeeName}
                        {m.bookedByName && m.bookedById !== m.hostId
                          ? ` · booked by ${m.bookedByName}`
                          : ""}
                      </p>
                    </div>
                    <Badge variant="outline">{m.status}</Badge>
                  </button>
                ))}
                {agendaTasks.map((t) => (
                  <div
                    key={t.id}
                    className="flex w-full items-start gap-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-left"
                  >
                    <div className="w-24 shrink-0 text-sm text-muted-foreground">
                      {fmtDate(t.dueAt, "EEE, MMM d")}
                      <br />
                      {format(parseISO(t.dueAt), "h:mm a")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {t.kind === "lead_task" ? "Assigned task" : "Personal task"}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-800 dark:text-amber-200">
                      Task
                    </Badge>
                  </div>
                ))}
                {visibleExternal.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedExternal(e)}
                    className="flex w-full items-start gap-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4 text-left transition-colors hover:bg-violet-500/10"
                  >
                    <div className="w-24 shrink-0 text-sm text-muted-foreground">
                      {fmtDate(e.startAt, "EEE, MMM d")}
                      <br />
                      {e.allDay ? "All day" : format(parseISO(e.startAt), "h:mm a")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{e.title}</p>
                      <p className="text-sm text-muted-foreground">{e.accountEmail}</p>
                    </div>
                    <Badge variant="outline" className="border-violet-500/40 text-violet-700 dark:text-violet-300">
                      Google
                    </Badge>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <Dialog open={Boolean(selectedMeeting)} onOpenChange={() => setSelectedMeeting(null)}>
        <DialogContent className="max-w-md">
          {selectedMeeting && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedMeeting.title}</DialogTitle>
              </DialogHeader>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">When</dt>
                  <dd>
                    {format(parseISO(selectedMeeting.startAt), "EEEE, MMMM d · h:mm a")} –{" "}
                    {format(parseISO(selectedMeeting.endAt), "h:mm a")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">With</dt>
                  <dd>{selectedMeeting.attendeeName}</dd>
                </div>
                {selectedMeeting.hostName && (
                  <div>
                    <dt className="text-muted-foreground">Host</dt>
                    <dd>{selectedMeeting.hostName}</dd>
                  </div>
                )}
                {selectedMeeting.bookedByName && selectedMeeting.bookedById !== selectedMeeting.hostId && (
                  <div>
                    <dt className="text-muted-foreground">Booked by</dt>
                    <dd>{selectedMeeting.bookedByName}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="capitalize">{selectedMeeting.status}</dd>
                </div>
              </dl>
              {selectedMeeting.leadId && (
                <Button
                  variant="outline"
                  className="mt-2 w-full"
                  nativeButton={false}
                  render={<Link href={`/leads/${selectedMeeting.leadId}`}>Open lead</Link>}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {hostId ? (
        <ScheduleMeetingDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          hostId={hostId}
          hostLabel={hostLabel}
          links={links}
          isDemo={isDemo}
          initialDate={scheduleDate}
          initialStartTime={scheduleStartTime}
          defaultAttendeeName={defaultGuestName}
          defaultAttendeeEmail={defaultGuestEmail}
          onBooked={(meeting) => {
            onMeetingBooked?.(meeting);
            setSelectedDay(parseISO(meeting.startAt));
            setCursor(parseISO(meeting.startAt));
          }}
        />
      ) : null}

      <CalendarTaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        currentUserId={currentUserId}
        initialDate={scheduleDate}
        initialStartTime={scheduleStartTime}
        onCreate={addFollowup}
      />

      <Dialog open={Boolean(selectedExternal)} onOpenChange={() => setSelectedExternal(null)}>
        <DialogContent className="max-w-md">
          {selectedExternal && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedExternal.title}</DialogTitle>
              </DialogHeader>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">When</dt>
                  <dd>
                    {selectedExternal.allDay
                      ? format(parseISO(selectedExternal.startAt), "EEEE, MMMM d · All day")
                      : `${format(parseISO(selectedExternal.startAt), "EEEE, MMMM d · h:mm a")} – ${format(parseISO(selectedExternal.endAt), "h:mm a")}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Calendar</dt>
                  <dd>{selectedExternal.accountEmail}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Source</dt>
                  <dd className="capitalize">{selectedExternal.provider} Calendar</dd>
                </div>
              </dl>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
