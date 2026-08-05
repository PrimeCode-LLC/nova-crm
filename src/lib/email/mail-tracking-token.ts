import { createHmac, timingSafeEqual } from "node:crypto";
import { SITE } from "@/lib/site";

export type MailTrackingTokenPayload = {
  v: 1;
  t: "o" | "c";
  id: string;
  /** Link id when t === "c" */
  l?: string;
  /** Recipient tracking id when the send was personalized */
  r?: string;
  /** Unix seconds expiry */
  exp: number;
};

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

export function getMailTrackingBaseUrl(): string {
  const explicit =
    process.env.MAIL_TRACKING_BASE_URL?.replace(/\/$/, "").trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "").trim() ||
    process.env.SITE_URL?.replace(/\/$/, "").trim();
  if (explicit) return explicit;
  return SITE.url;
}

export function mailTrackingAvailable(): boolean {
  return Boolean(trackingSecret());
}

export function signMailTrackingToken(
  input: Omit<MailTrackingTokenPayload, "v" | "exp"> & { exp?: number },
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  const secret = trackingSecret();
  if (!secret) return null;
  const payload: MailTrackingTokenPayload = {
    v: 1,
    t: input.t,
    id: input.id,
    ...(input.l ? { l: input.l } : {}),
    ...(input.r ? { r: input.r } : {}),
    exp: input.exp ?? nowSec + DEFAULT_TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyMailTrackingToken(
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): MailTrackingTokenPayload | null {
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
  if (obj.v !== 1) return null;
  if (obj.t !== "o" && obj.t !== "c") return null;
  if (typeof obj.id !== "string" || !obj.id.trim()) return null;
  if (typeof obj.exp !== "number" || !Number.isFinite(obj.exp)) return null;
  if (obj.exp < nowSec) return null;
  if (obj.t === "c" && (typeof obj.l !== "string" || !obj.l.trim())) return null;
  if (obj.r !== undefined && (typeof obj.r !== "string" || !obj.r.trim())) return null;
  return {
    v: 1,
    t: obj.t,
    id: obj.id.trim(),
    ...(typeof obj.l === "string" && obj.l.trim() ? { l: obj.l.trim() } : {}),
    ...(typeof obj.r === "string" && obj.r.trim() ? { r: obj.r.trim() } : {}),
    exp: obj.exp,
  };
}

export function openTrackingUrl(token: string): string {
  return `${getMailTrackingBaseUrl()}/api/t/o/${encodeURIComponent(token)}`;
}

export function clickTrackingUrl(token: string): string {
  return `${getMailTrackingBaseUrl()}/api/t/c/${encodeURIComponent(token)}`;
}
