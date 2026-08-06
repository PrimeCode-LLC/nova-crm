import crypto from "crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS, ORG_SUBCOLLECTIONS } from "@/lib/firestore/collections";

export type MailboxSecretsInput = {
  smtp: { user: string; password: string };
  imap: { user: string; password: string };
  googleOAuth?: {
    refreshToken: string;
    accessToken: string;
    tokenExpiresAt: string;
    accountEmail: string;
  } | null;
};

export type MailboxSecretsStored = {
  smtp: { user: string; password: string };
  imap: { user: string; password: string };
  googleOAuth?: {
    refreshToken: string;
    accessToken: string;
    tokenExpiresAt: string;
    accountEmail: string;
  };
};

type EncryptedBlob = {
  iv: string;
  tag: string;
  value: string;
};

function getSecretsKey(): Buffer | null {
  const raw = process.env.EMAIL_SECRETS_KEY_BASE64?.trim();
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) return null;
    return key;
  } catch {
    return null;
  }
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

function decryptValue(payload: EncryptedBlob, key: Buffer): string {
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const value = Buffer.from(payload.value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value), decipher.final()]).toString("utf8");
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
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

export function mailboxSecretDocRef(orgId: string, uid: string, mailboxId: string) {
  return mailboxSecretDoc(orgId, uid, mailboxId);
}

/**
 * Cheap connected check: reads the secrets doc but does not decrypt.
 * True when a Google account email + refresh token blob are present.
 */
export function googleAuthConnectedFromSecretsData(
  data: Record<string, unknown> | undefined,
): boolean {
  if (!data) return false;
  const email =
    typeof data.googleAccountEmail === "string" ? data.googleAccountEmail.trim() : "";
  return Boolean(email && isEncryptedBlob(data.googleRefreshToken));
}

function mailboxSecretDoc(orgId: string, uid: string, mailboxId: string) {
  const db = getAdminDb();
  if (!db) return null;
  return db
    .collection(COLLECTIONS.organizations)
    .doc(orgId)
    .collection(ORG_SUBCOLLECTIONS.members)
    .doc(uid)
    .collection("emailMailboxSecrets")
    .doc(mailboxId);
}

export async function upsertMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  secrets: MailboxSecretsInput;
}): Promise<{ ok: true } | { error: string }> {
  const key = getSecretsKey();
  if (!key) {
    return { error: "EMAIL_SECRETS_KEY_BASE64 is missing or invalid (must decode to 32 bytes)." };
  }
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };

  const payload: Record<string, unknown> = {
    smtpUser: encryptValue(input.secrets.smtp.user, key),
    smtpPassword: encryptValue(input.secrets.smtp.password, key),
    imapUser: encryptValue(input.secrets.imap.user, key),
    imapPassword: encryptValue(input.secrets.imap.password, key),
    smtpUserHash: sha256(input.secrets.smtp.user),
    smtpPasswordHash: sha256(input.secrets.smtp.password),
    imapUserHash: sha256(input.secrets.imap.user),
    imapPasswordHash: sha256(input.secrets.imap.password),
    updatedAt: new Date().toISOString(),
  };

  if (input.secrets.googleOAuth === null) {
    payload.googleRefreshToken = null;
    payload.googleAccessToken = null;
    payload.googleTokenExpiresAt = null;
    payload.googleAccountEmail = null;
  } else if (input.secrets.googleOAuth) {
    const o = input.secrets.googleOAuth;
    payload.googleRefreshToken = encryptValue(o.refreshToken, key);
    payload.googleAccessToken = encryptValue(o.accessToken, key);
    payload.googleTokenExpiresAt = o.tokenExpiresAt;
    payload.googleAccountEmail = o.accountEmail;
  }

  await ref.set(payload, { merge: true });
  return { ok: true };
}

/** Merge Google OAuth tokens without wiping SMTP/IMAP password secrets. */
export async function upsertMailboxGoogleOAuthServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  googleOAuth: {
    refreshToken: string;
    accessToken: string;
    tokenExpiresAt: string;
    accountEmail: string;
  };
}): Promise<{ ok: true } | { error: string }> {
  const key = getSecretsKey();
  if (!key) {
    return { error: "EMAIL_SECRETS_KEY_BASE64 is missing or invalid (must decode to 32 bytes)." };
  }
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };

  const existing = await getMailboxSecretsServer(input);
  const email = input.googleOAuth.accountEmail.trim();
  const smtpUser = existing?.smtp.user.trim() || email;
  const imapUser = existing?.imap.user.trim() || email;
  const smtpPassword = existing?.smtp.password ?? "";
  const imapPassword = existing?.imap.password ?? "";

  await ref.set(
    {
      smtpUser: encryptValue(smtpUser, key),
      smtpPassword: encryptValue(smtpPassword, key),
      imapUser: encryptValue(imapUser, key),
      imapPassword: encryptValue(imapPassword, key),
      smtpUserHash: sha256(smtpUser),
      smtpPasswordHash: sha256(smtpPassword),
      imapUserHash: sha256(imapUser),
      imapPasswordHash: sha256(imapPassword),
      googleRefreshToken: encryptValue(input.googleOAuth.refreshToken, key),
      googleAccessToken: encryptValue(input.googleOAuth.accessToken, key),
      googleTokenExpiresAt: input.googleOAuth.tokenExpiresAt,
      googleAccountEmail: email,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  return { ok: true };
}

export async function deleteMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<{ ok: true } | { error: string }> {
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return { error: "Database not configured" };
  await ref.delete();
  return { ok: true };
}

export async function getMailboxSecretsServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
}): Promise<MailboxSecretsStored | null> {
  const key = getSecretsKey();
  if (!key) return null;
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return null;
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  try {
    const stored: MailboxSecretsStored = {
      smtp: {
        user: isEncryptedBlob(data.smtpUser) ? decryptValue(data.smtpUser, key) : "",
        password: isEncryptedBlob(data.smtpPassword)
          ? decryptValue(data.smtpPassword, key)
          : "",
      },
      imap: {
        user: isEncryptedBlob(data.imapUser) ? decryptValue(data.imapUser, key) : "",
        password: isEncryptedBlob(data.imapPassword)
          ? decryptValue(data.imapPassword, key)
          : "",
      },
    };
    if (typeof data.googleAccountEmail === "string") {
      const refreshBlob = data.googleRefreshToken;
      const accessBlob = data.googleAccessToken;
      if (isEncryptedBlob(refreshBlob) || isEncryptedBlob(accessBlob)) {
        stored.googleOAuth = {
          refreshToken: isEncryptedBlob(refreshBlob) ? decryptValue(refreshBlob, key) : "",
          accessToken: isEncryptedBlob(accessBlob) ? decryptValue(accessBlob, key) : "",
          tokenExpiresAt: String(data.googleTokenExpiresAt ?? ""),
          accountEmail: data.googleAccountEmail.trim(),
        };
      }
    }
    return stored;
  } catch {
    return null;
  }
}

export async function patchMailboxGoogleAccessTokenServer(input: {
  organizationId: string;
  uid: string;
  mailboxId: string;
  accessToken: string;
  tokenExpiresAt: string;
}): Promise<void> {
  const key = getSecretsKey();
  if (!key) return;
  const ref = mailboxSecretDoc(input.organizationId, input.uid, input.mailboxId);
  if (!ref) return;
  await ref.set(
    {
      googleAccessToken: encryptValue(input.accessToken, key),
      googleTokenExpiresAt: input.tokenExpiresAt,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}
