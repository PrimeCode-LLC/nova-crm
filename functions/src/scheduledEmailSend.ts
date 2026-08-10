/**
 * Phase 1.3 — Due scheduled outbound email send runs on Cloud Functions
 * (Gen2 / Cloud Run), not App Hosting, so SMTP + send-gap work cannot hang
 * interactive instances.
 *
 * CRM side effects that need the full Next stack (timeline, lead-mail,
 * reply-intel) run on App Hosting via `/api/cron/scheduled-emails/postprocess`.
 *
 * Always requeues send gaps (never sleeps) so one tick cannot serialize 50×25s waits.
 */
import crypto from "crypto";
import { FieldValue, getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MailComposer = require("nodemailer/lib/mail-composer");
import { prepareTrackedHtmlForFunctions } from "./mailTracking";

const SCHEDULED_COLLECTION = "scheduledEmails";
const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const SCHEDULED_SEND_MAX_ATTEMPTS = 3;
const DEFAULT_SEND_GAP_SECONDS = 15;
const SEND_GAP_SECONDS_MAX = 120;
const DUE_LIMIT = 50;

type EncryptedBlob = { iv: string; tag: string; value: string };

export type ScheduledEmailSendResult = {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  sentItems: Array<{
    organizationId: string;
    uid: string;
    mailboxId: string;
    scheduledEmailId: string;
    leadId?: string;
    followupId?: string;
    scheduledByUserId?: string;
    messageId?: string;
    subject: string;
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    text: string;
    html: string;
    inReplyTo?: string;
    referenceIds?: string[];
    sentAt: string;
  }>;
};

function db() {
  return getFirestore();
}

function normalizeMailHost(raw: string): string {
  let h = raw.trim();
  if (!h) return "";
  h = h.replace(/^https?:\/\//i, "");
  h = h.split("/")[0] ?? "";
  h = h.split("?")[0] ?? "";
  h = h.split("#")[0] ?? "";
  h = h.trim().replace(/\.+$/, "");
  const at = h.lastIndexOf("@");
  if (at !== -1) h = h.slice(at + 1).trim();
  return h.replace(/\.+$/, "").trim();
}

function normalizeMessageId(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const inner = s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1).trim() : s;
  return inner || undefined;
}

function isEncryptedBlob(raw: unknown): raw is EncryptedBlob {
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as EncryptedBlob).iv === "string" &&
    typeof (raw as EncryptedBlob).tag === "string" &&
    typeof (raw as EncryptedBlob).value === "string"
  );
}

function getSecretsKey(): Buffer | null {
  const raw = process.env.EMAIL_SECRETS_KEY_BASE64?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function decryptValue(payload: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const value = Buffer.from(payload.value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
}

function encryptValue(value: string, key: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    value: encrypted.toString("base64"),
  };
}

function googleOAuthClientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId =
    process.env.GOOGLE_MAIL_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function refreshGoogleMailAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
} | null> {
  const creds = googleOAuthClientCreds();
  if (!creds || !refreshToken.trim()) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tokens = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!tokens.access_token) return null;
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString();
  return { accessToken: tokens.access_token, expiresAt };
}

function mailboxSecretsRef(orgId: string, uid: string, mailboxId: string) {
  return db()
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid)
    .collection("emailMailboxSecrets")
    .doc(mailboxId);
}

function mailboxRef(orgId: string, uid: string, mailboxId: string) {
  return db()
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid)
    .collection("emailMailboxes")
    .doc(mailboxId);
}

async function resolveSmtpAuth(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<{ user: string; pass: string; accessToken?: string } | null> {
  const key = getSecretsKey();
  if (!key) return null;
  const snap = await mailboxSecretsRef(input.organizationId, input.uid, input.mailboxId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;

  try {
    const smtpUser = isEncryptedBlob(data.smtpUser) ? decryptValue(data.smtpUser, key) : "";
    const smtpPass = isEncryptedBlob(data.smtpPassword)
      ? decryptValue(data.smtpPassword, key)
      : "";
    const imapUser = isEncryptedBlob(data.imapUser) ? decryptValue(data.imapUser, key) : "";
    const accountEmail =
      typeof data.googleAccountEmail === "string" ? data.googleAccountEmail.trim() : "";

    const refreshBlob = data.googleRefreshToken;
    const accessBlob = data.googleAccessToken;
    if (isEncryptedBlob(refreshBlob) || isEncryptedBlob(accessBlob)) {
      const refreshToken = isEncryptedBlob(refreshBlob) ? decryptValue(refreshBlob, key) : "";
      let accessToken = isEncryptedBlob(accessBlob) ? decryptValue(accessBlob, key) : "";
      const tokenExpiresAt = String(data.googleTokenExpiresAt ?? "");
      const user = accountEmail || smtpUser.trim() || imapUser.trim();
      if (user) {
        const expiresMs = tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0;
        const stillValid = Boolean(accessToken) && expiresMs > Date.now() + 60_000;
        if (!stillValid && refreshToken) {
          const refreshed = await refreshGoogleMailAccessToken(refreshToken);
          if (refreshed) {
            accessToken = refreshed.accessToken;
            await mailboxSecretsRef(input.organizationId, input.uid, input.mailboxId).set(
              {
                googleAccessToken: encryptValue(refreshed.accessToken, key),
                googleTokenExpiresAt: refreshed.expiresAt,
                updatedAt: new Date().toISOString(),
              },
              { merge: true },
            );
          }
        }
        if (accessToken) return { user, pass: "", accessToken };
      }
    }

    let user = smtpUser.trim() || imapUser.trim() || accountEmail;
    const pass = smtpPass;
    if (!user) {
      const profile = await mailboxRef(input.organizationId, input.uid, input.mailboxId).get();
      const emailAddress = String(profile.data()?.emailAddress ?? "").trim();
      if (emailAddress) user = emailAddress;
    }
    if (!user || !pass) return null;
    return { user, pass };
  } catch {
    return null;
  }
}

function dayKeyInZone(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function orgTimezone(organizationId: string): Promise<string> {
  const snap = await db().collection("organizations").doc(organizationId).get();
  const settings = (snap.data()?.settings ?? {}) as Record<string, unknown>;
  const tz = typeof settings.timezone === "string" ? settings.timezone.trim() : "";
  return tz || "UTC";
}

function normalizeSendGapSeconds(value: unknown): number {
  if (value == null || !Number.isFinite(Number(value))) return DEFAULT_SEND_GAP_SECONDS;
  const n = Math.floor(Number(value));
  if (n <= 0) return 0;
  return Math.min(SEND_GAP_SECONDS_MAX, n);
}

function classifyScheduledSendError(error: string): "transient" | "permanent" | "quota" {
  const msg = (error || "").trim();
  if (!msg) return "transient";
  if (/daily send limit/i.test(msg)) return "quota";
  if (
    /mailbox no longer exists|authentication failed|invalid login|user unknown|address rejected|550[-\s]|553[-\s]/i.test(
      msg,
    )
  ) {
    return "permanent";
  }
  if (
    /etimedout|econnreset|econnrefused|timeout|temporary|try again|rate.?limit|421[-\s]|450[-\s]|451[-\s]/i.test(
      msg,
    )
  ) {
    return "transient";
  }
  return "transient";
}

function nextRetryAtIso(attemptAfterFailure: number): string {
  const n = Math.max(1, Math.floor(attemptAfterFailure));
  const delay =
    n <= 1 ? 10 * 60_000 : n === 2 ? 60 * 60_000 : 6 * 60 * 60_000;
  return new Date(Date.now() + delay).toISOString();
}

function parseAttachments(
  raw: unknown,
): Array<{ filename: string; content: Buffer; contentType: string }> | { error: string } {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return { error: "attachments must be an array" };
  const out: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const filename = String(rec.filename ?? "attachment").trim() || "attachment";
    const contentBase64 = String(rec.contentBase64 ?? "").trim();
    if (!contentBase64) continue;
    let buf: Buffer;
    try {
      buf = Buffer.from(contentBase64, "base64");
    } catch {
      return { error: `Invalid attachment data for ${filename}` };
    }
    if (!buf.length) continue;
    if (buf.length > 10 * 1024 * 1024) {
      return { error: `${filename} exceeds the 10 MB per-file limit` };
    }
    const contentType = String(rec.mimeType ?? rec.contentType ?? "application/octet-stream").trim();
    out.push({
      filename,
      content: buf,
      contentType: contentType || "application/octet-stream",
    });
  }
  return out;
}

async function shouldStopFollowup(followupId: string): Promise<string | undefined> {
  try {
    const snap = await db().collection("followups").doc(followupId).get();
    if (!snap.exists) return "Follow-up no longer exists";
    const f = snap.data() as Record<string, unknown>;
    if (f.pausedAt != null) return "Follow-up paused";
    if (f.completedAt != null) return "Follow-up completed";
    const planId = typeof f.planId === "string" ? f.planId.trim() : "";
    if (!planId) return undefined;
    const planSnap = await db().collection("followupPlans").doc(planId).get();
    if (!planSnap.exists) return undefined;
    const status = String((planSnap.data() as Record<string, unknown>).status ?? "");
    if (status === "paused") return "Sequence paused";
    if (status === "superseded") return "Sequence superseded";
    if (status === "completed") return "Sequence completed";
    return undefined;
  } catch {
    return undefined;
  }
}

async function assertLeadContactAllowed(
  organizationId: string,
  leadId: string,
): Promise<{ ok: true } | { ok: false; cancelled: boolean; error: string }> {
  const snapshot = await db().collection("leads").doc(leadId).get();
  if (!snapshot.exists) return { ok: false, cancelled: false, error: "Lead not found." };
  const data = snapshot.data() as Record<string, unknown>;
  if (String(data.organizationId ?? "") !== organizationId) {
    return { ok: false, cancelled: false, error: "Lead not found." };
  }
  if (data.doNotContact === true) {
    return {
      ok: false,
      cancelled: true,
      error: "This lead is marked do not contact. Remove that restriction before sending email.",
    };
  }
  return { ok: true };
}

async function updateFollowupDelivery(
  followupId: string,
  input: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const ref = db().collection("followups").doc(followupId);
    const snap = await ref.get();
    if (!snap.exists) return undefined;
    const current = snap.data() as Record<string, unknown>;
    await ref.update({ ...input, updatedAt: new Date().toISOString() });
    return typeof current.planId === "string" ? current.planId.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

async function completePlanWhenAllStepsDone(planId: string, now: string): Promise<void> {
  try {
    const [steps, planSnap] = await Promise.all([
      db().collection("followups").where("planId", "==", planId).get(),
      db().collection("followupPlans").doc(planId).get(),
    ]);
    if (!planSnap.exists || steps.empty) return;
    const status = String(planSnap.data()?.status ?? "");
    if (status !== "active") return;
    const allDone = steps.docs.every((doc) => {
      const step = doc.data() as Record<string, unknown>;
      return step.completedAt != null || step.deliveryStatus === "sent";
    });
    if (allDone) {
      await planSnap.ref.update({ status: "completed", completedAt: now, updatedAt: now });
    }
  } catch {
    /* best-effort */
  }
}

async function claimScheduledDoc(
  docRef: DocumentReference,
): Promise<Record<string, unknown> | null> {
  const claimId = crypto.randomUUID();
  return db().runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data() as Record<string, unknown>;
    const status = String(data.status ?? "");
    const processingAt = new Date(String(data.processingAt ?? "")).getTime();
    const staleProcessing =
      status === "processing" &&
      (!Number.isFinite(processingAt) || Date.now() - processingAt >= PROCESSING_LEASE_MS);
    if (status !== "pending" && !staleProcessing) return null;
    const now = new Date().toISOString();
    transaction.update(docRef, {
      status: "processing",
      processingAt: now,
      processingClaimId: claimId,
      updatedAt: now,
    });
    return { ...data, status: "processing", processingAt: now, processingClaimId: claimId };
  });
}

function scoreSentPath(path: string): number {
  const p = path.toLowerCase().replace(/\s+/g, " ");
  if (p.includes("[gmail]/sent mail")) return 20;
  if (p === "sent" || p.endsWith("/sent") || p.endsWith(".sent")) return 14;
  if (p.includes("sent items")) return 13;
  if (p.includes("sent")) return 8;
  return 0;
}

async function resolveSentMailboxPath(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const ranked = [...boxes]
    .filter((b) => scoreSentPath(b.path) > 0)
    .sort((a, b) => scoreSentPath(b.path) - scoreSentPath(a.path));
  return ranked[0]?.path ?? null;
}

async function buildOutboundRawMail(input: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
}): Promise<Buffer> {
  const mailOptions = {
    from: input.from,
    to: input.to,
    cc: input.cc || undefined,
    bcc: input.bcc || undefined,
    subject: input.subject,
    text: input.text || undefined,
    html: input.html || undefined,
    replyTo: input.replyTo || undefined,
    messageId: input.messageId || undefined,
    inReplyTo: input.inReplyTo || undefined,
    references: input.references?.length ? input.references : undefined,
    date: new Date(),
    attachments:
      input.attachments.length > 0
        ? input.attachments.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          }))
        : undefined,
  };
  return new Promise((resolve, reject) => {
    const composer = new MailComposer(mailOptions);
    composer.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

async function appendToSentFolder(input: {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  rawMessage: Buffer;
}): Promise<void> {
  const host = normalizeMailHost(input.imapHost);
  if (!host || !input.user) return;
  const client = new ImapFlow({
    host,
    port: input.imapPort,
    secure: input.imapSecure,
    auth: input.accessToken
      ? { user: input.user, accessToken: input.accessToken }
      : { user: input.user, pass: input.pass },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 60_000,
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
    const sentPath = await resolveSentMailboxPath(client);
    if (!sentPath) return;
    await client.append(sentPath, input.rawMessage, ["\\Seen"], new Date());
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function sendSmtp(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  from: string;
  displayName?: string;
  replyTo?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  referenceIds?: string[];
  attachments: Array<{ filename: string; content: Buffer; contentType: string }>;
  trackOpens: boolean;
  trackClicks: boolean;
  leadId?: string;
  followupId?: string;
  scheduledEmailId: string;
  appendSentCopy: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
}): Promise<{ ok: true; messageId?: string; htmlSent: string } | { ok: false; error: string }> {
  const host = normalizeMailHost(input.host);
  if (!host || !input.user || !input.from.trim() || !input.to.trim()) {
    return { ok: false, error: "SMTP host, user, From, and To are required." };
  }
  if (!input.accessToken && !input.pass) {
    return { ok: false, error: "SMTP credentials missing." };
  }

  const displayName = input.displayName?.trim() ?? "";
  const fromHeader = displayName
    ? `"${displayName.replace(/"/g, "")}" <${input.from.trim()}>`
    : input.from.trim();
  const messageIdDomain =
    input.from.split("@")[1]?.replace(/[^A-Za-z0-9.-]/g, "") || "nova.local";
  const outboundMessageId = `<${crypto.randomUUID()}@${messageIdDomain}>`;
  const messageIdNormalized = normalizeMessageId(outboundMessageId) ?? outboundMessageId;
  const inReplyToNormalized = normalizeMessageId(input.inReplyTo);
  const inReplyTo = inReplyToNormalized ? `<${inReplyToNormalized}>` : undefined;
  const references = [
    ...(input.referenceIds ?? []),
    ...(inReplyToNormalized ? [inReplyToNormalized] : []),
  ]
    .map((v) => normalizeMessageId(v))
    .filter((v): v is string => Boolean(v))
    .filter((v, i, all) => all.indexOf(v) === i)
    .slice(-50)
    .map((v) => `<${v}>`);

  const tracked = await prepareTrackedHtmlForFunctions({
    html: input.html,
    organizationId: input.organizationId,
    mailboxId: input.mailboxId,
    mailboxOwnerUid: input.uid,
    messageId: messageIdNormalized,
    trackOpens: input.trackOpens,
    trackClicks: input.trackClicks,
    leadId: input.leadId,
    followupId: input.followupId,
    scheduledEmailId: input.scheduledEmailId,
  });
  const html = tracked.html || input.html;

  const transporter = nodemailer.createTransport({
    host,
    port: input.port,
    secure: input.secure,
    auth: input.accessToken
      ? { type: "OAuth2", user: input.user, accessToken: input.accessToken }
      : { user: input.user, pass: input.pass },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 25_000,
  });

  try {
    await transporter.sendMail({
      from: fromHeader,
      to: input.to,
      cc: input.cc || undefined,
      bcc: input.bcc || undefined,
      subject: input.subject.trim() || "(no subject)",
      text: input.text || undefined,
      html: html || undefined,
      replyTo: input.replyTo?.trim() || undefined,
      messageId: outboundMessageId,
      inReplyTo,
      references: references.length > 0 ? references : undefined,
      attachments:
        input.attachments.length > 0
          ? input.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
            }))
          : undefined,
    });

    if (input.appendSentCopy && input.imapHost) {
      try {
        const rawMessage = await buildOutboundRawMail({
          from: fromHeader,
          to: input.to,
          cc: input.cc,
          bcc: input.bcc,
          subject: input.subject.trim() || "(no subject)",
          text: input.text,
          html,
          replyTo: input.replyTo?.trim() || undefined,
          messageId: outboundMessageId,
          inReplyTo,
          references,
          attachments: input.attachments,
        });
        await appendToSentFolder({
          imapHost: input.imapHost,
          imapPort: input.imapPort ?? 993,
          imapSecure: input.imapSecure !== false,
          user: input.user,
          pass: input.pass,
          accessToken: input.accessToken,
          rawMessage,
        });
      } catch {
        /* Sent APPEND is best-effort after a successful SMTP send */
      }
    }

    return { ok: true, messageId: messageIdNormalized, htmlSent: html };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.slice(0, 500) || "SMTP send failed" };
  }
}

async function sendOne(
  docRef: DocumentReference,
  data: Record<string, unknown>,
  lastSentAtByMailbox: Map<string, number>,
): Promise<{
  outcome: "sent" | "failed" | "skipped";
  sentItem?: ScheduledEmailSendResult["sentItems"][number];
}> {
  const organizationId = String(data.organizationId ?? "");
  const uid = String(data.uid ?? "");
  const mailboxId = String(data.mailboxId ?? "");
  if (!organizationId || !uid || !mailboxId) return { outcome: "skipped" };

  const followupId =
    typeof data.followupId === "string" ? data.followupId.trim() : "";
  const leadId = typeof data.leadId === "string" ? data.leadId.trim() : "";

  if (followupId) {
    const stop = await shouldStopFollowup(followupId);
    if (stop) {
      const now = new Date().toISOString();
      await docRef.update({
        status: "cancelled",
        cancelledAt: now,
        cancelReason: stop,
        updatedAt: now,
        processingAt: FieldValue.delete(),
        processingClaimId: FieldValue.delete(),
      });
      await updateFollowupDelivery(followupId, {
        deliveryStatus: "cancelled",
        cancelledAt: now,
        cancelReason: stop,
        scheduledEmailId: FieldValue.delete(),
        emailScheduledAt: FieldValue.delete(),
      });
      return { outcome: "skipped" };
    }
  }

  if (leadId) {
    const policy = await assertLeadContactAllowed(organizationId, leadId);
    if (!policy.ok) {
      const now = new Date().toISOString();
      await docRef.update({
        status: policy.cancelled ? "cancelled" : "failed",
        error: policy.error,
        failureKind: "permanent",
        ...(policy.cancelled ? { cancelledAt: now, cancelReason: policy.error } : {}),
        updatedAt: now,
        processingAt: FieldValue.delete(),
        processingClaimId: FieldValue.delete(),
      });
      if (followupId) {
        await updateFollowupDelivery(followupId, {
          deliveryStatus: policy.cancelled ? "cancelled" : "failed",
          ...(policy.cancelled
            ? { cancelledAt: now, cancelReason: policy.error }
            : { failedAt: now, deliveryError: policy.error }),
          ...(policy.cancelled
            ? {
                scheduledEmailId: FieldValue.delete(),
                emailScheduledAt: FieldValue.delete(),
              }
            : {}),
        });
      }
      return { outcome: policy.cancelled ? "skipped" : "failed" };
    }
  }

  const mbSnap = await mailboxRef(organizationId, uid, mailboxId).get();
  if (!mbSnap.exists) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: "Mailbox no longer exists.",
      failureKind: "permanent",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupId) {
      await updateFollowupDelivery(followupId, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: "Mailbox no longer exists.",
      });
    }
    return { outcome: "failed" };
  }

  const mb = mbSnap.data() as Record<string, unknown>;
  const gapSeconds = normalizeSendGapSeconds(mb.sendGapSeconds);
  const mailboxKey = `${organizationId}/${uid}/${mailboxId}`;
  if (gapSeconds > 0) {
    let lastMs = lastSentAtByMailbox.get(mailboxKey);
    if (lastMs == null) {
      const zone = await orgTimezone(organizationId);
      const dayKey = dayKeyInZone(new Date(), zone);
      const stats = await mailboxRef(organizationId, uid, mailboxId)
        .collection("sendStats")
        .doc(dayKey)
        .get();
      const last = stats.data()?.lastSentAt;
      if (typeof last === "string" && last.trim()) {
        lastMs = new Date(last).getTime();
      }
    }
    if (lastMs != null && Number.isFinite(lastMs)) {
      const earliest = lastMs + gapSeconds * 1000;
      const waitMs = earliest - Date.now();
      if (waitMs > 0) {
        const retryAt = new Date(earliest).toISOString();
        await docRef.update({
          status: "pending",
          scheduledAt: retryAt,
          updatedAt: new Date().toISOString(),
          processingAt: FieldValue.delete(),
          processingClaimId: FieldValue.delete(),
        });
        if (followupId) {
          await updateFollowupDelivery(followupId, {
            deliveryStatus: "scheduled",
            nextRetryAt: retryAt,
            emailScheduledAt: retryAt,
          });
        }
        return { outcome: "skipped" };
      }
    }
  }

  const dailyLimitRaw = mb.dailySendLimit;
  const dailyLimit =
    dailyLimitRaw == null || !Number.isFinite(Number(dailyLimitRaw)) || Number(dailyLimitRaw) <= 0
      ? null
      : Math.floor(Number(dailyLimitRaw));
  if (dailyLimit != null) {
    const zone = await orgTimezone(organizationId);
    const dayKey = dayKeyInZone(new Date(), zone);
    const stats = await mailboxRef(organizationId, uid, mailboxId)
      .collection("sendStats")
      .doc(dayKey)
      .get();
    const used = Math.max(0, Number(stats.data()?.count ?? 0));
    if (used >= dailyLimit) {
      const now = new Date().toISOString();
      const deferAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const error = `Daily send limit reached (${used}/${dailyLimit}). Try again after midnight (${zone}).`;
      await docRef.update({
        status: "pending",
        scheduledAt: deferAt,
        error,
        failureKind: "quota",
        updatedAt: now,
        processingAt: FieldValue.delete(),
        processingClaimId: FieldValue.delete(),
      });
      if (followupId) {
        await updateFollowupDelivery(followupId, {
          deliveryStatus: "needs_retry",
          failedAt: now,
          deliveryError: error,
          nextRetryAt: deferAt,
          emailScheduledAt: deferAt,
        });
      }
      return { outcome: "skipped" };
    }
  }

  const attachments = parseAttachments(data.attachments);
  if ("error" in attachments) {
    const now = new Date().toISOString();
    await docRef.update({
      status: "failed",
      error: attachments.error,
      failureKind: "permanent",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    return { outcome: "failed" };
  }

  const auth = await resolveSmtpAuth({ organizationId, uid, mailboxId });
  if (!auth) {
    const now = new Date().toISOString();
    const error = "SMTP credentials missing.";
    await docRef.update({
      status: "failed",
      error,
      failureKind: "permanent",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupId) {
      await updateFollowupDelivery(followupId, {
        deliveryStatus: "failed",
        failedAt: now,
        deliveryError: error,
      });
    }
    return { outcome: "failed" };
  }

  const subject = String(data.subject ?? "");
  const from = String(data.from ?? mb.emailAddress ?? "");
  const to = String(data.to ?? "");
  const text = String(data.text ?? data.body ?? "");
  const html = String(data.html ?? "");
  const inReplyTo = String(data.inReplyTo ?? "") || undefined;
  const referenceIds = Array.isArray(data.referenceIds)
    ? data.referenceIds.map(String).filter(Boolean).slice(-50)
    : undefined;
  const connectionType = String(mb.connectionType ?? "");
  const appendSentCopy =
    connectionType !== "google_workspace" && connectionType !== "microsoft_outlook";
  const scheduledByUserId =
    typeof data.scheduledByUserId === "string" && data.scheduledByUserId.trim()
      ? data.scheduledByUserId.trim()
      : undefined;

  const result = await sendSmtp({
    organizationId,
    uid,
    mailboxId,
    host: String(mb.smtpHost ?? ""),
    port: Number(mb.smtpPort ?? 587) || 587,
    secure: Boolean(mb.smtpSecure),
    user: auth.user,
    pass: auth.pass,
    accessToken: auth.accessToken,
    from,
    displayName: String(data.displayName ?? mb.displayName ?? ""),
    replyTo: String(data.replyTo ?? mb.replyTo ?? "") || undefined,
    to,
    cc: String(data.cc ?? "") || undefined,
    bcc: String(data.bcc ?? "") || undefined,
    subject,
    text,
    html,
    inReplyTo,
    referenceIds,
    attachments,
    trackOpens: Boolean(mb.readReceipts),
    trackClicks: Boolean(mb.trackClicks),
    leadId: leadId || undefined,
    followupId: followupId || undefined,
    scheduledEmailId: docRef.id,
    appendSentCopy,
    imapHost: String(mb.imapHost ?? "") || undefined,
    imapPort: Number(mb.imapPort ?? 993) || 993,
    imapSecure: mb.imapSecure !== false,
  });

  const now = new Date().toISOString();
  if (result.ok) {
    const messageId = result.messageId;
    const htmlSent = result.htmlSent;
    await docRef.update({
      status: "sent",
      sentAt: now,
      updatedAt: now,
      error: null,
      failureKind: FieldValue.delete(),
      nextRetryAt: FieldValue.delete(),
      ...(messageId ? { messageId } : {}),
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupId) {
      const planId = await updateFollowupDelivery(followupId, {
        deliveryStatus: "sent",
        sentAt: now,
        ...(messageId ? { sentMessageId: messageId } : {}),
        completedAt: now,
        scheduledEmailId: FieldValue.delete(),
        emailScheduledAt: FieldValue.delete(),
        nextRetryAt: FieldValue.delete(),
        mailboxId,
        fromEmail: from,
        toEmail: to,
        mailboxOwnerUid: uid,
      });
      if (planId) await completePlanWhenAllStepsDone(planId, now);
    }
    try {
      const zone = await orgTimezone(organizationId);
      const dayKey = dayKeyInZone(new Date(), zone);
      await mailboxRef(organizationId, uid, mailboxId)
        .collection("sendStats")
        .doc(dayKey)
        .set(
          {
            count: FieldValue.increment(1),
            dayKey,
            timeZone: zone,
            lastSentAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
    } catch {
      /* quota accounting best-effort */
    }
    lastSentAtByMailbox.set(mailboxKey, Date.now());
    return {
      outcome: "sent",
      sentItem: {
        organizationId,
        uid,
        mailboxId,
        scheduledEmailId: docRef.id,
        ...(leadId ? { leadId } : {}),
        ...(followupId ? { followupId } : {}),
        ...(scheduledByUserId ? { scheduledByUserId } : {}),
        ...(messageId ? { messageId } : {}),
        subject,
        from,
        to,
        ...(String(data.cc ?? "") ? { cc: String(data.cc) } : {}),
        ...(String(data.bcc ?? "") ? { bcc: String(data.bcc) } : {}),
        ...(String(data.replyTo ?? mb.replyTo ?? "")
          ? { replyTo: String(data.replyTo ?? mb.replyTo) }
          : {}),
        text,
        html: htmlSent,
        ...(inReplyTo ? { inReplyTo } : {}),
        ...(referenceIds?.length ? { referenceIds } : {}),
        sentAt: now,
      },
    };
  }

  const attempts = Math.max(0, Number(data.attempts ?? 0)) + 1;
  const kind = classifyScheduledSendError(result.error);
  const errorText = result.error.slice(0, 500);
  if (kind === "transient" && attempts < SCHEDULED_SEND_MAX_ATTEMPTS) {
    const retryAt = nextRetryAtIso(attempts);
    await docRef.update({
      status: "pending",
      scheduledAt: retryAt,
      attempts,
      nextRetryAt: retryAt,
      error: errorText,
      failureKind: "transient",
      updatedAt: now,
      processingAt: FieldValue.delete(),
      processingClaimId: FieldValue.delete(),
    });
    if (followupId) {
      await updateFollowupDelivery(followupId, {
        deliveryStatus: "needs_retry",
        failedAt: now,
        deliveryError: errorText,
        deliveryAttempts: attempts,
        nextRetryAt: retryAt,
        emailScheduledAt: retryAt,
      });
    }
    return { outcome: "skipped" };
  }

  await docRef.update({
    status: "failed",
    error: errorText,
    attempts,
    failureKind: kind === "quota" ? "quota" : "permanent",
    updatedAt: now,
    processingAt: FieldValue.delete(),
    processingClaimId: FieldValue.delete(),
    nextRetryAt: FieldValue.delete(),
  });
  if (followupId) {
    await updateFollowupDelivery(followupId, {
      deliveryStatus: "failed",
      failedAt: now,
      deliveryError: errorText,
      deliveryAttempts: attempts,
      nextRetryAt: FieldValue.delete(),
    });
  }
  return { outcome: "failed" };
}

export async function runDueScheduledEmailsOnFunctions(): Promise<ScheduledEmailSendResult> {
  const now = new Date().toISOString();
  const snap = await db()
    .collectionGroup(SCHEDULED_COLLECTION)
    .where("status", "in", ["pending", "processing"])
    .where("scheduledAt", "<=", now)
    .limit(DUE_LIMIT)
    .get();

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const sentItems: ScheduledEmailSendResult["sentItems"] = [];
  const lastSentAtByMailbox = new Map<string, number>();

  for (const doc of snap.docs) {
    const claimed = await claimScheduledDoc(doc.ref);
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      const { outcome, sentItem } = await sendOne(doc.ref, claimed, lastSentAtByMailbox);
      if (outcome === "sent") {
        sent += 1;
        if (sentItem) sentItems.push(sentItem);
      } else if (outcome === "failed") failed += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    processed: snap.size,
    sent,
    failed,
    skipped,
    sentItems,
  };
}
