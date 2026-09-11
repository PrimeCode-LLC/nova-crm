/**
 * Signed unsubscribe tokens (List-Unsubscribe / one-click).
 * Reuses MAIL_TRACKING_SECRET signing material.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getMailTrackingBaseUrl } from "@/lib/email/mail-tracking-token";

export type UnsubscribeTokenPayload = {
  v: 1;
  t: "u";
  organizationId: string;
  email: string;
  leadId?: string;
  exp: number;
};

const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60;

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

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

export function signUnsubscribeToken(
  input: {
    organizationId: string;
    email: string;
    leadId?: string;
    exp?: number;
  },
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  const secret = trackingSecret();
  if (!secret) return null;
  const payload: UnsubscribeTokenPayload = {
    v: 1,
    t: "u",
    organizationId: input.organizationId.trim(),
    email: input.email.trim().toLowerCase(),
    ...(input.leadId?.trim() ? { leadId: input.leadId.trim() } : {}),
    exp: input.exp ?? nowSec + DEFAULT_TTL_SECONDS,
  };
  if (!payload.organizationId || !payload.email.includes("@")) return null;
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): UnsubscribeTokenPayload | null {
  const secret = trackingSecret();
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = fromB64url(sig);
  if (!actual || actual.length !== expected.length) return null;
  if (!timingSafeEqual(actual, expected)) return null;
  const raw = fromB64url(body);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1 || obj.t !== "u") return null;
  if (typeof obj.organizationId !== "string" || !obj.organizationId.trim()) return null;
  if (typeof obj.email !== "string" || !obj.email.includes("@")) return null;
  if (typeof obj.exp !== "number" || !Number.isFinite(obj.exp) || obj.exp < nowSec) {
    return null;
  }
  return {
    v: 1,
    t: "u",
    organizationId: obj.organizationId.trim(),
    email: obj.email.trim().toLowerCase(),
    ...(typeof obj.leadId === "string" && obj.leadId.trim()
      ? { leadId: obj.leadId.trim() }
      : {}),
    exp: obj.exp,
  };
}

export function unsubscribeUrl(token: string): string {
  return `${getMailTrackingBaseUrl()}/api/u/${encodeURIComponent(token)}`;
}
