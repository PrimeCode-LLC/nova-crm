/**
 * Minimal open/click tracking for Cloud Functions scheduled sends.
 * Mirrors App Hosting `mail-tracking-inject` + `prepareTrackedHtml` (single-recipient).
 */
import { createHmac, randomBytes, randomUUID } from "crypto";
import { getFirestore } from "firebase-admin/firestore";

type TrackingLink = { id: string; url: string };

const HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;
const TRACKED_PATH_RE = /\/api\/t\/[oc]\//i;
const DEFAULT_TTL_SECONDS = 180 * 24 * 60 * 60;

function trackingSecret(): Buffer | null {
  const raw =
    process.env.MAIL_TRACKING_SECRET?.trim() ||
    process.env.EMAIL_SECRETS_KEY_BASE64?.trim() ||
    "";
  if (!raw) return null;
  try {
    const fromB64 = Buffer.from(raw, "base64");
    if (fromB64.length >= 16) return fromB64;
  } catch {
    /* fall through */
  }
  return Buffer.from(raw, "utf8");
}

function trackingBaseUrl(): string {
  return (
    process.env.MAIL_TRACKING_BASE_URL?.replace(/\/$/, "").trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "").trim() ||
    process.env.SITE_URL?.replace(/\/$/, "").trim() ||
    "https://nova.stellixsoft.com"
  );
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signToken(input: {
  t: "o" | "c";
  id: string;
  l?: string;
  r?: string;
}): string | null {
  const secret = trackingSecret();
  if (!secret) return null;
  const payload = {
    v: 1 as const,
    t: input.t,
    id: input.id,
    ...(input.l ? { l: input.l } : {}),
    ...(input.r ? { r: input.r } : {}),
    exp: Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

function shouldRewriteHref(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("#") || value.startsWith("mailto:") || value.startsWith("tel:")) {
    return false;
  }
  if (TRACKED_PATH_RE.test(value)) return false;
  if (/^javascript:/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function injectMailTracking(input: {
  html: string;
  trackingId: string;
  trackOpens: boolean;
  trackClicks: boolean;
}): { html: string; links: TrackingLink[] } {
  let html = input.html;
  const links: TrackingLink[] = [];
  const base = trackingBaseUrl();

  if (input.trackClicks && html.trim()) {
    html = html.replace(HREF_RE, (full, quote: string, href: string) => {
      if (!shouldRewriteHref(href)) return full;
      const link = { id: randomBytes(6).toString("hex"), url: href.trim() };
      links.push(link);
      const token = signToken({ t: "c", id: input.trackingId, l: link.id });
      if (!token) return full;
      return `href=${quote}${base}/api/t/c/${encodeURIComponent(token)}${quote}`;
    });
  }

  if (input.trackOpens && html.trim()) {
    const token = signToken({ t: "o", id: input.trackingId });
    if (token) {
      const pixel = `<img src="${base}/api/t/o/${encodeURIComponent(token)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${pixel}</body>`);
      } else {
        html = `${html}${pixel}`;
      }
    }
  }

  return { html, links };
}

export async function prepareTrackedHtmlForFunctions(input: {
  html: string;
  organizationId: string;
  mailboxId: string;
  mailboxOwnerUid: string;
  messageId: string;
  trackOpens: boolean;
  trackClicks: boolean;
  leadId?: string;
  followupId?: string;
  scheduledEmailId?: string;
}): Promise<{ html: string; trackingId?: string }> {
  const html = input.html?.trim() ? input.html : "";
  if (!html || (!input.trackOpens && !input.trackClicks) || !trackingSecret()) {
    return { html: input.html };
  }

  const trackingId = randomUUID();
  const prepared = injectMailTracking({
    html,
    trackingId,
    trackOpens: input.trackOpens,
    trackClicks: input.trackClicks,
  });

  const now = new Date().toISOString();
  try {
    await getFirestore()
      .collection("mailTrackingMessages")
      .doc(trackingId)
      .set({
        organizationId: input.organizationId,
        messageId: input.messageId,
        mailboxId: input.mailboxId,
        mailboxOwnerUid: input.mailboxOwnerUid,
        ...(input.leadId ? { leadId: input.leadId } : {}),
        ...(input.followupId ? { followupId: input.followupId } : {}),
        ...(input.scheduledEmailId ? { scheduledEmailId: input.scheduledEmailId } : {}),
        trackOpens: input.trackOpens,
        trackClicks: input.trackClicks,
        links: prepared.links,
        openCount: 0,
        clickCount: 0,
        createdAt: now,
        updatedAt: now,
      });
  } catch {
    return { html: input.html };
  }

  return { html: prepared.html, trackingId };
}
