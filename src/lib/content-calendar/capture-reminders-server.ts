import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { mapContentBrand, mapContentCapture } from "@/lib/content-calendar/map-docs";
import {
  brandCapturePolicy,
  captureReminderMessage,
  getCaptureProgress,
  shouldRemindCapturer,
} from "@/lib/content-calendar/capture-policy";
import { resolveBrandResponsibility } from "@/lib/content-calendar/types";
import { createUserNotificationServer } from "@/lib/notifications/create-user-notification-server";

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Daily job: notify brand capturers who are idle or behind capture cadence
 * when the brand has reminders enabled.
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
  const today = dayKey(now);
  let brandsChecked = 0;
  let remindersSent = 0;
  let skipped = 0;

  const capturesByOrg = new Map<
    string,
    { brandId?: string; createdAt: string; status?: string }[]
  >();

  async function capturesForOrg(organizationId: string) {
    const cached = capturesByOrg.get(organizationId);
    if (cached) return cached;
    const snap = await db!
      .collection(COLLECTIONS.contentCaptures)
      .where("organizationId", "==", organizationId)
      .get();
    const list = snap.docs.map((d) => {
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
