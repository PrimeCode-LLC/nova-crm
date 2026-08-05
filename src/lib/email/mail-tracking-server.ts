import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { randomBytes, randomUUID } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firestore/collections";
import { resolveOwnerManagerIdsAdmin } from "@/lib/firestore/resolve-owner-manager-ids-admin";
import { stampForCreate } from "@/lib/firestore/tenant-write";
import { stripUndefined } from "@/lib/firestore/strip-undefined";
import { injectMailTracking } from "@/lib/email/mail-tracking-inject";
import { mailTrackingAvailable } from "@/lib/email/mail-tracking-token";
import type {
  MailTrackingContext,
  MailTrackingLink,
  MailTrackingRecipientEngagement,
  MailTrackingRecipientInput,
  MailTrackingRecipientRole,
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

export function collectOutboundTrackingRecipients(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
}): MailTrackingRecipientInput[] {
  const seen = new Set<string>();
  const out: MailTrackingRecipientInput[] = [];
  const add = (emails: string[] | undefined, role: MailTrackingRecipientRole) => {
    for (const raw of emails ?? []) {
      const email = raw.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, role });
    }
  };
  add(input.to, "to");
  add(input.cc, "cc");
  add(input.bcc, "bcc");
  return out;
}

function newRecipientTrackingId(): string {
  return randomBytes(4).toString("hex");
}

export async function prepareTrackedHtml(input: {
  html: string | undefined;
  organizationId: string;
  mailboxId: string;
  mailboxOwnerUid: string;
  messageId: string | undefined;
  tracking?: MailTrackingContext;
  recipients?: MailTrackingRecipientInput[];
}): Promise<{
  html: string | undefined;
  htmlByRecipient?: Record<string, string>;
  trackingId?: string;
}> {
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

  const recipients: MailTrackingRecipientEngagement[] = [];
  const seenEmails = new Set<string>();
  for (const row of input.recipients ?? []) {
    const email = row.email.trim().toLowerCase();
    if (!email || seenEmails.has(email)) continue;
    seenEmails.add(email);
    recipients.push({
      id: newRecipientTrackingId(),
      email,
      role: row.role === "cc" || row.role === "bcc" ? row.role : "to",
      openCount: 0,
      clickCount: 0,
    });
  }

  const htmlByRecipient: Record<string, string> = {};
  for (const recipient of recipients) {
    htmlByRecipient[recipient.email] = injectMailTracking({
      html,
      trackingId,
      trackOpens,
      trackClicks,
      recipientId: recipient.id,
      links: prepared.links,
    }).html;
  }

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
      ...(recipients.length > 0 ? { recipients } : {}),
      openCount: 0,
      clickCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  } catch {
    return { html };
  }

  const firstPersonalized = recipients[0] ? htmlByRecipient[recipients[0].email] : undefined;
  return {
    html: firstPersonalized || prepared.html,
    ...(Object.keys(htmlByRecipient).length > 0 ? { htmlByRecipient } : {}),
    trackingId,
  };
}

type OpenSideEffect = {
  organizationId: string;
  leadId: string;
  messageId?: string;
  mailboxId?: string;
  recipientEmail?: string;
  now: string;
  stampLead: boolean;
  writeTimeline: boolean;
};

/** Best-effort lead denorm + timeline for tracked opens. */
async function stampLeadEmailOpened(
  db: Firestore,
  meta: OpenSideEffect,
  trackingId: string,
): Promise<void> {
  const leadRef = db.collection(COLLECTIONS.leads).doc(meta.leadId);
  const leadSnap = await leadRef.get();
  if (!leadSnap.exists) return;
  const leadData = leadSnap.data() as Record<string, unknown>;
  if (String(leadData.organizationId ?? "") !== meta.organizationId) return;

  const rawOwner = leadData.ownerId;
  const leadOwnerId =
    (typeof rawOwner === "string" && rawOwner.trim()) || "system";
  const actorId = leadOwnerId;
  const leadOwnerManagerIds = await resolveOwnerManagerIdsAdmin(db, leadOwnerId);

  if (meta.stampLead) {
    await leadRef.set(
      {
        lastEmailOpenedAt: meta.now,
        emailOpenCount: FieldValue.increment(1),
        lastActivityAt: meta.now,
        updatedAt: meta.now,
      },
      { merge: true },
    );
  }

  if (!meta.writeTimeline) return;

  const teId = `te-${randomUUID()}`;
  await db.collection(COLLECTIONS.timelineEvents).doc(teId).set(
    stampForCreate(
      meta.organizationId,
      stripUndefined({
        leadId: meta.leadId,
        leadOwnerId,
        leadOwnerManagerIds,
        type: "email_opened",
        actorId,
        summary: meta.recipientEmail
          ? `Email opened by ${meta.recipientEmail}`
          : "Email opened",
        payload: {
          trackingId,
          ...(meta.messageId ? { messageId: meta.messageId } : {}),
          ...(meta.mailboxId ? { mailboxId: meta.mailboxId } : {}),
          ...(meta.recipientEmail ? { recipientEmail: meta.recipientEmail } : {}),
        },
        createdAt: meta.now,
      }),
      actorId,
    ),
  );
}

function parseRecipientEngagement(raw: unknown): MailTrackingRecipientEngagement[] {
  if (!Array.isArray(raw)) return [];
  const out: MailTrackingRecipientEngagement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    if (!id || !email) continue;
    const role: MailTrackingRecipientRole =
      row.role === "cc" || row.role === "bcc" ? row.role : "to";
    out.push({
      id,
      email,
      role,
      openCount: Number(row.openCount ?? 0) || 0,
      clickCount: Number(row.clickCount ?? 0) || 0,
      ...(typeof row.firstOpenedAt === "string" ? { firstOpenedAt: row.firstOpenedAt } : {}),
      ...(typeof row.lastOpenedAt === "string" ? { lastOpenedAt: row.lastOpenedAt } : {}),
      ...(typeof row.firstClickedAt === "string" ? { firstClickedAt: row.firstClickedAt } : {}),
      ...(typeof row.lastClickedAt === "string" ? { lastClickedAt: row.lastClickedAt } : {}),
    });
  }
  return out;
}

export async function recordMailTrackingOpen(input: {
  trackingId: string;
  userAgent?: string | null;
  recipientId?: string | null;
}): Promise<{ ok: true } | { ok: false }> {
  if (isLikelyMailScannerUserAgent(input.userAgent)) {
    return { ok: true };
  }
  const db = getAdminDb();
  if (!db) return { ok: false };
  const ref = db.collection(COLLECTIONS.mailTrackingMessages).doc(input.trackingId);
  let sideEffect: OpenSideEffect | null = null;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() as Record<string, unknown>;
      if (!data.trackOpens) return;
      const now = new Date().toISOString();
      const isFirstOpen = !data.firstOpenedAt;
      const recipients = parseRecipientEngagement(data.recipients);
      const recipientId = input.recipientId?.trim() || "";
      let recipientEmail: string | undefined;
      let isRecipientFirstOpen = false;
      if (recipientId && recipients.length > 0) {
        const idx = recipients.findIndex((row) => row.id === recipientId);
        if (idx >= 0) {
          const prev = recipients[idx]!;
          recipientEmail = prev.email;
          isRecipientFirstOpen = !prev.firstOpenedAt;
          recipients[idx] = {
            ...prev,
            openCount: prev.openCount + 1,
            lastOpenedAt: now,
            ...(isRecipientFirstOpen ? { firstOpenedAt: now } : {}),
          };
        }
      }
      const patch: Record<string, unknown> = {
        openCount: FieldValue.increment(1),
        lastOpenedAt: now,
        updatedAt: now,
        ...(recipients.length > 0 ? { recipients } : {}),
      };
      if (isFirstOpen) patch.firstOpenedAt = now;
      tx.update(ref, patch);

      if (isFirstOpen || isRecipientFirstOpen) {
        const leadId =
          typeof data.leadId === "string" ? data.leadId.trim() : "";
        const organizationId =
          typeof data.organizationId === "string" ? data.organizationId.trim() : "";
        if (leadId && organizationId) {
          sideEffect = {
            organizationId,
            leadId,
            ...(typeof data.messageId === "string" && data.messageId
              ? { messageId: data.messageId }
              : {}),
            ...(typeof data.mailboxId === "string" && data.mailboxId
              ? { mailboxId: data.mailboxId }
              : {}),
            ...(recipientEmail ? { recipientEmail } : {}),
            now,
            stampLead: isFirstOpen,
            writeTimeline: true,
          };
        }
      }
    });
  } catch {
    return { ok: false };
  }

  // Lead denorm + timeline must not break the tracking pixel response.
  if (sideEffect) {
    try {
      await stampLeadEmailOpened(db, sideEffect, input.trackingId);
    } catch {
      /* best-effort */
    }
  }
  return { ok: true };
}

export async function resolveMailTrackingClick(input: {
  trackingId: string;
  linkId: string;
  userAgent?: string | null;
  recipientId?: string | null;
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
      const recipients = parseRecipientEngagement(data.recipients);
      const recipientId = input.recipientId?.trim() || "";
      if (recipientId && recipients.length > 0) {
        const idx = recipients.findIndex((row) => row.id === recipientId);
        if (idx >= 0) {
          const prev = recipients[idx]!;
          recipients[idx] = {
            ...prev,
            clickCount: prev.clickCount + 1,
            lastClickedAt: now,
            ...(!prev.firstClickedAt ? { firstClickedAt: now } : {}),
          };
        }
      }
      const patch: Record<string, unknown> = {
        clickCount: FieldValue.increment(1),
        lastClickedAt: now,
        updatedAt: now,
        ...(recipients.length > 0 ? { recipients } : {}),
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
  const recipients = parseRecipientEngagement(data.recipients);
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
    ...(recipients.length > 0 ? { recipients } : {}),
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
