"use client";

import * as React from "react";
import {
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import type { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type { DateRange };

type Preset = { key: string; label: string; build: () => Required<DateRange> };

const PRESETS: Preset[] = [
  {
    key: "today",
    label: "Today",
    build: () => {
      const d = new Date();
      return { from: startOfDay(d), to: endOfDay(d) };
    },
  },
  {
    key: "yesterday",
    label: "Yesterday",
    build: () => {
      const d = subDays(new Date(), 1);
      return { from: startOfDay(d), to: endOfDay(d) };
    },
  },
  {
    key: "7d",
    label: "Last 7 days",
    build: () => ({
      from: startOfDay(subDays(new Date(), 6)),
      to: endOfDay(new Date()),
    }),
  },
  {
    key: "30d",
    label: "Last 30 days",
    build: () => ({
      from: startOfDay(subDays(new Date(), 29)),
      to: endOfDay(new Date()),
    }),
  },
  {
    key: "thisMonth",
    label: "This month",
    build: () => ({
      from: startOfMonth(new Date()),
      to: endOfDay(new Date()),
    }),
  },
  {
    key: "lastMonth",
    label: "Last month",
    build: () => {
      const d = subMonths(new Date(), 1);
      return { from: startOfMonth(d), to: endOfMonth(d) };
    },
  },
];

function isSameDay(a?: Date, b?: Date) {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function detectPreset(range?: DateRange): Preset | null {
  if (!range?.from || !range.to) return null;
  for (const p of PRESETS) {
    const built = p.build();
    if (isSameDay(built.from, range.from) && isSameDay(built.to, range.to)) return p;
  }
  return null;
}

function summarizeRange(range: DateRange) {
  const preset = detectPreset(range);
  if (preset) return preset.label;
  const fmt = (d?: Date) => (d ? format(d, "MMM d") : "…");
  if (range.from && range.to && isSameDay(range.from, range.to)) {
    return format(range.from, "MMM d, yyyy");
  }
  return `${fmt(range.from)} – ${fmt(range.to)}`;
}

/** Inclusive range test using the day boundaries selected in the picker. */
export function isWithinRange(iso: string | undefined | null, range?: DateRange) {
  if (!iso) return !range?.from && !range?.to;
  if (!range?.from && !range?.to) return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (range?.from && t < startOfDay(range.from).getTime()) return false;
  if (range?.to && t > endOfDay(range.to).getTime()) return false;
  return true;
}

export interface DateRangeFilterProps {
  label: string;
  value?: DateRange;
  onChange: (range?: DateRange) => void;
  className?: string;
  align?: "start" | "center" | "end";
}

export function DateRangeFilter({
  label,
  value,
  onChange,
  className,
  align = "start",
}: DateRangeFilterProps) {
  const hasValue = !!(value?.from || value?.to);
  const activePreset = React.useMemo(() => detectPreset(value), [value]);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn("gap-1.5", className)}>
            <CalendarIcon className="h-3.5 w-3.5" />
            {label}
            {hasValue && value ? (
              <Badge
                variant="secondary"
                className="ml-1 h-4 px-1.5 text-[10px] font-normal tabular-nums"
              >
                {summarizeRange(value)}
              </Badge>
            ) : null}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        }
      />
      <PopoverContent
        className="w-auto flex-row gap-0 p-0"
        align={align}
        sideOffset={6}
      >
        <div className="flex min-w-[8.5rem] flex-col gap-0.5 border-r p-2">
          {PRESETS.map((p) => {
            const active = activePreset?.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                className={cn(
                  "rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => onChange(p.build())}
              >
                {p.label}
              </button>
            );
          })}
          <div className="my-1 border-t" />
          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            onClick={() => onChange(undefined)}
            disabled={!hasValue}
          >
            Clear
          </button>
        </div>
        <div className="p-2">
          <Calendar
            mode="range"
            selected={value}
            onSelect={(r) => onChange(r ?? undefined)}
            numberOfMonths={2}
            defaultMonth={value?.from ?? new Date()}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
