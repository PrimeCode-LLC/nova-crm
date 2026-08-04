import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { injectMailTracking } from "@/lib/email/mail-tracking-inject";
import { mailTrackingAvailable } from "@/lib/email/mail-tracking-token";
import type {
  MailTrackingContext,
  MailTrackingLink,
  MailTrackingSummary,
} from "@/lib/email/mail-tracking-types";
import { normalizeMessageId } from "@/lib/email/thread-inbound";

const SCANNER_UA =
  /googleimageproxy|yahoo! slurp|barracuda|proofpoint|mimecast|messagelabs|fireeye|symantec|trendmicro|spamassassin|mailscanner|security.?scanner|url.?defense|safelinks|microsoft office|outlook-ios|bot\b|crawler|spider|preview/i;

export function isLikelyMailScannerUserAgent(ua: string | null | undefined): boolean {
  const value = ua?.trim() ?? "";
  if (!value) return false;
  return SCANNER_UA.test(value);
}

export async function prepareTrackedHtml(input: {
  html: string | undefined;
  organizationId: string;
  mailboxId: string;
  mailboxOwnerUid: string;
  messageId: string | undefined;
  tracking?: MailTrackingContext;
}): Promise<{ html: string | undefined; trackingId?: string }> {
  const html = input.html?.trim() ? input.html : undefined;
  const trackOpens = Boolean(input.tracking?.trackOpens);
  const trackClicks = Boolean(input.tracking?.trackClicks);
  if (!html || (!trackOpens && !trackClicks) || !mailTrackingAvailable()) {
    return { html };
  }

  const messageId = normalizeMessageId(input.messageId);
  if (!messageId) return { html };

  const db = getAdminDb();
  if (!db) return { html };

  const trackingId = randomUUID();
  const prepared = injectMailTracking({
    html,
    trackingId,
    trackOpens,
    trackClicks,
  });

  const now = new Date().toISOString();
  try {
    await db.collection(COLLECTIONS.mailTrackingMessages).doc(trackingId).set({
      organizationId: input.organizationId,
      messageId,
      mailboxId: input.mailboxId,
      mailboxOwnerUid: input.mailboxOwnerUid,
      ...(input.tracking?.leadId?.trim()
        ? { leadId: input.tracking.leadId.trim() }
        : {}),
      ...(input.tracking?.followupId?.trim()
        ? { followupId: input.tracking.followupId.trim() }
        : {}),
      ...(input.tracking?.scheduledEmailId?.trim()
        ? { scheduledEmailId: input.tracking.scheduledEmailId.trim() }
        : {}),
      trackOpens,
      trackClicks,
      links: prepared.links,
      openCount: 0,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return { html };
  }

  return { html: prepared.html, trackingId };
}

export async function recordMailTrackingOpen(input: {
  trackingId: string;
  userAgent?: string | null;
}): Promise<{ ok: true } | { ok: false }> {
  if (isLikelyMailScannerUserAgent(input.userAgent)) {
    return { ok: true };
  }
  const db = getAdminDb();
  if (!db) return { ok: false };
  const ref = db.collection(COLLECTIONS.mailTrackingMessages).doc(input.trackingId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (!data.trackOpens) return;
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        openCount: FieldValue.increment(1),
        lastOpenedAt: now,
        updatedAt: now,
      };
      if (!data.firstOpenedAt) patch.firstOpenedAt = now;
      tx.update(ref, patch);
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function resolveMailTrackingClick(input: {
  trackingId: string;
  linkId: string;
  userAgent?: string | null;
}): Promise<{ ok: true; url: string } | { ok: false; reason: "not_found" | "error" }> {
  const db = getAdminDb();
  if (!db) return { ok: false, reason: "error" };
  const ref = db.collection(COLLECTIONS.mailTrackingMessages).doc(input.trackingId);
  try {
    let destination: string | null = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (!data.trackClicks) return;
      const links = Array.isArray(data.links) ? (data.links as MailTrackingLink[]) : [];
      const link = links.find((l) => l && l.id === input.linkId && typeof l.url === "string");
      if (!link?.url) return;
      try {
        const parsed = new URL(link.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
      } catch {
        return;
      }
      destination = link.url;
      if (isLikelyMailScannerUserAgent(input.userAgent)) return;
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        clickCount: FieldValue.increment(1),
        lastClickedAt: now,
        updatedAt: now,
      };
      if (!data.firstClickedAt) patch.firstClickedAt = now;
      tx.update(ref, patch);
    });
    if (!destination) return { ok: false, reason: "not_found" };
    return { ok: true, url: destination };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function toSummary(
  messageId: string,
  data: Record<string, unknown>,
): MailTrackingSummary {
  const openCount = Number(data.openCount ?? 0) || 0;
  const clickCount = Number(data.clickCount ?? 0) || 0;
  return {
    messageId,
    trackOpens: Boolean(data.trackOpens),
    trackClicks: Boolean(data.trackClicks),
    openCount,
    clickCount,
    opened: Boolean(data.firstOpenedAt) || openCount > 0,
    clicked: Boolean(data.firstClickedAt) || clickCount > 0,
    ...(typeof data.firstOpenedAt === "string" ? { firstOpenedAt: data.firstOpenedAt } : {}),
    ...(typeof data.firstClickedAt === "string" ? { firstClickedAt: data.firstClickedAt } : {}),
  };
}

/** Lookup engagement summaries by RFC Message-ID (normalized). */
export async function listMailTrackingByMessageIds(input: {
  organizationId: string;
  messageIds: string[];
}): Promise<Record<string, MailTrackingSummary>> {
  const ids = [
    ...new Set(
      input.messageIds
        .map((id) => normalizeMessageId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  ].slice(0, 100);
  if (ids.length === 0) return {};

  const db = getAdminDb();
  if (!db) return {};

  const out: Record<string, MailTrackingSummary> = {};
  // Firestore `in` supports max 30 values.
  for (let i = 0; i < ids.length; i += 30) {
    const chunk = ids.slice(i, i + 30);
    const snap = await db
      .collection(COLLECTIONS.mailTrackingMessages)
      .where("organizationId", "==", input.organizationId)
      .where("messageId", "in", chunk)
      .get();
    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      const messageId = normalizeMessageId(String(data.messageId ?? ""));
      if (!messageId) continue;
      const summary = toSummary(messageId, data);
      const prev = out[messageId];
      if (!prev || summary.openCount + summary.clickCount >= prev.openCount + prev.clickCount) {
        out[messageId] = summary;
      }
    }
  }
  return out;
}

/** Transparent 1×1 GIF. */
export const TRACKING_PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
