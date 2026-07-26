import type {
  ContentBrand,
  ContentCapturePolicy,
  ContentCaptureRequiredField,
  ContentCaptureStatus,
} from "@/lib/content-calendar/types";
import { resolveBrandResponsibility } from "@/lib/content-calendar/types";

export const DEFAULT_CAPTURE_POLICY: ContentCapturePolicy = {
  capturesPerWeek: 0,
  idleDays: 7,
  requiredFields: ["problem", "solution"],
  remindersEnabled: false,
  requirementsNotes: "",
};

export const CAPTURE_REQUIRED_FIELD_LABELS: Record<ContentCaptureRequiredField, string> = {
  problem: "Problem",
  solution: "Solution",
  outcome: "Outcome",
  notes: "Extra notes",
};

const ALL_REQUIRED_FIELDS: ContentCaptureRequiredField[] = [
  "problem",
  "solution",
  "outcome",
  "notes",
];

const MS_DAY = 86_400_000;
const WEEK_MS = 7 * MS_DAY;

export function normalizeCapturePolicy(
  raw: Partial<ContentCapturePolicy> | null | undefined,
): ContentCapturePolicy {
  const capturesPerWeek = clampInt(raw?.capturesPerWeek, 0, 50, DEFAULT_CAPTURE_POLICY.capturesPerWeek);
  const idleDays = clampInt(raw?.idleDays, 1, 90, DEFAULT_CAPTURE_POLICY.idleDays);
  const requiredFields = normalizeRequiredFields(raw?.requiredFields);
  return {
    capturesPerWeek,
    idleDays,
    requiredFields,
    remindersEnabled: Boolean(raw?.remindersEnabled),
    requirementsNotes:
      typeof raw?.requirementsNotes === "string" ? raw.requirementsNotes.trim() : "",
  };
}

function normalizeRequiredFields(
  raw: ContentCaptureRequiredField[] | undefined,
): ContentCaptureRequiredField[] {
  const set = new Set<ContentCaptureRequiredField>(["problem", "solution"]);
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (ALL_REQUIRED_FIELDS.includes(f)) set.add(f);
    }
  }
  return ALL_REQUIRED_FIELDS.filter((f) => set.has(f));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function brandCapturePolicy(
  brand: Pick<ContentBrand, "capturePolicy">,
): ContentCapturePolicy {
  return normalizeCapturePolicy(brand.capturePolicy);
}

export type CaptureFieldInput = {
  problem?: string;
  solution?: string;
  outcome?: string;
  notes?: string;
};

/** Returns missing required field keys for a capture draft. */
export function missingCaptureFields(
  policy: ContentCapturePolicy,
  input: CaptureFieldInput,
): ContentCaptureRequiredField[] {
  const missing: ContentCaptureRequiredField[] = [];
  for (const field of policy.requiredFields) {
    const value = (input[field] ?? "").trim();
    if (!value) missing.push(field);
  }
  return missing;
}

export function validateCaptureFields(
  policy: ContentCapturePolicy,
  input: CaptureFieldInput,
): { ok: true } | { ok: false; missing: ContentCaptureRequiredField[] } {
  const missing = missingCaptureFields(policy, input);
  if (missing.length) return { ok: false, missing };
  return { ok: true };
}

export type CaptureTimestamp = {
  brandId?: string;
  createdAt: string;
  /** When set, only `indexed` counts toward quota / idle. */
  status?: ContentCaptureStatus;
};

/** Successful indexed captures only — drafts/failed do not satisfy quota or reset idle. */
export function countsTowardCaptureProgress(capture: CaptureTimestamp): boolean {
  return capture.status === "indexed";
}

function progressCaptures(captures: CaptureTimestamp[]): CaptureTimestamp[] {
  return captures.filter(countsTowardCaptureProgress);
}

export function capturesForBrandInWindow(
  captures: CaptureTimestamp[],
  brandId: string,
  nowMs: number,
  windowMs: number = WEEK_MS,
): CaptureTimestamp[] {
  const cutoff = nowMs - windowMs;
  return progressCaptures(captures).filter((c) => {
    if (c.brandId !== brandId) return false;
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function latestCaptureAtMs(
  captures: CaptureTimestamp[],
  brandId: string,
): number {
  return progressCaptures(captures)
    .filter((c) => c.brandId === brandId)
    .reduce((max, c) => Math.max(max, new Date(c.createdAt).getTime() || 0), 0);
}

export function isBrandCaptureIdle(input: {
  brand: Pick<ContentBrand, "id" | "capturePolicy" | "active">;
  captures: CaptureTimestamp[];
  nowMs: number;
}): boolean {
  if (!input.brand.active) return false;
  const policy = brandCapturePolicy(input.brand);
  const latest = latestCaptureAtMs(input.captures, input.brand.id);
  const cutoff = input.nowMs - policy.idleDays * MS_DAY;
  return latest === 0 || latest < cutoff;
}

export function isCapturerIdle(input: {
  brand: Pick<
    ContentBrand,
    "id" | "capturePolicy" | "ownerUserId" | "defaultOwnerUserId" | "responsibilities" | "active"
  >;
  captures: CaptureTimestamp[];
  capturerUserId: string;
  nowMs: number;
}): boolean {
  const capturer = resolveBrandResponsibility(input.brand, "capturer");
  if (!capturer || capturer !== input.capturerUserId) return false;
  return isBrandCaptureIdle(input);
}

export function isBehindCaptureCadence(input: {
  brand: Pick<ContentBrand, "id" | "capturePolicy" | "active">;
  captures: CaptureTimestamp[];
  nowMs: number;
}): boolean {
  const { brand, captures, nowMs } = input;
  if (!brand.active) return false;
  const policy = brandCapturePolicy(brand);
  if (policy.capturesPerWeek <= 0) return false;
  const weekCount = capturesForBrandInWindow(captures, brand.id, nowMs).length;
  return weekCount < policy.capturesPerWeek;
}

export type CaptureProgress = {
  policy: ContentCapturePolicy;
  weekCount: number;
  target: number;
  behindCadence: boolean;
  idle: boolean;
  lastCaptureAt: string | null;
  daysSinceLast: number | null;
};

export function getCaptureProgress(input: {
  brand: Pick<
    ContentBrand,
    "id" | "capturePolicy" | "ownerUserId" | "defaultOwnerUserId" | "responsibilities" | "active"
  >;
  captures: CaptureTimestamp[];
  currentUserId: string;
  nowMs: number;
}): CaptureProgress {
  const { brand, captures, currentUserId, nowMs } = input;
  const policy = brandCapturePolicy(brand);
  const weekCount = capturesForBrandInWindow(captures, brand.id, nowMs).length;
  const latestMs = latestCaptureAtMs(captures, brand.id);
  const lastCaptureAt = latestMs > 0 ? new Date(latestMs).toISOString() : null;
  const daysSinceLast =
    latestMs > 0 ? Math.floor((nowMs - latestMs) / MS_DAY) : null;
  return {
    policy,
    weekCount,
    target: policy.capturesPerWeek,
    behindCadence: isBehindCaptureCadence({ brand, captures, nowMs }),
    idle: isCapturerIdle({
      brand,
      captures,
      capturerUserId: currentUserId,
      nowMs,
    }),
    lastCaptureAt,
    daysSinceLast,
  };
}

export function brandsNeedingCaptureAttention(input: {
  brands: ContentBrand[];
  captures: CaptureTimestamp[];
  currentUserId: string;
  nowMs: number;
}): Array<{ brand: ContentBrand; progress: CaptureProgress }> {
  const out: Array<{ brand: ContentBrand; progress: CaptureProgress }> = [];
  for (const brand of input.brands) {
    if (!brand.active) continue;
    const capturer = resolveBrandResponsibility(brand, "capturer");
    if (!capturer || capturer !== input.currentUserId) continue;
    const progress = getCaptureProgress({
      brand,
      captures: input.captures,
      currentUserId: input.currentUserId,
      nowMs: input.nowMs,
    });
    if (progress.idle || progress.behindCadence) {
      out.push({ brand, progress });
    }
  }
  return out;
}

/** Short copy for dashboard / calendar banners when the current user owes capture. */
export function captureDutyBannerCopy(
  attention: Array<{ brand: Pick<ContentBrand, "name">; progress: CaptureProgress }>,
): { headline: string; detail: string } | null {
  if (attention.length === 0) return null;

  const names = attention.map((a) => a.brand.name);
  const brandList =
    names.length === 1
      ? names[0]!
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

  if (attention.length === 1) {
    const { brand, progress } = attention[0]!;
    if (progress.behindCadence && progress.target > 0) {
      return {
        headline: `Your capture for ${brand.name} is pending this week`,
        detail: `${progress.weekCount}/${progress.target} done. Add proof now so content stays on schedule.`,
      };
    }
    if (progress.idle) {
      return {
        headline: `Your capture for ${brand.name} needs attention`,
        detail:
          progress.daysSinceLast == null
            ? "No captures yet. Log this week's proof so the calendar stays fed."
            : `Idle ${progress.daysSinceLast}+ days. Capture now to keep the pipeline moving.`,
      };
    }
  }

  const anyBehind = attention.some((a) => a.progress.behindCadence && a.progress.target > 0);
  return {
    headline: anyBehind
      ? "Your weekly capture is pending"
      : "Your capture duty needs attention",
    detail: `Open for ${brandList}. Capture proof now.`,
  };
}

/** Whether cron should notify the capturer today. */
export function shouldRemindCapturer(input: {
  brand: Pick<ContentBrand, "id" | "capturePolicy" | "active">;
  captures: CaptureTimestamp[];
  nowMs: number;
}): boolean {
  const policy = brandCapturePolicy(input.brand);
  if (!input.brand.active || !policy.remindersEnabled) return false;
  return isBehindCaptureCadence(input) || isBrandCaptureIdle(input);
}

export function captureReminderMessage(input: {
  brandName: string;
  progress: Pick<
    CaptureProgress,
    "weekCount" | "target" | "idle" | "behindCadence" | "policy" | "daysSinceLast"
  >;
}): string {
  const { brandName, progress } = input;
  const parts: string[] = [];
  if (progress.behindCadence && progress.target > 0) {
    parts.push(
      `${progress.weekCount}/${progress.target} captures this week for ${brandName}`,
    );
  }
  if (progress.idle) {
    if (progress.daysSinceLast == null) {
      parts.push(`No captures yet for ${brandName}`);
    } else {
      parts.push(
        `No capture for ${brandName} in ${progress.daysSinceLast}+ days (idle after ${progress.policy.idleDays})`,
      );
    }
  }
  if (parts.length === 0) {
    return `Capture reminder for ${brandName}`;
  }
  return `${parts.join(". ")}. Add proof in Capture.`;
}

/** Normalize form/API input before persisting on a brand. */
export function capturePolicyForPersist(
  raw: Partial<ContentCapturePolicy> | null | undefined,
): ContentCapturePolicy {
  return normalizeCapturePolicy(raw);
}
