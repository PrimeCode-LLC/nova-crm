import type { ContentCadence, ContentPlatform } from "@/lib/content-calendar/types";

export type ContentScheduleSlot = {
  publishAt: string;
  platform: ContentPlatform;
};

/** Mon–Fri when brand has no preferred weekdays configured. */
const DEFAULT_PREFERRED_WEEKDAYS = [1, 2, 3, 4, 5];

function parseDateOnly(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function atPublishHour(dateOnly: string, hour: number, minuteOffset: number): string {
  const d = parseDateOnly(dateOnly);
  d.setHours(hour, Math.min(minuteOffset, 50), 0, 0);
  return d.toISOString();
}

/**
 * Preferred publish days inside a calendar window (startDate + dayCount days).
 * Skips weekends unless they are explicitly listed in preferredWeekdays.
 */
export function listPreferredPublishDays(input: {
  startDate: string;
  dayCount: number;
  preferredWeekdays: number[];
}): string[] {
  const preferred =
    input.preferredWeekdays.length > 0
      ? input.preferredWeekdays
      : DEFAULT_PREFERRED_WEEKDAYS;
  const days: string[] = [];
  const start = parseDateOnly(input.startDate);
  for (let i = 0; i < input.dayCount; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    if (preferred.includes(d.getDay())) {
      days.push(toDateOnly(d));
    }
  }
  return days;
}

/**
 * Scale weekly platform targets to the plan window and build concrete slots.
 * Multiple platforms may share a day when cadence calls for it.
 */
export function buildContentScheduleSlots(input: {
  startDate: string;
  dayCount: number;
  platforms: ContentPlatform[];
  cadence: ContentCadence;
  publishHour?: number;
}): ContentScheduleSlot[] {
  const { platforms, cadence } = input;
  if (platforms.length === 0) return [];

  const publishDays = listPreferredPublishDays({
    startDate: input.startDate,
    dayCount: input.dayCount,
    preferredWeekdays: cadence.preferredWeekdays ?? [],
  });
  if (publishDays.length === 0) return [];

  const weeks = Math.max(input.dayCount / 7, 0.5);
  const targets = new Map<ContentPlatform, number>();
  let total = 0;

  for (const platform of platforms) {
    const perWeek = cadence.postsPerWeek[platform];
    const n =
      typeof perWeek === "number" && perWeek > 0
        ? Math.max(1, Math.round(perWeek * weeks))
        : Math.max(1, Math.round(weeks * 2));
    targets.set(platform, n);
    total += n;
  }

  // Cap so we don't explode density on short windows, but allow multi-platform days.
  const maxSlots = Math.max(platforms.length, publishDays.length * Math.min(platforms.length, 3));
  if (total > maxSlots) {
    const scale = maxSlots / total;
    total = 0;
    for (const platform of platforms) {
      const next = Math.max(1, Math.round((targets.get(platform) ?? 1) * scale));
      targets.set(platform, next);
      total += next;
    }
  }

  // Round-robin platforms into a queue so days get mixed coverage.
  const queue: ContentPlatform[] = [];
  const remaining = new Map(targets);
  while (queue.length < total) {
    let added = false;
    for (const platform of platforms) {
      const left = remaining.get(platform) ?? 0;
      if (left > 0) {
        queue.push(platform);
        remaining.set(platform, left - 1);
        added = true;
      }
    }
    if (!added) break;
  }

  const hour = input.publishHour ?? 10;
  const perDay = new Map<string, ContentPlatform[]>();
  for (const day of publishDays) perDay.set(day, []);

  for (let i = 0; i < queue.length; i++) {
    const day = publishDays[i % publishDays.length]!;
    const list = perDay.get(day)!;
    const platform = queue[i]!;
    // Prefer spreading: if this platform already on the day and another day is freer, skip ahead.
    if (list.includes(platform) && publishDays.length > 1) {
      let placed = false;
      for (let j = 1; j < publishDays.length; j++) {
        const alt = publishDays[(i + j) % publishDays.length]!;
        const altList = perDay.get(alt)!;
        if (!altList.includes(platform)) {
          altList.push(platform);
          placed = true;
          break;
        }
      }
      if (!placed) list.push(platform);
    } else {
      list.push(platform);
    }
  }

  const slots: ContentScheduleSlot[] = [];
  for (const day of publishDays) {
    const list = perDay.get(day) ?? [];
    list.forEach((platform, idx) => {
      slots.push({
        platform,
        publishAt: atPublishHour(day, hour, idx * 30),
      });
    });
  }

  return slots;
}

/** Strip common AI-tell punctuation and markdown from generated social copy. */
export function scrubAiTellPunctuation(text: string): string {
  return text
    .replace(/\u2014/g, ", ") // em dash —
    .replace(/\u2013/g, "-") // en dash –
    .replace(/\u2026/g, "...") // ellipsis …
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    // Markdown links / images → label only
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Bold / italic wrappers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<![\w/])\*([^*\n]+)\*(?![\w/])/g, "$1")
    .replace(/(?<![\w/])_([^_\n]+)_(?![\w/])/g, "$1")
    // Stray markdown markers
    .replace(/`{1,3}/g, "")
    .replace(/\*{1,2}/g, "")
    // Headers, horizontal rules, list markers at line start
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\t ]*[-*_]{3,}[\t ]*$/gm, "")
    .replace(/^[\t ]*[-*+]\s+/gm, "")
    .replace(/^[\t ]*\d+[.)]\s+/gm, "")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
