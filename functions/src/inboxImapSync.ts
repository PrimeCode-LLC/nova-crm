/**
 * Phase 1.2 — IMAP inbox head sync runs on Cloud Functions (Gen2 / Cloud Run),
 * not App Hosting, so sequential IMAP work cannot hang interactive instances.
 *
 * Bounce apply + lead-mail fanout stay on App Hosting via
 * `/api/cron/inbox-imap/postprocess` (reads stored heads; lighter IMAP body fetches only).
 */
import crypto from "crypto";
import { getFirestore } from "firebase-admin/firestore";
import { ImapFlow } from "imapflow";

const MAX_MAILBOXES_PER_TICK = 12;
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const IMAP_CRON_HEAD_LIMIT = 800;
const CONNECTION_MS = 12_000;
const GREETING_MS = 12_000;
const SOCKET_MS_FETCH = 180_000;

type DueMailbox = {
  organizationId: string;
  uid: string;
  mailboxId: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  syncIntervalMinutes: number;
  inboxLastSyncedAt: string | null;
};

type HeadMessage = {
  id: string;
  uid: number;
  subject: string;
  from: string;
  to: string;
  cc?: string;
  date: string;
  seen: boolean;
  preview: string;
  messageId?: string;
  inReplyTo?: string;
  referenceIds?: string[];
  bodySynced: false;
  bodyText: "";
};

export type InboxImapHeadsSyncResult = {
  considered: number;
  synced: number;
  failed: number;
  skipped: number;
  syncedMailboxes: Array<{ organizationId: string; uid: string; mailboxId: string }>;
  errors: Array<{ organizationId: string; mailboxId: string; error: string }>;
};

type EncryptedBlob = { iv: string; tag: string; value: string };

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

function normalizeMessageId(raw: string | undefined | null): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const inner = s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1).trim() : s;
  return inner || undefined;
}

function parseReferencesField(raw: unknown): string[] {
  if (raw == null) return [];
  const split = (s: string) => {
    const matches = s.match(/<[^>]+>/g);
    if (!matches?.length) return [];
    return matches.map((m) => normalizeMessageId(m)).filter((x): x is string => Boolean(x));
  };
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") out.push(...split(item));
    }
    return out;
  }
  if (typeof raw === "string") return split(raw);
  return [];
}

function formatImapAddressList(
  list: { name?: string; address?: string }[] | undefined,
): string {
  if (!list?.length) return "";
  return list
    .map((a) => {
      const addr = a.address?.trim() ?? "";
      if (a.name?.trim()) return `${a.name.replace(/"/g, "")} <${addr}>`;
      return addr;
    })
    .filter(Boolean)
    .join(", ");
}

function isDue(lastSyncedAt: string | null, intervalMinutes: number, nowMs: number): boolean {
  if (!lastSyncedAt) return true;
  const t = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs - t >= intervalMinutes * 60_000;
}

function memberMailboxCollection(orgId: string, uid: string) {
  return db()
    .collection("organizations")
    .doc(orgId)
    .collection("members")
    .doc(uid)
    .collection("emailMailboxes");
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

async function resolveMailboxAuth(input: {
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
    const imapUser = isEncryptedBlob(data.imapUser) ? decryptValue(data.imapUser, key) : "";
    const imapPass = isEncryptedBlob(data.imapPassword)
      ? decryptValue(data.imapPassword, key)
      : "";
    const smtpUser = isEncryptedBlob(data.smtpUser) ? decryptValue(data.smtpUser, key) : "";
    const smtpPass = isEncryptedBlob(data.smtpPassword)
      ? decryptValue(data.smtpPassword, key)
      : "";
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
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
            const encrypted = Buffer.concat([
              cipher.update(refreshed.accessToken, "utf8"),
              cipher.final(),
            ]);
            const tag = cipher.getAuthTag();
            await mailboxSecretsRef(input.organizationId, input.uid, input.mailboxId).set(
              {
                googleAccessToken: {
                  iv: iv.toString("base64"),
                  tag: tag.toString("base64"),
                  value: encrypted.toString("base64"),
                },
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

    let user = imapUser.trim() || smtpUser.trim() || accountEmail;
    let pass = imapPass || smtpPass;
    if (!user) {
      const profile = await memberMailboxCollection(input.organizationId, input.uid)
        .doc(input.mailboxId)
        .get();
      const emailAddress = String(profile.data()?.emailAddress ?? "").trim();
      if (emailAddress) user = emailAddress;
    }
    if (!user || (!pass && !accountEmail)) return null;
    if (!pass) return null;
    return { user, pass };
  } catch {
    return null;
  }
}

function formatImapError(err: unknown): string {
  if (!(err instanceof Error)) return "IMAP operation failed";
  const code = (err as NodeJS.ErrnoException).code;
  const msg = err.message || "";
  if (code === "ETIMEDOUT" || code === "ETIMEOUT" || /socket timeout|timeout/i.test(msg)) {
    return "IMAP timed out, check host/port/TLS and firewall.";
  }
  if (/AUTHENTICATIONFAILED|authentication failed|Invalid credentials/i.test(msg)) {
    return `IMAP login rejected: ${msg.slice(0, 160)}`;
  }
  return msg.slice(0, 400) || "IMAP operation failed";
}

async function fetchInboxHeads(input: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  limit: number;
}): Promise<{ messages: HeadMessage[]; mailboxTotal: number }> {
  const host = normalizeMailHost(input.host);
  const user = input.user.trim();
  if (!host || !user) throw new Error("IMAP host and username are required.");
  if (!input.accessToken && !input.pass) throw new Error("IMAP credentials missing.");

  const client = new ImapFlow({
    host,
    port: input.port,
    secure: input.secure,
    auth: input.accessToken
      ? { user, accessToken: input.accessToken }
      : { user, pass: input.pass },
    logger: false,
    connectionTimeout: CONNECTION_MS,
    greetingTimeout: GREETING_MS,
    socketTimeout: SOCKET_MS_FETCH,
  });
  client.on("error", () => undefined);
  await client.connect();

  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const uids = await client.search({ all: true }, { uid: true });
    if (!uids || uids.length === 0) return { messages: [], mailboxTotal: 0 };

    const sorted = [...uids].sort((a, b) => b - a);
    const mailboxTotal = sorted.length;
    const slice = sorted.slice(0, Math.min(input.limit, sorted.length));
    const envelopeRows = await client.fetchAll(
      slice,
      { uid: true, flags: true, envelope: true, internalDate: true },
      { uid: true },
    );
    const envByUid = new Map(envelopeRows.map((r) => [r.uid, r]));

    const messages: HeadMessage[] = [];
    for (const uid of slice) {
      const msg = envByUid.get(uid);
      if (!msg?.envelope) continue;
      const env = msg.envelope as {
        subject?: string;
        from?: { name?: string; address?: string }[];
        to?: { name?: string; address?: string }[];
        cc?: { name?: string; address?: string }[];
        messageId?: string;
        inReplyTo?: string;
        references?: string | string[];
        date?: Date;
      };
      const subj = env.subject?.trim() || "(no subject)";
      const from = formatImapAddressList(env.from) || "Unknown";
      const to = formatImapAddressList(env.to);
      const cc = formatImapAddressList(env.cc);
      const date = (
        msg.internalDate instanceof Date
          ? msg.internalDate
          : env.date
            ? new Date(env.date)
            : new Date()
      ).toISOString();
      const messageId = normalizeMessageId(env.messageId);
      const inReplyTo = normalizeMessageId(env.inReplyTo);
      const referenceIds = parseReferencesField(env.references);
      const head: HeadMessage = {
        id: `uid-${msg.uid}`,
        uid: msg.uid,
        subject: subj,
        from,
        to,
        date,
        seen: msg.flags?.has("\\Seen") ?? false,
        preview: subj,
        bodySynced: false,
        bodyText: "",
      };
      if (cc.trim()) head.cc = cc;
      if (messageId) head.messageId = messageId;
      if (inReplyTo) head.inReplyTo = inReplyTo;
      if (referenceIds.length) head.referenceIds = referenceIds;
      messages.push(head);
    }
    return { messages, mailboxTotal };
  } finally {
    try {
      lock.release();
    } catch {
      /* ignore */
    }
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function writeInboxHeads(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  messages: HeadMessage[];
  mailboxTotal: number;
}): Promise<void> {
  const mb = memberMailboxCollection(input.organizationId, input.uid).doc(input.mailboxId);
  const heads = mb.collection("inboxSync").doc("heads");
  const syncedAt = new Date().toISOString();
  const unreadCount = input.messages.filter((h) => !h.seen).length;
  await heads.set({
    messages: input.messages,
    mailboxTotal: input.mailboxTotal,
    syncedAt,
    unreadCount,
    headCount: input.messages.length,
  });
  await mb.set(
    {
      inboxLastSyncedAt: syncedAt,
      inboxLastSyncError: null,
      inboxMailboxTotal: input.mailboxTotal,
      inboxUnreadHeadCount: unreadCount,
      updatedAt: syncedAt,
    },
    { merge: true },
  );
}

async function markInboxSyncError(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  error: string;
}): Promise<void> {
  const mb = memberMailboxCollection(input.organizationId, input.uid).doc(input.mailboxId);
  const syncedAt = new Date().toISOString();
  await mb.set(
    {
      inboxLastSyncedAt: syncedAt,
      inboxLastSyncError: input.error.slice(0, 500),
      updatedAt: syncedAt,
    },
    { merge: true },
  );
}

async function listDueMailboxesForOrg(
  organizationId: string,
  nowMs: number,
): Promise<DueMailbox[]> {
  const usersSnap = await db().collection("users").where("organizationId", "==", organizationId).get();
  const due: DueMailbox[] = [];

  await Promise.all(
    usersSnap.docs.map(async (userDoc) => {
      const status = String(userDoc.data().status ?? "active");
      if (status !== "active") return;
      const snap = await memberMailboxCollection(organizationId, userDoc.id).get();
      for (const doc of snap.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (data.enabled === false) continue;
        const imapHost = normalizeMailHost(String(data.imapHost ?? ""));
        if (!imapHost) continue;
        const syncIntervalMinutes = Math.max(
          5,
          Math.min(
            120,
            Number(data.syncIntervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES) ||
              DEFAULT_SYNC_INTERVAL_MINUTES,
          ),
        );
        const inboxLastSyncedAt = data.inboxLastSyncedAt
          ? String(data.inboxLastSyncedAt)
          : null;
        if (!isDue(inboxLastSyncedAt, syncIntervalMinutes, nowMs)) continue;
        due.push({
          organizationId,
          uid: userDoc.id,
          mailboxId: doc.id,
          imapHost,
          imapPort: Number(data.imapPort ?? 993) || 993,
          imapSecure: data.imapSecure !== false,
          syncIntervalMinutes,
          inboxLastSyncedAt,
        });
      }
    }),
  );

  due.sort((a, b) => {
    const at = a.inboxLastSyncedAt ? new Date(a.inboxLastSyncedAt).getTime() : 0;
    const bt = b.inboxLastSyncedAt ? new Date(b.inboxLastSyncedAt).getTime() : 0;
    return at - bt;
  });
  return due;
}

async function syncOneMailbox(mb: DueMailbox): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await resolveMailboxAuth(mb);
    if (!auth?.accessToken && !auth?.pass) {
      const error = "IMAP credentials missing";
      await markInboxSyncError({ ...mb, error });
      return { ok: false, error };
    }
    const result = await fetchInboxHeads({
      host: mb.imapHost,
      port: mb.imapPort,
      secure: mb.imapSecure,
      user: auth!.user,
      pass: auth!.pass,
      accessToken: auth!.accessToken,
      limit: IMAP_CRON_HEAD_LIMIT,
    });
    await writeInboxHeads({
      organizationId: mb.organizationId,
      uid: mb.uid,
      mailboxId: mb.mailboxId,
      messages: result.messages,
      mailboxTotal: result.mailboxTotal,
    });
    return { ok: true };
  } catch (e) {
    const error = formatImapError(e);
    await markInboxSyncError({ ...mb, error });
    return { ok: false, error };
  }
}

/**
 * Server-side IMAP head sync for due mailboxes across active orgs.
 * Caps work per tick; remaining mailboxes catch up next run.
 */
export async function runInboxImapHeadsSyncOnFunctions(): Promise<InboxImapHeadsSyncResult> {
  const nowMs = Date.now();
  const orgsSnap = await db().collection("organizations").limit(200).get();
  const activeOrgs = orgsSnap.docs.filter((d) => {
    const status = String(d.data().status ?? "trial");
    return status !== "suspended";
  });

  const due: DueMailbox[] = [];
  for (const org of activeOrgs) {
    const orgDue = await listDueMailboxesForOrg(org.id, nowMs);
    due.push(...orgDue);
  }

  const batch = due.slice(0, MAX_MAILBOXES_PER_TICK);
  const skipped = Math.max(0, due.length - batch.length);

  let synced = 0;
  let failed = 0;
  const syncedMailboxes: InboxImapHeadsSyncResult["syncedMailboxes"] = [];
  const errors: InboxImapHeadsSyncResult["errors"] = [];

  for (const mb of batch) {
    const result = await syncOneMailbox(mb);
    if (result.ok) {
      synced += 1;
      syncedMailboxes.push({
        organizationId: mb.organizationId,
        uid: mb.uid,
        mailboxId: mb.mailboxId,
      });
    } else {
      failed += 1;
      if (result.error) {
        errors.push({
          organizationId: mb.organizationId,
          mailboxId: mb.mailboxId,
          error: result.error,
        });
      }
    }
  }

  return {
    considered: due.length,
    synced,
    failed,
    skipped,
    syncedMailboxes,
    errors: errors.slice(0, 20),
  };
}
