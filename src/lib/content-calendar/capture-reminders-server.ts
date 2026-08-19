import { getAdminDb } from "@/lib/db/document-access/admin";
import { COLLECTIONS } from "@/lib/documents/collections";
import { mapContentBrand, mapContentCapture } from "@/lib/content-calendar/map-docs";
import {
  brandCapturePolicy,
  captureReminderMessage,
  getCaptureProgress,
  shouldRemindCapturer,
  type CaptureTimestamp,
} from "@/lib/content-calendar/capture-policy";
import { resolveBrandResponsibility } from "@/lib/content-calendar/types";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";
import { getZonedParts, zonedDayKey } from "@/lib/org-timezone";
import { getOrgTimezoneServer } from "@/lib/org-timezone-server";

/** Local hour (0–23) when capture reminders fire in each org's timezone. */
const CAPTURE_REMINDER_LOCAL_HOUR = 9;

/**
 * Daily job (invoked hourly): notify brand capturers who are idle or behind
 * capture cadence when it is ~9:00 in the organization timezone.
 */
export async function processContentCaptureRemindersServer(now = new Date()): Promise<{
  brandsChecked: number;
  remindersSent: number;
  skipped: number;
}> {
  const db = getAdminDb();
  if (!db) {
    return { brandsChecked: 0, remindersSent: 0, skipped: 0 };
  }

  const brandsSnap = await db.collection(COLLECTIONS.contentBrands).get();
  const nowMs = now.getTime();
  let brandsChecked = 0;
  let remindersSent = 0;
  let skipped = 0;

  const capturesByOrg = new Map<string, CaptureTimestamp[]>();
  const timezoneByOrg = new Map<string, string>();

  async function timezoneForOrg(organizationId: string) {
    const cached = timezoneByOrg.get(organizationId);
    if (cached) return cached;
    const tz = await getOrgTimezoneServer(organizationId);
    timezoneByOrg.set(organizationId, tz);
    return tz;
  }

  async function capturesForOrg(organizationId: string) {
    const cached = capturesByOrg.get(organizationId);
    if (cached) return cached;
    const snap = await db!
      .collection(COLLECTIONS.contentCaptures)
      .where("organizationId", "==", organizationId)
      .get();
    const list: CaptureTimestamp[] = snap.docs.map((d) => {
      const c = mapContentCapture(d.id, d.data() as Record<string, unknown>);
      return { brandId: c.brandId, createdAt: c.createdAt, status: c.status };
    });
    capturesByOrg.set(organizationId, list);
    return list;
  }

  for (const doc of brandsSnap.docs) {
    const brand = mapContentBrand(doc.id, doc.data() as Record<string, unknown>);
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

    const capturerId = resolveBrandResponsibility(brand, "capturer");
    if (!capturerId) {
      skipped += 1;
      continue;
    }

    const captures = await capturesForOrg(brand.organizationId);
    if (!shouldRemindCapturer({ brand, captures, nowMs })) {
      skipped += 1;
      continue;
    }

    const progress = getCaptureProgress({
      brand,
      captures,
      currentUserId: capturerId,
      nowMs,
    });

    const id = `un-capture-${brand.id}-${today}`;
    const created = await createUserNotificationServer({
      organizationId: brand.organizationId,
      recipientId: capturerId,
      actorId: "system",
      kind: "idle",
      message: captureReminderMessage({
        brandName: brand.name,
        progress,
      }),
      target: brand.name,
      targetHref: "/content/capture",
      id,
    });
    if (created) remindersSent += 1;
    else skipped += 1;
  }

  return { brandsChecked, remindersSent, skipped };
}
