import type { ContentCadence, ContentPlatform } from "@/lib/content-calendar/types";
import {
  contentPublishHour,
  getContentPlatformPlaybook,
} from "@/lib/content-calendar/platform-playbooks";

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
    // Stagger by 30 minutes only when two slots would land on the same hour.
    const usedPerHour = new Map<number, number>();
    for (const platform of list) {
      const hour = input.publishHour ?? contentPublishHour(platform);
      const taken = usedPerHour.get(hour) ?? 0;
      usedPerHour.set(hour, taken + 1);
      slots.push({
        platform,
        publishAt: atPublishHour(day, hour, taken * 30),
      });
    }
  }

  slots.sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  return slots;
}

/** Normalize punctuation that reads as machine-written, without touching layout. */
function normalizeAiTellPunctuation(text: string): string {
  return text
    .replace(/\u2014/g, ", ") // em dash —
    .replace(/\u2013/g, "-") // en dash –
    .replace(/\u2026/g, "...") // ellipsis …
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+,/g, ",")
    .replace(/,{2,}/g, ",");
}

/**
 * Clean a generated post body for one platform.
 *
 * Unlike scrubAiTellPunctuation, this preserves the line structure the writer
 * chose, because paragraph rhythm and short lists are how posts earn dwell time.
 * Reddit keeps its markdown, since Reddit is the only supported platform that
 * renders it.
 */
export function scrubPostBody(text: string, platform: ContentPlatform): string {
  const normalized = normalizeAiTellPunctuation(text);

  if (getContentPlatformPlaybook(platform).rendersMarkdown) {
    return normalized
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  return (
    normalized
      // Markdown links / images → visible label only.
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Normalize list markers to a plain hyphen before stripping stray markers.
      .replace(/^[\t ]*[*+][\t ]+/gm, "- ")
      // Emphasis wrappers.
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(?<![\w/])\*([^*\n]+)\*(?![\w/])/g, "$1")
      .replace(/(?<![\w/])_([^_\n]+)_(?![\w/])/g, "$1")
      .replace(/`{1,3}/g, "")
      .replace(/\*+/g, "")
      // Headings and horizontal rules have no meaning off-Reddit.
      .replace(/^#{1,6}[\t ]+/gm, "")
      .replace(/^[\t ]*[-*_]{3,}[\t ]*$/gm, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Trim an over-long body to the platform ceiling, cutting at the last paragraph
 * or sentence boundary so the post never ends mid-thought.
 */
export function clampPostBody(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const paragraphBreak = slice.lastIndexOf("\n\n");
  if (paragraphBreak > limit * 0.6) return slice.slice(0, paragraphBreak).trimEnd();
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf(".\n"),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("! "),
  );
  if (sentenceEnd > limit * 0.6) return slice.slice(0, sentenceEnd + 1).trimEnd();
  return slice.trimEnd();
}

/**
 * Strip AI-tell punctuation and all markdown, flattening list markers.
 *
 * Use for short single-line strings such as titles, angles, rationales and
 * design briefs. For post bodies use scrubPostBody, which keeps layout intact.
 */
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
