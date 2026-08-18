/**
 * Phase 1.5 — Content capture reminders run on Cloud Functions, not App Hosting.
 * Rollback: CONTENT_CAPTURE_REMINDERS_RUNTIME=apphosting.
 */
import { getFirestore } from "firebase-admin/firestore";

const CAPTURE_REMINDER_LOCAL_HOUR = 9;
const MS_DAY = 86_400_000;
const WEEK_MS = 7 * MS_DAY;

const COLLECTIONS = {
  contentBrands: "contentBrands",
  contentCaptures: "contentCaptures",
  organizations: "organizations",
  userNotifications: "userNotifications",
} as const;

type CapturePolicy = {
  capturesPerWeek: number;
  idleDays: number;
  remindersEnabled: boolean;
};

type BrandLite = {
  id: string;
  organizationId: string;
  name: string;
  active: boolean;
  ownerUserId: string;
  defaultOwnerUserId?: string;
  responsibilities?: Partial<Record<string, string>>;
  capturePolicy?: CapturePolicy;
};

type CaptureTimestamp = {
  brandId?: string;
  createdAt: string;
  status?: string;
};

function db() {
  return getFirestore();
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeCapturePolicy(raw: Partial<CapturePolicy> | null | undefined): CapturePolicy {
  return {
    capturesPerWeek: clampInt(raw?.capturesPerWeek, 0, 50, 0),
    idleDays: clampInt(raw?.idleDays, 1, 90, 7),
    remindersEnabled: Boolean(raw?.remindersEnabled),
  };
}

function mapIsoField(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  return "";
}

function mapBrand(id: string, data: Record<string, unknown>): BrandLite {
  const policyRaw =
    data.capturePolicy && typeof data.capturePolicy === "object"
      ? (data.capturePolicy as Record<string, unknown>)
      : undefined;
  const responsibilitiesRaw =
    data.responsibilities && typeof data.responsibilities === "object"
      ? (data.responsibilities as Record<string, unknown>)
      : undefined;
  const responsibilities: Partial<Record<string, string>> = {};
  if (responsibilitiesRaw) {
    for (const key of ["planner", "writer", "designer", "poster", "capturer", "approver"]) {
      const v = str(responsibilitiesRaw[key]).trim();
      if (v) responsibilities[key] = v;
    }
  }
  return {
    id,
    organizationId: str(data.organizationId),
    name: str(data.name, "Brand"),
    active: bool(data.active, true),
    ownerUserId: str(data.ownerUserId),
    defaultOwnerUserId: str(data.defaultOwnerUserId) || undefined,
    responsibilities: Object.keys(responsibilities).length ? responsibilities : undefined,
    capturePolicy: policyRaw
      ? normalizeCapturePolicy({
          capturesPerWeek:
            typeof policyRaw.capturesPerWeek === "number" ? policyRaw.capturesPerWeek : undefined,
          idleDays: typeof policyRaw.idleDays === "number" ? policyRaw.idleDays : undefined,
          remindersEnabled: bool(policyRaw.remindersEnabled, false),
        })
      : undefined,
  };
}

function brandCapturePolicy(brand: BrandLite): CapturePolicy {
  return normalizeCapturePolicy(brand.capturePolicy);
}

function resolveCapturer(brand: BrandLite): string {
  const fromSlot = brand.responsibilities?.capturer?.trim();
  if (fromSlot) return fromSlot;
  return brand.ownerUserId?.trim() || brand.defaultOwnerUserId?.trim() || "";
}

function progressCaptures(captures: CaptureTimestamp[]): CaptureTimestamp[] {
  return captures.filter((c) => c.status === "indexed");
}

function capturesForBrandInWindow(
  captures: CaptureTimestamp[],
  brandId: string,
  nowMs: number,
): CaptureTimestamp[] {
  const cutoff = nowMs - WEEK_MS;
  return progressCaptures(captures).filter((c) => {
    if (c.brandId !== brandId) return false;
    const t = new Date(c.createdAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function latestCaptureAtMs(captures: CaptureTimestamp[], brandId: string): number {
  return progressCaptures(captures)
    .filter((c) => c.brandId === brandId)
    .reduce((max, c) => Math.max(max, new Date(c.createdAt).getTime() || 0), 0);
}

function isBrandCaptureIdle(brand: BrandLite, captures: CaptureTimestamp[], nowMs: number): boolean {
  if (!brand.active) return false;
  const policy = brandCapturePolicy(brand);
  const latest = latestCaptureAtMs(captures, brand.id);
  const cutoff = nowMs - policy.idleDays * MS_DAY;
  return latest === 0 || latest < cutoff;
}

function isBehindCaptureCadence(
  brand: BrandLite,
  captures: CaptureTimestamp[],
  nowMs: number,
): boolean {
  if (!brand.active) return false;
  const policy = brandCapturePolicy(brand);
  if (policy.capturesPerWeek <= 0) return false;
  return capturesForBrandInWindow(captures, brand.id, nowMs).length < policy.capturesPerWeek;
}

function shouldRemindCapturer(
  brand: BrandLite,
  captures: CaptureTimestamp[],
  nowMs: number,
): boolean {
  const policy = brandCapturePolicy(brand);
  if (!brand.active || !policy.remindersEnabled) return false;
  return isBehindCaptureCadence(brand, captures, nowMs) || isBrandCaptureIdle(brand, captures, nowMs);
}

function captureReminderMessage(input: {
  brandName: string;
  weekCount: number;
  target: number;
  idle: boolean;
  behindCadence: boolean;
  idleDays: number;
  daysSinceLast: number | null;
}): string {
  const parts: string[] = [];
  if (input.behindCadence && input.target > 0) {
    parts.push(`${input.weekCount}/${input.target} captures this week for ${input.brandName}`);
  }
  if (input.idle) {
    if (input.daysSinceLast == null) {
      parts.push(`No captures yet for ${input.brandName}`);
    } else {
      parts.push(
        `No capture for ${input.brandName} in ${input.daysSinceLast}+ days (idle after ${input.idleDays})`,
      );
    }
  }
  if (parts.length === 0) return `Capture reminder for ${input.brandName}`;
  return `${parts.join(". ")}. Add proof in Capture.`;
}

function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(date: Date, timeZone: string): { hour: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
  };
}

function zonedDayKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

async function orgTimezone(organizationId: string): Promise<string> {
  const snap = await db().collection(COLLECTIONS.organizations).doc(organizationId).get();
  const settings = (snap.data()?.settings ?? {}) as Record<string, unknown>;
  const tz = typeof settings.timezone === "string" ? settings.timezone.trim() : "";
  if (tz && isValidIanaTimezone(tz)) return tz;
  return "UTC";
}

async function createUserNotification(input: {
  id: string;
  organizationId: string;
  recipientId: string;
  actorId: string;
  message: string;
  target: string;
}): Promise<boolean> {
  const recipientId = input.recipientId.trim();
  const actorId = input.actorId.trim();
  if (!recipientId || recipientId === actorId) return false;
  const ref = db().collection(COLLECTIONS.userNotifications).doc(input.id);
  const existing = await ref.get();
  if (existing.exists) return false;
  const createdAt = new Date().toISOString();
  await ref.set({
    organizationId: input.organizationId,
    recipientId,
    kind: "idle",
    actorId,
    message: input.message,
    target: input.target,
    targetHref: "/content/capture",
    createdAt,
    readAt: null,
    dismissedAt: null,
    updatedAt: createdAt,
  });
  return true;
}

export async function processContentCaptureRemindersOnFunctions(
  now = new Date(),
): Promise<{ brandsChecked: number; remindersSent: number; skipped: number }> {
  const brandsSnap = await db().collection(COLLECTIONS.contentBrands).get();
  const nowMs = now.getTime();
  let brandsChecked = 0;
  let remindersSent = 0;
  let skipped = 0;

  const capturesByOrg = new Map<string, CaptureTimestamp[]>();
  const timezoneByOrg = new Map<string, string>();

  async function timezoneForOrg(organizationId: string) {
    const cached = timezoneByOrg.get(organizationId);
    if (cached) return cached;
    const tz = await orgTimezone(organizationId);
    timezoneByOrg.set(organizationId, tz);
    return tz;
  }

  async function capturesForOrg(organizationId: string) {
    const cached = capturesByOrg.get(organizationId);
    if (cached) return cached;
    const snap = await db()
      .collection(COLLECTIONS.contentCaptures)
      .where("organizationId", "==", organizationId)
      .get();
    const list: CaptureTimestamp[] = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        brandId: str(data.brandId) || undefined,
        createdAt: mapIsoField(data.createdAt) || new Date(0).toISOString(),
        status: str(data.status, "draft"),
      };
    });
    capturesByOrg.set(organizationId, list);
    return list;
  }

  for (const doc of brandsSnap.docs) {
    const brand = mapBrand(doc.id, doc.data() as Record<string, unknown>);
    brandsChecked += 1;
    if (!brand.active || !brand.organizationId) {
      skipped += 1;
      continue;
    }
    const policy = brandCapturePolicy(brand);
    if (!policy.remindersEnabled) {
      skipped += 1;
      continue;
    }

    const timeZone = await timezoneForOrg(brand.organizationId);
    const parts = getZonedParts(now, timeZone);
    if (parts.hour !== CAPTURE_REMINDER_LOCAL_HOUR) {
      skipped += 1;
      continue;
    }
    const today = zonedDayKey(now, timeZone);
    const capturerId = resolveCapturer(brand);
    if (!capturerId) {
      skipped += 1;
      continue;
    }

    const captures = await capturesForOrg(brand.organizationId);
    if (!shouldRemindCapturer(brand, captures, nowMs)) {
      skipped += 1;
      continue;
    }

    const weekCount = capturesForBrandInWindow(captures, brand.id, nowMs).length;
    const latestMs = latestCaptureAtMs(captures, brand.id);
    const daysSinceLast = latestMs > 0 ? Math.floor((nowMs - latestMs) / MS_DAY) : null;
    const behindCadence = isBehindCaptureCadence(brand, captures, nowMs);
    const idle = isBrandCaptureIdle(brand, captures, nowMs);

    const created = await createUserNotification({
      id: `un-capture-${brand.id}-${today}`,
      organizationId: brand.organizationId,
      recipientId: capturerId,
      actorId: "system",
      message: captureReminderMessage({
        brandName: brand.name,
        weekCount,
        target: policy.capturesPerWeek,
        idle,
        behindCadence,
        idleDays: policy.idleDays,
        daysSinceLast,
      }),
      target: brand.name,
    });
    if (created) remindersSent += 1;
    else skipped += 1;
  }

  return { brandsChecked, remindersSent, skipped };
}
